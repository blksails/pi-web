//! 主窗口：建窗、加载页、就绪后导航、外链治理（spec electron-to-tauri 任务 4.1，Req 1.4/1.5/7.1）。
//!
//! 窗口以**随包加载页**建立，先于任何后端动作 —— 任何分支（dev / 拉起中 / 启动失败）下都不会
//! 出现空白窗口（Req 1.4）。后端就绪后导航至本地回环 UI（Req 1.5）。
//!
//! 外链治理（Req 7.1–7.4）：Tauri 无 Electron 的 `setWindowOpenHandler`，改在 `on_navigation`
//! 拦截。三分支：
//!   1. 本应用自身的页面（随包 `tauri://` 资源，或已拉起的回环 server origin）→ 放行导航
//!   2. 非回环 http(s) → 交系统默认浏览器，**阻止**应用内导航
//!   3. 其余（非 http(s) scheme、其他主机的回环、非法 url）→ 一律拒绝

use crate::external_link::decide_external_open;
use crate::types::ExternalOpenDecision;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use url::Url;

pub const MAIN_WINDOW_LABEL: &str = "main";

/// 当前已拉起的后端 origin（如 `http://127.0.0.1:34810`）。导航放行判据之一。
///
/// 就绪前为 `None`：此时任何 http(s) 导航都不属于「本应用页面」。
pub type ServerOrigin = Arc<Mutex<Option<String>>>;

/// 导航决策（纯函数，便于单测；不依赖 tauri 运行时）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
    /// 放行应用内导航。
    Allow,
    /// 交系统默认浏览器打开，并阻止应用内导航。
    OpenExternally,
    /// 拒绝，且不打开任何东西。
    Block,
}

/// 判定一次导航请求该如何处理。
///
/// `server_origin` 为已拉起后端的 origin（就绪前为 `None`）。
pub fn decide_navigation(raw_url: &str, server_origin: Option<&str>) -> NavigationDecision {
    // 随包资源页（加载页/错误页）：Tauri 内部 scheme，放行。
    if raw_url.starts_with("tauri://")
        || raw_url.starts_with("asset://")
        || raw_url.starts_with("http://tauri.localhost")
        || raw_url.starts_with("https://tauri.localhost")
    {
        return NavigationDecision::Allow;
    }
    // 本应用的回环 UI：放行（它正是我们导航过去的目标）。
    if let (Some(origin), Ok(url)) = (server_origin, Url::parse(raw_url)) {
        if url.origin().ascii_serialization() == origin {
            return NavigationDecision::Allow;
        }
    }
    match decide_external_open(raw_url) {
        ExternalOpenDecision::OpenExternal => NavigationDecision::OpenExternally,
        ExternalOpenDecision::Deny => NavigationDecision::Block,
    }
}

/// 建主窗口并加载随包加载页。**在任何后端动作之前调用**。
pub fn create_main_window(
    app: &AppHandle,
    server_origin: ServerOrigin,
) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("pi-web")
        .inner_size(1200.0, 800.0)
        .background_color(tauri::window::Color(0x0b, 0x0b, 0x0c, 0xff))
        .on_navigation(move |url| {
            let raw = url.as_str();
            let origin = server_origin.lock().ok().and_then(|g| g.clone());
            match decide_navigation(raw, origin.as_deref()) {
                NavigationDecision::Allow => true,
                NavigationDecision::OpenExternally => {
                    if let Err(e) = handle.opener().open_url(raw, None::<&str>) {
                        eprintln!("[desktop] 打开外链失败: {e}");
                    }
                    false
                }
                NavigationDecision::Block => {
                    eprintln!("[desktop] 拒绝导航: {raw}");
                    false
                }
            }
        })
        .build()
}

/// 取主窗口（可能已被关闭）。
pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

/// 导航到指定 URL（后端就绪后调用）。
pub fn navigate(window: &WebviewWindow, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|e| format!("非法 URL {url}: {e}"))?;
    window.navigate(parsed).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::NavigationDecision::{Allow, Block, OpenExternally};
    use super::*;

    const ORIGIN: &str = "http://127.0.0.1:34810";

    #[test]
    fn bundled_pages_are_allowed() {
        assert_eq!(decide_navigation("tauri://localhost/index.html", None), Allow);
        assert_eq!(decide_navigation("http://tauri.localhost/index.html", None), Allow);
    }

    #[test]
    fn own_loopback_ui_is_allowed_once_server_is_up() {
        assert_eq!(decide_navigation("http://127.0.0.1:34810/session/1", Some(ORIGIN)), Allow);
        assert_eq!(decide_navigation("http://127.0.0.1:34810/", Some(ORIGIN)), Allow);
    }

    #[test]
    fn loopback_on_other_port_is_blocked_not_opened_externally() {
        // 另一个端口的回环不是本应用的 UI：既不放行导航，也绝不交给系统浏览器。
        assert_eq!(decide_navigation("http://127.0.0.1:9999/", Some(ORIGIN)), Block);
        assert_eq!(decide_navigation("http://localhost:3000/", Some(ORIGIN)), Block);
    }

    #[test]
    fn before_server_ready_loopback_is_blocked() {
        assert_eq!(decide_navigation("http://127.0.0.1:34810/", None), Block);
    }

    #[test]
    fn external_http_goes_to_system_browser() {
        assert_eq!(decide_navigation("https://example.com/docs", Some(ORIGIN)), OpenExternally);
        assert_eq!(decide_navigation("http://example.com", None), OpenExternally);
    }

    #[test]
    fn dangerous_schemes_are_blocked() {
        assert_eq!(decide_navigation("file:///etc/passwd", Some(ORIGIN)), Block);
        assert_eq!(decide_navigation("javascript:alert(1)", Some(ORIGIN)), Block);
        assert_eq!(decide_navigation("data:text/html,x", Some(ORIGIN)), Block);
    }

    #[test]
    fn malformed_url_is_blocked() {
        assert_eq!(decide_navigation("not a url", Some(ORIGIN)), Block);
        assert_eq!(decide_navigation("", None), Block);
    }
}
