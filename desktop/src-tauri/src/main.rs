//! pi-web 桌面壳（Tauri v2）编排入口（spec electron-to-tauri 任务 4.2/4.3）。
//!
//! 串联启动链：建窗加载随包加载页（先于一切，杜绝空白窗口）→ 判定运行模式 → dev 直接导航到
//! 开发地址且**不拉起后端**；否则解析产物与随包 node 路径 → 受监管拉起 → 就绪导航到本地回环
//! UI；失败呈现可重试错误页。退出前收尾 server 进程树（Req 4.1）。
//!
//! **不注入 agent 配置目录覆盖** → 会话默认落 `~/.pi/agent`，与 CLI 共享（Req 5.5）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod dialog;
mod external_link;
mod ready_probe;
mod resolve_artifact;
mod runtime_mode;
mod server_supervisor;
mod startup_error;
mod types;
mod unpack_runtime;
mod window;

use resolve_artifact::{discover_cli_entry, resolve_artifact, ResolveDeps, SERVER_JS_ENV};
use server_supervisor::{ServerStartOptions, ServerSupervisor};
use startup_error::describe_startup_error;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use types::{ResolveError, RuntimeMode, ServerSource};
use window::ServerOrigin;

const HOST: &str = "127.0.0.1";
const DEFAULT_START_PORT: u16 = 3000;
/// 启动失败时推给错误页的事件名（页面只呈现文案，不解析错误类型）。
const STARTUP_ERROR_EVENT: &str = "startup-error";

/// 应用全局状态：受监管的 server + 其 origin（供导航放行判据）。
struct AppState {
    supervisor: Mutex<ServerSupervisor>,
    server_origin: ServerOrigin,
    /// 防止退出流程重入。
    quitting: Mutex<bool>,
}

/// 打包态判据：`dev` cfg 由 `tauri-build` 在开发构建时设置。
fn is_packaged() -> bool {
    !cfg!(dev)
}

fn start_port() -> u16 {
    std::env::var("PI_WEB_DESKTOP_PORT")
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(DEFAULT_START_PORT)
}

/// 后端基础环境：默认源与默认 cwd。**不含 agentDir**（Req 5.5）。
fn base_env() -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    if let Ok(src) = std::env::var("PI_WEB_DEFAULT_SOURCE") {
        if !src.trim().is_empty() {
            env.insert("PI_WEB_DEFAULT_SOURCE".into(), src);
        }
    }
    let cwd = std::env::var("PI_WEB_DEFAULT_CWD").ok().unwrap_or_else(|| {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    });
    if !cwd.is_empty() {
        env.insert("PI_WEB_DEFAULT_CWD".into(), cwd);
    }
    env
}

fn describe_resolve_error(err: &ResolveError) -> String {
    match err {
        ResolveError::MissingResourceDir => {
            "打包态无法定位自包含产物：缺少资源目录。应用可能已损坏，请重新安装。".into()
        }
        ResolveError::MissingCliEntry => format!(
            "未打包态无法定位自包含产物入口。\n请先执行 `pnpm build:dist`，或经 {SERVER_JS_ENV} 指定入口。"
        ),
        ResolveError::MissingExeDir => {
            "无法定位应用可执行文件所在目录，从而找不到随包 Node 运行时。".into()
        }
    }
}

/// 把错误文案推给随包错误页。
fn show_startup_error(app: &AppHandle, title: &str, detail: &str) {
    if let Err(e) = app.emit(
        STARTUP_ERROR_EVENT,
        serde_json::json!({ "title": title, "detail": detail }),
    ) {
        eprintln!("[desktop] 呈现启动错误失败: {e}");
    }
    eprintln!("[desktop] 启动失败: {title}\n{detail}");
}

/// 一次完整的启动尝试。失败时呈现可重试的错误页，不 panic。
fn launch(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mode = runtime_mode::resolve_from_env(is_packaged());

    // dev：加载已运行的开发服务器，不拉起 standalone（保留前端热更新，Req 1.1）。
    if let RuntimeMode::Dev { dev_url } = &mode {
        if let Some(win) = window::main_window(app) {
            if let Ok(mut origin) = state.server_origin.lock() {
                *origin = url::Url::parse(dev_url)
                    .ok()
                    .map(|u| u.origin().ascii_serialization());
            }
            if let Err(e) = window::navigate(&win, dev_url) {
                show_startup_error(app, "无法加载开发地址", &e);
            }
        }
        return;
    }

    // 产物入口与随包 node 路径。二者来源不同（resource_dir vs exe 同目录），不可混用。
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf));
    let resource_dir = app.path().resource_dir().ok();
    let env_override = std::env::var(SERVER_JS_ENV).ok();
    let deps = ResolveDeps {
        resource_dir,
        exe_dir: exe_dir.clone(),
        cli_dist_server_js: discover_cli_entry(exe_dir.as_deref(), env_override.as_deref()),
    };

    let paths = match resolve_artifact(&mode, &deps) {
        Ok(Some(p)) => p,
        Ok(None) => return, // dev 已在上面处理
        Err(err) => {
            show_startup_error(app, "无法定位应用组件", &describe_resolve_error(&err));
            return;
        }
    };

    // 打包态：安装包里只有压缩载荷，入口须先解包到共享运行时目录（spec shared-runtime-payload）。
    // 解包由随包 node 执行 payload/unpack.mjs 完成——桌面壳不实现解包语义。
    let (server_js, runtime) = match paths.server_source {
        ServerSource::Direct(path) => (path, None),
        ServerSource::Payload { payload_dir } => {
            match unpack_runtime::ensure(&paths.node_bin, &payload_dir) {
                Ok(ok) => {
                    if ok.unpacked {
                        eprintln!("[desktop] 首次启动，已解包运行时 → {}", ok.runtime_dir);
                    }
                    let rt = (payload_dir, ok.runtime_root, ok.runtime_dir);
                    (ok.server_js, Some(rt))
                }
                Err(err) => {
                    // 失败进既有的可重试错误页，绝不静默退出（Req 4.6）。
                    show_startup_error(
                        app,
                        "无法准备运行时",
                        &unpack_runtime::describe_unpack_error(&err),
                    );
                    return;
                }
            }
        }
    };

    let mut opts = ServerStartOptions::new(
        server_js,
        paths.node_bin.clone(),
        HOST.to_string(),
        start_port(),
    );
    opts.base_env = base_env();

    let outcome = {
        let mut sup = match state.supervisor.lock() {
            Ok(s) => s,
            Err(_) => {
                show_startup_error(app, "内部错误", "无法获取服务器管理器（锁中毒）。");
                return;
            }
        };
        sup.start(opts)
    };

    match outcome {
        Ok(result) => {
            // ★ 后端已拉起，此后才允许回收旧运行时（Req 5.5：GC 不得阻塞后端拉起）。
            if let Some((payload_dir, runtime_root, runtime_dir)) = runtime {
                unpack_runtime::spawn_gc(&paths.node_bin, &payload_dir, &runtime_root, &runtime_dir);
            }
            if let Ok(mut origin) = state.server_origin.lock() {
                *origin = url::Url::parse(&result.url)
                    .ok()
                    .map(|u| u.origin().ascii_serialization());
            }
            if let Some(win) = window::main_window(app) {
                if let Err(e) = window::navigate(&win, &result.url) {
                    show_startup_error(app, "无法加载本地界面", &e);
                }
            }
        }
        Err(err) => {
            let text = describe_startup_error(&err);
            show_startup_error(app, &text.title, &text.detail);
        }
    }
}

