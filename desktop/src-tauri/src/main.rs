//! pi-web 桌面壳（Tauri v2）入口。
//!
//! 编排：建窗加载随包加载页 → 判定运行模式 → 受监管拉起后端 → 就绪后导航到本地回环 UI；
//! 失败呈现可重试错误页；退出前收尾后端进程树。窗口与生命周期由任务 4.1/4.2/4.3 填充。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod dialog;
mod external_link;
mod ready_probe;
mod resolve_artifact;
mod runtime_mode;
mod server_supervisor;
mod startup_error;
mod types;
mod window;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("运行 pi-web 桌面壳失败");
}
