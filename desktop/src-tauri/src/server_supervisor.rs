//! 后端受监管拉起与进程树收尾（spec electron-to-tauri 任务 3.1/3.2/3.3）。
//!
//! 职责：选空闲回环端口 → 用**随包 node** spawn standalone server（进程组组长，供整组收尾
//! 触达 pi runner 孙进程）→ 复用就绪探针等待可用 → 返回 url/端口，或判别式启动错误
//! （无端口 / 早退 / 就绪超时），失败时先收尾已拉起的进程（不留孤儿）。
//!
//! ★ **不使用 `tauri_plugin_shell` 的 Command**：它不暴露进程组，其 `kill()` 只杀直接子进程，
//!   触不到 server 派生的 pi runner **孙进程**，会留下孤儿并占住端口。
//!
//! ★ **快照先于收尾**（Req 2.7，Electron 侧已踩过的坑）：探针失败时必须先读取子进程退出状态
//!   快照，再 `stop()`。否则 `stop()` 杀掉仍存活的 server 会把 `ReadyTimeout` 误判成 `EarlyExit`。

use crate::ready_probe::{find_free_port, probe_host, wait_for_ready, READY_TIMEOUT_MS};
use crate::types::{ReadyError, ServerStartError, ServerStartResult};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 端口探测的最大尝试次数（与 CLI 一致）。
const MAX_PORT_TRIES: u16 = 20;
/// stderr 尾部保留上限（字节），用于早退失败诊断（与 Electron 侧一致）。
const STDERR_TAIL_LIMIT: usize = 4096;
/// 优雅信号（SIGTERM）后等待进程组退出的宽限期，超时升级 SIGKILL。
const STOP_GRACE: Duration = Duration::from_secs(3);
/// stop 的兜底硬超时：即便 SIGKILL 后仍未回收也不无限等待。
const STOP_HARD: Duration = Duration::from_secs(5);

pub struct ServerStartOptions {
    pub server_js: PathBuf,
    /// 随包 node 的绝对路径。经 `PI_WEB_NODE_BIN` 下达给 pi runner 孙进程。
    pub node_bin: PathBuf,
    pub host: String,
    pub start_port: u16,
    /// 基础环境（默认源、默认 cwd 等）。`PORT`/`HOSTNAME`/`PI_WEB_NODE_BIN` 由本模块覆盖。
    pub base_env: BTreeMap<String, String>,
    /// 就绪总超时；生产用 `READY_TIMEOUT_MS`，测试可缩短。
    pub ready_timeout_ms: u64,
    /// 端口探测最大尝试次数；生产用 `MAX_PORT_TRIES`，测试可缩至 1 以构造「无空闲端口」。
    pub max_port_tries: u16,
}

impl ServerStartOptions {
    pub fn new(server_js: PathBuf, node_bin: PathBuf, host: String, start_port: u16) -> Self {
        Self {
            server_js,
            node_bin,
            host,
            start_port,
            base_env: BTreeMap::new(),
            ready_timeout_ms: READY_TIMEOUT_MS,
            max_port_tries: MAX_PORT_TRIES,
        }
    }
}

/// 子进程环境中必须**剥除**的键。
///
/// `ELECTRON_RUN_AS_NODE` 是 Electron 时代的遗留，Tauri 下无意义且可能干扰随包 node。
///
/// ★ `PI_WEB_AGENT_DIR` **不在此列**：Req 5.5 要求的是「桌面壳自己不注入 agent 目录覆盖」，
///   而非「剥掉用户显式设置的环境变量」。Electron 侧 `buildEnv` 以 `{...process.env}` 起手、
///   仅在 `opts.agentDir` 存在时才写入该键——外部（用户或 e2e）显式设置的值是被继承的。
///   剥除它会破坏行为等价，也会使 e2e 无法把 agent 指向 mock 目录。
pub const STRIPPED_ENV_KEYS: [&str; 1] = ["ELECTRON_RUN_AS_NODE"];

