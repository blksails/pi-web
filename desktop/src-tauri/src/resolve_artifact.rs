//! 自包含产物入口与随包 Node 的路径推导（spec electron-to-tauri 任务 2.2，Req 1.2/1.3/5.2/5.3）。
//!
//! 纯函数：按运行模式返回被拉起的 `server.mjs` 与随包 `node` 的绝对路径；dev 态返回 `None`
//! （壳改加载 dev url，不拉起 server）。所有环境相关输入经 `ResolveDeps` 注入以便测试。
//!
//! ★ **两条路径来源不同，不可混用**：
//!   - `payload_dir` 来自 `resource_dir()`（`bundle.resources`）—— macOS 为 `Contents/Resources/`
//!   - `node_bin` 来自**主可执行同目录**（`bundle.externalBin`）—— macOS 为 `Contents/MacOS/`
//!   混用会在打包态崩溃，且**只有 `desktop-packaged.mjs` 能捕获**（未打包 e2e 抓不到）。
//!
//! ★ 入口必须位于产物根：`server_supervisor` 以 `dirname(server_js)` 作子进程 cwd，
//!   否则 `packages/server` 的路径解析回退失效。
//!
//! ★ 打包态**不再内嵌 `dist/` 树**（spec shared-runtime-payload）：资源目录里只有压缩载荷，
//!   入口须由 `unpack_runtime` 解包到共享运行时目录后才存在。故本函数对打包态只返回
//!   `ServerSource::Payload { payload_dir }`，把「解包」这一副作用留给调用方。

use crate::types::{ArtifactPaths, ResolveError, RuntimeMode, ServerSource};
use std::path::{Path, PathBuf};

/// e2e 覆盖未打包态入口的环境变量（避开构建产物布局漂移）。
pub const SERVER_JS_ENV: &str = "PI_WEB_DESKTOP_SERVER_JS";

/// 自包含产物入口的固定文件名与所在目录名（未打包态直接使用）。
const DIST_DIR: &str = "dist";
const SERVER_JS: &str = "server.mjs";

/// 打包态随包载荷的目录名（与 npm `files` 及 `bundle.resources` 同名）。
const PAYLOAD_DIR: &str = "payload";

pub struct ResolveDeps {
    /// 打包态资源目录；生产传 `app.path().resource_dir()`。dev/unpackaged 可为 `None`。
    pub resource_dir: Option<PathBuf>,
    /// 主可执行文件所在目录；生产传 `current_exe()?.parent()?`。sidecar 落于此。
    pub exe_dir: Option<PathBuf>,
    /// 未打包态的产物入口（env 覆盖或从 exe 上溯探得）。
    pub cli_dist_server_js: Option<PathBuf>,
}

/// 随包 node 的文件名（打包时 target triple 后缀已被 Tauri 剥离）。
fn node_file_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

/// 依运行模式解析两条路径；dev → `Ok(None)`（不拉起后端）。
pub fn resolve_artifact(
    mode: &RuntimeMode,
    deps: &ResolveDeps,
) -> Result<Option<ArtifactPaths>, ResolveError> {
    if matches!(mode, RuntimeMode::Dev { .. }) {
        return Ok(None);
    }

    // 随包 node：恒在主可执行同目录（externalBin 的落盘约定），与 resource_dir 无关。
    let exe_dir = deps.exe_dir.as_ref().ok_or(ResolveError::MissingExeDir)?;
    let node_bin = exe_dir.join(node_file_name());

    let server_source = match mode {
        RuntimeMode::Packaged => {
            let res = deps
                .resource_dir
                .as_ref()
                .ok_or(ResolveError::MissingResourceDir)?;
            ServerSource::Payload {
                payload_dir: res.join(PAYLOAD_DIR),
            }
        }
        RuntimeMode::Unpackaged => ServerSource::Direct(
            deps.cli_dist_server_js
                .clone()
                .ok_or(ResolveError::MissingCliEntry)?,
        ),
        RuntimeMode::Dev { .. } => unreachable!("dev 已在函数开头返回"),
    };

    Ok(Some(ArtifactPaths {
        server_source,
        node_bin,
    }))
}

/// 子进程 cwd：产物根（入口所在目录）。
pub fn server_cwd(server_js: &Path) -> Option<&Path> {
    server_js.parent()
}

