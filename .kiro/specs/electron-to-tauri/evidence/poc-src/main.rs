//! PoC：验证 Tauri v2 窗口加载远端 http://127.0.0.1:<port> 页面后，
//! 该页面能否拿到 window.__TAURI__ 并成功 invoke 自定义 command。
//! 这是 electron-to-tauri 迁移的一票否决点（上游 issue #11934）。

use tauri::{WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn ping(from: Option<String>) -> String {
    eprintln!("[poc-rust] ping 命令被调用, from={:?}", from);
    "PONG".to_string()
}

fn main() {
    let port: u16 = std::env::var("POC_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(34999);
    let url = format!("http://127.0.0.1:{port}/");
    eprintln!("[poc-rust] 将加载远端页面: {url}");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .setup(move |app| {
            let parsed = url.parse().expect("url 解析失败");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("tauri-poc")
                .inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 tauri 应用失败");
}