/// 组装子进程环境的**覆盖项**（不含继承自父进程的部分）。
///
/// ★ 子进程**继承**父进程环境（`HOME`/`PATH` 等是 server 与 pi runner 定位
///   `~/.pi/agent`、解析工具链所必需的），本函数只产出要覆盖/新增的键；
///   要剥除的键见 `STRIPPED_ENV_KEYS`，由 spawn 处 `env_remove` 落实。
///
/// ★ **绝不写入 `PI_WEB_AGENT_DIR`**（Req 5.5）：使会话默认落 `~/.pi/agent` 与 CLI 共享。
pub fn build_child_env(
    base_env: &BTreeMap<String, String>,
    host: &str,
    port: u16,
    node_bin: &Path,
) -> BTreeMap<String, String> {
    let mut env = base_env.clone();
    for k in STRIPPED_ENV_KEYS {
        env.remove(k);
    }
    env.insert("PORT".into(), port.to_string());
    env.insert("HOSTNAME".into(), host.to_string());
    env.insert("PI_WEB_AUTOSTART".into(), "1".into());
    env.insert(
        "PI_WEB_NODE_BIN".into(),
        node_bin.to_string_lossy().into_owned(),
    );
    debug_assert!(
        !env.contains_key("PI_WEB_AGENT_DIR") || base_env.contains_key("PI_WEB_AGENT_DIR"),
        "桌面壳不得自行注入 PI_WEB_AGENT_DIR"
    );
    env
}

/// 通配/未指定主机映射为可导航的回环地址。
fn display_host(host: &str) -> &str {
    probe_host(host)
}

pub struct ServerSupervisor {
    child: Option<Child>,
    port: Option<u16>,
}

impl Default for ServerSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerSupervisor {
    pub fn new() -> Self {
        Self { child: None, port: None }
    }

    /// 当前受监管 server 的端口（就绪后有效）。
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    /// 选端口 → spawn（随包 node）→ 等就绪。
    ///
    /// 失败返回判别式错误，且**已收尾**其 spawn 的进程（不留孤儿，Req 2.6）。
    pub fn start(&mut self, opts: ServerStartOptions) -> Result<ServerStartResult, ServerStartError> {
        // 先收尾可能存在的上一轮（重试路径）。
        self.stop();

        let Some(port) = find_free_port(&opts.host, opts.start_port, opts.max_port_tries) else {
            // 无空闲端口：**不 spawn 任何进程**（Req 2.5）。
            return Err(ServerStartError::NoFreePort { tried_from: opts.start_port });
        };
        self.port = Some(port);

        // 子进程 cwd = 产物根（入口所在目录）。判据集中在 resolve_artifact，避免两处各算各的。
        let cwd = crate::resolve_artifact::server_cwd(&opts.server_js)
            .map(Path::to_path_buf)
            // 入口无父目录属编程错误；退回当前目录不致命，server 会崩并表现为 EarlyExit
            // （带可读 stderr），而非静默错误。
            .unwrap_or_else(|| PathBuf::from("."));
        let env = build_child_env(&opts.base_env, &opts.host, port, &opts.node_bin);

        let mut cmd = Command::new(&opts.node_bin);
        // 继承父进程环境（HOME/PATH 等为 server 与 pi runner 所必需），再覆盖/剥除特定键。
        cmd.arg(&opts.server_js)
            .current_dir(&cwd)
            .envs(&env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for k in STRIPPED_ENV_KEYS {
            cmd.env_remove(k);
        }
        set_process_group(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                self.port = None;
                // spawn 失败（如 node 不存在/不可执行）按早退处理，附可读原因。
                return Err(ServerStartError::EarlyExit {
                    code: None,
                    stderr_tail: format!("[spawn error] {e}"),
                });
            }
        };

        // 排空 stdout，避免管道缓冲填满阻塞子进程。
        if let Some(out) = child.stdout.take() {
            std::thread::spawn(move || {
                let mut sink = out;
                let mut buf = [0u8; 8192];
                while matches!(sink.read(&mut buf), Ok(n) if n > 0) {}
            });
        }
        // 持续收集 stderr 尾部，供早退诊断。
        let stderr_tail = Arc::new(Mutex::new(String::new()));
        if let Some(err) = child.stderr.take() {
            let tail = stderr_tail.clone();
            std::thread::spawn(move || {
                let mut src = err;
                let mut buf = [0u8; 4096];
                while let Ok(n) = src.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    if let Ok(mut t) = tail.lock() {
                        t.push_str(&chunk);
                        if t.len() > STDERR_TAIL_LIMIT {
                            let cut = t.len() - STDERR_TAIL_LIMIT;
                            // 按字符边界截断，避免切碎 UTF-8。
                            let idx = t.char_indices().map(|(i, _)| i).find(|i| *i >= cut).unwrap_or(0);
                            *t = t[idx..].to_string();
                        }
                    }
                }
            });
        }