/// 未打包态定位产物入口：优先 env 覆盖，否则自 `exe_dir` 逐级上溯找 `dist/server.mjs`。
///
/// 上溯是为覆盖 `desktop/src-tauri/target/debug/pi-web` → 仓库根 `dist/server.mjs`
/// 这一构建产物布局；限定层数避免走出仓库。
pub fn discover_cli_entry(exe_dir: Option<&Path>, env_override: Option<&str>) -> Option<PathBuf> {
    if let Some(raw) = env_override {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let mut cur = exe_dir?;
    for _ in 0..6 {
        let candidate = cur.join(DIST_DIR).join(SERVER_JS);
        if candidate.is_file() {
            return Some(candidate);
        }
        cur = cur.parent()?;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deps(resource_dir: Option<&str>, exe_dir: Option<&str>, cli: Option<&str>) -> ResolveDeps {
        ResolveDeps {
            resource_dir: resource_dir.map(PathBuf::from),
            exe_dir: exe_dir.map(PathBuf::from),
            cli_dist_server_js: cli.map(PathBuf::from),
        }
    }

    #[test]
    fn dev_does_not_start_backend() {
        let d = deps(None, Some("/app/Contents/MacOS"), None);
        let mode = RuntimeMode::Dev { dev_url: "http://localhost:3010".into() };
        assert_eq!(resolve_artifact(&mode, &d), Ok(None));
    }

    #[test]
    fn payload_dir_comes_from_resource_dir() {
        // ★ 回归防护：打包态的载荷恒取自 resource_dir，且**不再**是 dist/ 树。
        let d = deps(Some("/A.app/Contents/Resources"), Some("/A.app/Contents/MacOS"), None);
        let got = resolve_artifact(&RuntimeMode::Packaged, &d).unwrap().unwrap();
        assert_eq!(
            got.server_source,
            ServerSource::Payload {
                payload_dir: PathBuf::from("/A.app/Contents/Resources/payload")
            }
        );
    }

    #[test]
    fn node_bin_comes_from_exe_dir_not_resource_dir() {
        // ★ 回归防护：sidecar 与载荷来源不同，绝不可混用。
        let d = deps(Some("/A.app/Contents/Resources"), Some("/A.app/Contents/MacOS"), None);
        let got = resolve_artifact(&RuntimeMode::Packaged, &d).unwrap().unwrap();
        assert_eq!(got.node_bin, PathBuf::from("/A.app/Contents/MacOS").join(node_file_name()));
        assert!(!got.node_bin.starts_with("/A.app/Contents/Resources"));
    }

    #[test]
    fn packaged_never_yields_a_direct_entry() {
        // 打包态若返回 Direct，说明有人把 dist/ 又塞回了安装包 —— 那正是本 spec 要根除的。
        let d = deps(Some("/A.app/Contents/Resources"), Some("/A.app/Contents/MacOS"), None);
        let got = resolve_artifact(&RuntimeMode::Packaged, &d).unwrap().unwrap();
        assert!(matches!(got.server_source, ServerSource::Payload { .. }));
    }

    #[test]
    fn unpackaged_uses_cli_entry_without_unpacking() {
        let d = deps(None, Some("/repo/desktop/src-tauri/target/debug"), Some("/repo/dist/server.mjs"));
        let got = resolve_artifact(&RuntimeMode::Unpackaged, &d).unwrap().unwrap();
        assert_eq!(got.server_source, ServerSource::Direct(PathBuf::from("/repo/dist/server.mjs")));
        assert_eq!(
            got.node_bin,
            PathBuf::from("/repo/desktop/src-tauri/target/debug").join(node_file_name())
        );
    }

    #[test]
    fn packaged_without_resource_dir_errs() {
        let d = deps(None, Some("/A.app/Contents/MacOS"), None);
        assert_eq!(resolve_artifact(&RuntimeMode::Packaged, &d), Err(ResolveError::MissingResourceDir));
    }

    #[test]
    fn unpackaged_without_cli_entry_errs() {
        let d = deps(None, Some("/x"), None);
        assert_eq!(resolve_artifact(&RuntimeMode::Unpackaged, &d), Err(ResolveError::MissingCliEntry));
    }

    #[test]
    fn missing_exe_dir_errs() {
        let d = deps(Some("/A.app/Contents/Resources"), None, None);
        assert_eq!(resolve_artifact(&RuntimeMode::Packaged, &d), Err(ResolveError::MissingExeDir));
    }

    #[test]
    fn server_cwd_is_dist_root() {
        // 入口必须在产物根：cwd 即其父目录。
        let cwd = server_cwd(Path::new("/A.app/Contents/Resources/dist/server.mjs")).unwrap();
        assert_eq!(cwd, Path::new("/A.app/Contents/Resources/dist"));
    }

    #[test]
    fn discover_prefers_env_override() {
        let got = discover_cli_entry(Some(Path::new("/x")), Some("/custom/dist/server.mjs"));
        assert_eq!(got, Some(PathBuf::from("/custom/dist/server.mjs")));
    }

    #[test]
    fn discover_ignores_blank_env_override() {
        // 空白 env 视同未设置，落回上溯探测（此处无真实文件 → None）。
        assert_eq!(discover_cli_entry(Some(Path::new("/nonexistent")), Some("  ")), None);
    }

    #[test]
    fn discover_walks_up_to_find_dist_entry() {
        let tmp = std::env::temp_dir().join(format!("pi-web-resolve-{}", std::process::id()));
        let deep = tmp.join("desktop/src-tauri/target/debug");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(tmp.join(DIST_DIR)).unwrap();
        std::fs::write(tmp.join(DIST_DIR).join(SERVER_JS), b"//").unwrap();

        let got = discover_cli_entry(Some(&deep), None);
        assert_eq!(got, Some(tmp.join(DIST_DIR).join(SERVER_JS)));
        std::fs::remove_dir_all(&tmp).ok();
    }
}