/// 错误页「重试」：重跑完整拉起流程（Req 3.5）。
#[tauri::command]
async fn retry(app: AppHandle) {
    // 拉起含阻塞的就绪轮询，勿占用 async 运行时线程。
    let _ = tauri::async_runtime::spawn_blocking(move || launch(&app)).await;
}

/// 错误页「退出」（Req 3.6）。
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// 把 SIGTERM / SIGINT 转为优雅退出（Req 4.1/4.5）。
///
/// ★ tao 不处理这些信号：进程会被内核直接终止，`RunEvent::ExitRequested` 与 `Drop` 都不执行，
///   于是被 spawn 的 server 及其 pi runner 孙进程成为孤儿并继续占着端口（实测证实）。
///   又因 server 被刻意置为**独立进程组组长**（为了能整组收尾），它更不会随父进程一起被杀。
///   收到信号后转调 `app.exit(0)`，正常走 `ExitRequested` → `stop()` → 退出。
#[cfg(unix)]
fn install_signal_handlers(app: &AppHandle) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;

    let handle = app.clone();
    match Signals::new([SIGTERM, SIGINT]) {
        Ok(mut signals) => {
            std::thread::spawn(move || {
                if let Some(sig) = signals.forever().next() {
                    eprintln!("[desktop] 收到信号 {sig}，开始优雅退出");
                    handle.exit(0);
                }
            });
        }
        Err(e) => eprintln!("[desktop] 无法安装信号处理器: {e}"),
    }
}

#[cfg(not(unix))]
fn install_signal_handlers(_app: &AppHandle) {}

fn main() {
    let server_origin: ServerOrigin = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            supervisor: Mutex::new(ServerSupervisor::new()),
            server_origin: server_origin.clone(),
            quitting: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            dialog::pick_directory,
            retry,
            quit
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            // SIGTERM/SIGINT → 优雅退出（否则 server 与 runner 成孤儿；黑盒 e2e 依赖此路径）。
            install_signal_handlers(&handle);
            // ★ 先建窗加载随包加载页，再做任何后端动作 → 任何分支都不出现空白窗口（Req 1.4）。
            window::create_main_window(&handle, server_origin.clone())?;
            // 拉起含阻塞的就绪轮询（最长 60s），必须离开主线程，否则窗口无法绘制。
            tauri::async_runtime::spawn_blocking(move || launch(&handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("构建 pi-web 桌面壳失败")
        .run(|app, event| match event {
            // 退出前收尾 server 进程树（Req 4.1）。preventExit 一次，避免重入。
            RunEvent::ExitRequested { api, .. } => {
                let state = app.state::<AppState>();
                let already = state
                    .quitting
                    .lock()
                    .map(|mut q| std::mem::replace(&mut *q, true))
                    .unwrap_or(false);
                if already {
                    return;
                }
                api.prevent_exit();
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let state = handle.state::<AppState>();
                    if let Ok(mut sup) = state.supervisor.lock() {
                        sup.stop();
                    }
                    handle.exit(0);
                });
            }
            // macOS：Dock 点击且无窗口 → 重开（Req 1.6）。
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if window::main_window(app).is_none() {
                    let origin = app.state::<AppState>().server_origin.clone();
                    if let Err(e) = window::create_main_window(app, origin) {
                        eprintln!("[desktop] 重开窗口失败: {e}");
                    }
                    // 若后端已就绪，直接导航回它；否则加载页会停在初始态。
                    let url = app
                        .state::<AppState>()
                        .supervisor
                        .lock()
                        .ok()
                        .and_then(|s| s.port())
                        .map(|p| format!("http://{HOST}:{p}"));
                    if let (Some(win), Some(url)) = (window::main_window(app), url) {
                        let _ = window::navigate(&win, &url);
                    }
                }
            }
            _ => {}
        });
}