        // 子进程暂由 RefCell 持有：`is_exited` 闭包需要 `&mut Child` 去 `try_wait()`，
        // 而 `wait_for_ready` 只接受 `&dyn Fn()`。RefCell 提供内部可变性，避免裸指针别名。
        let child_cell = std::cell::RefCell::new(child);
        let is_exited = || -> bool {
            matches!(child_cell.borrow_mut().try_wait(), Ok(Some(_)))
        };
        let probe_result = wait_for_ready(&opts.host, port, opts.ready_timeout_ms, &is_exited);

        // ★ 关键时序：先快照「探针失败时 server 是否已自行退出」，**再** stop 收尾。
        //   若先 stop，它会杀掉仍存活的 server，使 ReadyTimeout 被误判成 EarlyExit（Req 2.7）。
        let exited_before_cleanup = child_cell.borrow_mut().try_wait().ok().flatten();

        self.child = Some(child_cell.into_inner());

        match probe_result {
            Ok(()) => Ok(ServerStartResult {
                url: format!("http://{}:{}", display_host(&opts.host), port),
                port,
            }),
            Err(reason) => {
                self.stop();

                let tail = stderr_tail.lock().map(|t| t.clone()).unwrap_or_default();
                match (exited_before_cleanup, reason) {
                    (Some(status), _) => Err(ServerStartError::EarlyExit {
                        code: status.code(),
                        stderr_tail: tail,
                    }),
                    (None, ReadyError::Aborted) => Err(ServerStartError::EarlyExit {
                        code: None,
                        stderr_tail: tail,
                    }),
                    (None, ReadyError::Timeout { timeout_ms }) => {
                        Err(ServerStartError::ReadyTimeout { timeout_ms })
                    }
                }
            }
        }
    }

    /// 收尾受监管 server 进程**树**（Req 4.1–4.5）。幂等：多次调用安全。
    ///
    /// - POSIX：对 detached 组长发**负 pid** SIGTERM（触达 runner 孙进程），宽限期后升级 SIGKILL。
    /// - Windows：`taskkill /PID <pid> /T /F`（/T 树 /F 强制）。
    /// - 端口随进程退出释放；不留孤儿。
    pub fn stop(&mut self) {
        // 取走并置空句柄 → 幂等：重复调用直接返回。
        let Some(mut child) = self.child.take() else {
            self.port = None;
            return;
        };
        self.port = None;

        // 已自行退出 → 无需再杀（避免 wait 永挂）。
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        let pid = child.id();

        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let _ = child.wait();
        }

        #[cfg(unix)]
        {
            kill_group(pid, libc::SIGTERM);
            let deadline = Instant::now() + STOP_GRACE;
            let mut escalated = false;
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => {}
                    Err(_) => return,
                }
                let now = Instant::now();
                if !escalated && now >= deadline {
                    kill_group(pid, libc::SIGKILL);
                    escalated = true;
                }
                if now >= deadline + (STOP_HARD - STOP_GRACE) {
                    // 兜底：不无限等待。
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

impl Drop for ServerSupervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

/// 使子进程成为**进程组组长**，从而可对整组发信号（触达 pi runner 孙进程）。
#[cfg(unix)]
fn set_process_group(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
}

#[cfg(windows)]
fn set_process_group(_cmd: &mut Command) {
    // Windows 无 POSIX 进程组；收尾走 `taskkill /T` 按进程树终止。
}

/// 对进程组发信号（负 pid）；不可达时退回直杀直属子进程。
#[cfg(unix)]
fn kill_group(pid: u32, signal: i32) {
    let pid = pid as i32;
    unsafe {
        if libc::killpg(pid, signal) != 0 {
            libc::kill(pid, signal);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node_bin() -> PathBuf {
        // 单测用系统 node 即可（本模块测的是编排语义，不是随包 node 本身）。
        PathBuf::from("node")
    }

    fn write_script(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pi-web-sup-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("server.mjs");
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn child_env_injects_node_bin_and_loopback_host() {
        let mut base = BTreeMap::new();
        base.insert("PI_WEB_DEFAULT_SOURCE".into(), "/x/agent".into());
        let env = build_child_env(&base, "127.0.0.1", 4321, Path::new("/A.app/Contents/MacOS/node"));
        assert_eq!(env.get("PORT").map(String::as_str), Some("4321"));
        assert_eq!(env.get("HOSTNAME").map(String::as_str), Some("127.0.0.1"));
        assert_eq!(env.get("PI_WEB_AUTOSTART").map(String::as_str), Some("1"));
        assert_eq!(
            env.get("PI_WEB_NODE_BIN").map(String::as_str),
            Some("/A.app/Contents/MacOS/node")
        );
        assert_eq!(env.get("PI_WEB_DEFAULT_SOURCE").map(String::as_str), Some("/x/agent"));
    }

    #[test]
    fn child_env_never_generates_agent_dir() {
        // Req 5.5：桌面壳**自己**不注入 agentDir → 会话默认落 ~/.pi/agent 与 CLI 共享。
        let base = BTreeMap::new();
        let env = build_child_env(&base, "127.0.0.1", 1, Path::new("/n"));
        assert!(!env.contains_key("PI_WEB_AGENT_DIR"), "壳不得自行生成 agentDir");
    }

    #[test]
    fn child_env_preserves_externally_set_agent_dir() {
        // 但用户/e2e **显式设置**的 agentDir 必须被继承 —— Electron 侧 buildEnv 以
        // `{...process.env}` 起手，剥掉它会破坏行为等价，也会让 e2e 无法指向 mock agent 目录。
        let mut base = BTreeMap::new();
        base.insert("PI_WEB_AGENT_DIR".into(), "/tmp/e2e-agent".into());
        let env = build_child_env(&base, "127.0.0.1", 1, Path::new("/n"));
        assert_eq!(env.get("PI_WEB_AGENT_DIR").map(String::as_str), Some("/tmp/e2e-agent"));
    }

    #[test]
    fn child_env_strips_electron_leftover() {
        let mut base = BTreeMap::new();
        base.insert("ELECTRON_RUN_AS_NODE".into(), "1".into());
        let env = build_child_env(&base, "127.0.0.1", 1, Path::new("/n"));
        assert!(!env.contains_key("ELECTRON_RUN_AS_NODE"), "Tauri 下无意义，应剥除");
    }

    #[test]
    fn spawned_child_inherits_home_and_gets_node_bin() {
        // 纯函数测不到「子进程实际收到什么」。此处让子进程把 env 快照写回 stderr，
        // 经 EarlyExit 的 stderr_tail 取回断言。
        // 覆盖三件事：
        //   ① 继承父进程 HOME（server 与 pi runner 靠它定位 ~/.pi/agent）
        //   ② 未显式设置时子进程看不到 PI_WEB_AGENT_DIR（壳不自行生成，Req 5.5）
        //   ③ PI_WEB_NODE_BIN 被下达（供 pi runner 孙进程复用随包 node，Req 5.3）
        let script = write_script(
            "envsnap",
            "process.stderr.write('HOME_SET=' + (process.env.HOME || process.env.USERPROFILE ? '1' : '0') + '\\n');\
             process.stderr.write('AGENT_DIR=' + (process.env.PI_WEB_AGENT_DIR ?? 'unset') + '\\n');\
             process.stderr.write('NODE_BIN=' + (process.env.PI_WEB_NODE_BIN ?? 'unset') + '\\n');\
             process.exit(7);",
        );
        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(script, node_bin(), "127.0.0.1".into(), 45270);
        opts.ready_timeout_ms = 10_000;

        // 确保父进程环境里也没有它，否则会被继承（这正是本测试要区分的两种情形）。
        let saved = std::env::var("PI_WEB_AGENT_DIR").ok();
        std::env::remove_var("PI_WEB_AGENT_DIR");

        let outcome = sup.start(opts);
        if let Some(v) = saved {
            std::env::set_var("PI_WEB_AGENT_DIR", v);
        }

        match outcome {
            Err(ServerStartError::EarlyExit { code, stderr_tail }) => {
                assert_eq!(code, Some(7));
                assert!(stderr_tail.contains("HOME_SET=1"), "子进程应继承 HOME: {stderr_tail}");
                assert!(
                    stderr_tail.contains("AGENT_DIR=unset"),
                    "壳不得自行生成 PI_WEB_AGENT_DIR: {stderr_tail}"
                );
                assert!(stderr_tail.contains("NODE_BIN=node"), "应下达 PI_WEB_NODE_BIN: {stderr_tail}");
            }
            other => panic!("期望 EarlyExit(code 7)，实际 {other:?}"),
        }
    }

    #[test]
    fn no_free_port_does_not_spawn() {
        // Req 2.5：无空闲端口时**不得 spawn 任何进程**。
        // 构造：占住某端口，且把 max_port_tries 收到 1，使探测范围内确无空闲。
        // node_bin 指向一个必定 spawn 失败的路径——若实现错误地先 spawn，
        // 得到的会是 EarlyExit(spawn error) 而非 NoFreePort，测试即失败。
        let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = occupied.local_addr().unwrap().port();

        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(
            PathBuf::from("/nonexistent/server.mjs"),
            PathBuf::from("/nonexistent/definitely-not-node"),
            "127.0.0.1".into(),
            port,
        );
        opts.max_port_tries = 1;
        opts.ready_timeout_ms = 300;

        match sup.start(opts) {
            Err(ServerStartError::NoFreePort { tried_from }) => assert_eq!(tried_from, port),
            other => panic!("期望 NoFreePort（且未 spawn），实际 {other:?}"),
        }
        assert!(sup.child.is_none(), "NoFreePort 时不得留下子进程句柄");
        assert!(sup.port().is_none());
        drop(occupied);
    }

    #[test]
    fn spawn_failure_is_reported_as_early_exit() {
        // node 不可执行（端口可用）→ 归类为 EarlyExit 并带可读原因，而非 NoFreePort。
        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(
            PathBuf::from("/nonexistent/server.mjs"),
            PathBuf::from("/nonexistent/definitely-not-node"),
            "127.0.0.1".into(),
            45260,
        );
        opts.ready_timeout_ms = 300;
        match sup.start(opts) {
            Err(ServerStartError::EarlyExit { code, stderr_tail }) => {
                assert_eq!(code, None);
                assert!(stderr_tail.contains("spawn error"), "应含可读原因: {stderr_tail}");
            }
            other => panic!("期望 EarlyExit(spawn error)，实际 {other:?}"),
        }
        assert!(sup.child.is_none());
    }

    #[test]
    fn early_exit_carries_code_and_stderr() {
        let script = write_script("early", "process.stderr.write('BOOM_MARKER\\n'); process.exit(3);");
        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(script, node_bin(), "127.0.0.1".into(), 45210);
        opts.ready_timeout_ms = 10_000;
        match sup.start(opts) {
            Err(ServerStartError::EarlyExit { code, stderr_tail }) => {
                assert_eq!(code, Some(3), "应携带退出码");
                assert!(stderr_tail.contains("BOOM_MARKER"), "应携带 stderr 尾部: {stderr_tail}");
            }
            other => panic!("期望 EarlyExit，实际 {other:?}"),
        }
        assert!(sup.child.is_none());
    }

    #[test]
    fn ready_timeout_is_not_misclassified_as_early_exit() {
        // ★ Req 2.7 的核心回归：server 存活但不监听 → 必须是 ReadyTimeout，而非 EarlyExit。
        // 若实现把 stop() 放在快照之前，此测试会失败（stop 杀死进程 → 被判成 EarlyExit）。
        let script = write_script("hang", "setInterval(() => {}, 1000);");
        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(script, node_bin(), "127.0.0.1".into(), 45220);
        opts.ready_timeout_ms = 900;
        match sup.start(opts) {
            Err(ServerStartError::ReadyTimeout { timeout_ms }) => assert_eq!(timeout_ms, 900),
            other => panic!("期望 ReadyTimeout（不得误判为 EarlyExit），实际 {other:?}"),
        }
        assert!(sup.child.is_none(), "失败后应已收尾");
    }

    #[test]
    fn successful_start_returns_loopback_url() {
        let script = write_script(
            "ok",
            "import http from 'node:http';\
             http.createServer((_q,s)=>{s.writeHead(200);s.end('ok')}).listen(process.env.PORT, '127.0.0.1');",
        );
        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(script, node_bin(), "127.0.0.1".into(), 45230);
        opts.ready_timeout_ms = 15_000;
        let got = sup.start(opts).expect("应就绪");
        assert_eq!(got.url, format!("http://127.0.0.1:{}", got.port));
        assert!(sup.port().is_some());
        sup.stop();
        assert!(sup.port().is_none());
    }

    /// 进程是否仍存活（POSIX：signal 0 探测）。
    #[cfg(unix)]
    fn pid_alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    #[cfg(unix)]
    fn stop_kills_grandchild_and_frees_port() {
        // ★ Req 4.1 的核心：server 派生的**孙进程**（现实中是 pi runner）必须一并被收尾。
        // 若实现只 kill 直接子进程（例如误用 tauri_plugin_shell 的 Command），孙进程会成孤儿。
        // 让 server 把孙进程 pid 写入文件，stop 后据此断言其确已消失。
        let dir = std::env::temp_dir().join(format!("pi-web-tree-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pidfile = dir.join("grandchild.pid");
        let pidfile_js = pidfile.to_string_lossy().replace('\\', "\\\\");

        let script = write_script(
            "tree",
            &format!(
                "import http from 'node:http';\
                 import fs from 'node:fs';\
                 import {{spawn}} from 'node:child_process';\
                 const g = spawn(process.execPath, ['-e', 'setInterval(()=>{{}},1000)'], {{stdio:'ignore'}});\
                 fs.writeFileSync('{pidfile_js}', String(g.pid));\
                 http.createServer((_q,s)=>{{s.writeHead(200);s.end('ok')}}).listen(process.env.PORT, '127.0.0.1');"
            ),
        );

        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(script, node_bin(), "127.0.0.1".into(), 45240);
        opts.ready_timeout_ms = 15_000;
        let got = sup.start(opts).expect("应就绪");
        let port = got.port;

        // 就绪后 pidfile 必已写出。
        let mut grandchild: Option<i32> = None;
        for _ in 0..40 {
            if let Ok(s) = std::fs::read_to_string(&pidfile) {
                if let Ok(p) = s.trim().parse::<i32>() {
                    grandchild = Some(p);
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let grandchild = grandchild.expect("server 应已派生孙进程并写出 pid");
        assert!(pid_alive(grandchild), "收尾前孙进程 {grandchild} 应存活");

        sup.stop();

        // 孙进程不得存活（Req 4.1）。
        let mut gone = false;
        for _ in 0..60 {
            if !pid_alive(grandchild) {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(gone, "收尾后孙进程 {grandchild} 不得存活（不留孤儿）");

        // 端口释放（Req 4.5）。
        let mut freed = false;
        for _ in 0..40 {
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
                freed = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(freed, "收尾后端口 {port} 应可被重新绑定");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stop_is_idempotent() {
        let mut sup = ServerSupervisor::new();
        sup.stop();
        sup.stop(); // 不 panic、不挂起
        assert!(sup.port().is_none());
    }

    #[test]
    fn stop_skips_already_exited_child() {
        let script = write_script("quick", "process.exit(0);");
        let mut sup = ServerSupervisor::new();
        let mut opts = ServerStartOptions::new(script, node_bin(), "127.0.0.1".into(), 45250);
        opts.ready_timeout_ms = 800;
        let _ = sup.start(opts); // 必然失败（早退）
        sup.stop(); // 已收尾，二次调用安全
        assert!(sup.port().is_none());
    }
}
