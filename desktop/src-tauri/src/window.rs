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
use tauri::{
    AppHandle, Manager, WebviewBuilder, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowBuilder,
};
use tauri_plugin_opener::OpenerExt;
use url::Url;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const HOST_WEBVIEW_LABEL: &str = "main-host";

/// Child WebView 为默认载体；仅显式关闭时回退旧浮层，供故障排查。
///
/// ## ★ 不要试图用这个开关「修好」pane
///
/// - **原生 child WebView（默认）**：chrome 曾恒空白不可点——根因是宿主 WKWebView
///   不重绘被 child 让开的区域（几何/句柄/NSView/hitTest/DOM 六路候选全被机械证据排除）。
///   `native_layout` 在槽变化后调 `view_tree::force_host_redraw`（方案 A）后，已经真机
///   三判据验证：chrome 与 pane 内容同帧可见且可点。见 spec
///   `desktop-native-webview-chrome-dead` 的 design.md「判定」节。
/// - **旧浮层（`=0`）**：pane 内容不是 iframe，而是**独立顶层 WebviewWindow**，位置由
///   「宿主窗口屏幕坐标 + DOM 槽矩形」算出。真机实测会飘到屏幕角落（用户报「奇怪的悬浮块」），
///   表现为「tab 点了打不开面板」——其实开了，只是开到别处。**此缺陷未修**，该形态
///   仅供故障排查，不要当规避手段。
///
/// 曾经把默认值翻到 `=0` 试图规避前者，**是错的**：那只是换了个坏法。已改回。
pub fn native_child_webviews_enabled() -> bool {
    !matches!(
        std::env::var("PI_WEB_NATIVE_CHILD_WEBVIEWS")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("0" | "false" | "no" | "off")
    )
}

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
    // iframe 载体的 pane 文档：`srcdoc` 的内容由**父文档**（即我们自己的页面）提供，
    // 不涉及任何外部来源，必须放行。
    //
    // ★ 实测踩过：桌面版切到 iframe 载体后，日志里刷 `[desktop] 拒绝导航: about:srcdoc`，
    //   表现是「tab 栏在、点了也打不开面板」—— pane 文档从未加载。因为 wry 的
    //   `on_navigation` 对**子框架**的导航同样回调，而这里此前只认 tauri:// 与回环 origin，
    //   about: 一律落到外链判定被 Deny。
    //   `about:blank` 同理（iframe 的初始文档），放行不引入任何外部内容。
    if raw_url == "about:srcdoc" || raw_url == "about:blank" {
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
    let builder =
        WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("pi-web")
        .inner_size(1200.0, 800.0)
        .background_color(tauri::window::Color(0x0b, 0x0b, 0x0c, 0xff));
    #[cfg(windows)]
    let builder = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        Ok(args) if !args.trim().is_empty() => builder.additional_browser_args(args.trim()),
        _ => builder,
    };
    builder
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

/// 以无 Webview 原生 Window 承载 host child Webview。
#[cfg(feature = "unstable")]
pub fn create_native_main_window(
    app: &AppHandle,
    server_origin: ServerOrigin,
) -> tauri::Result<()> {
    let handle = app.clone();
    let window = WindowBuilder::new(app, MAIN_WINDOW_LABEL)
        .title("pi-web")
        .inner_size(1200.0, 800.0)
        .build()?;
    let builder = WebviewBuilder::new(HOST_WEBVIEW_LABEL, WebviewUrl::App("index.html".into()))
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
        });
    let host = window.add_child(
        builder,
        tauri::LogicalPosition::new(0.0, 0.0),
        tauri::LogicalSize::new(1200.0, 800.0),
    )?;
    host.set_auto_resize(false)?;
    Ok(())
}

pub fn create_main_window_for_runtime(
    app: &AppHandle,
    server_origin: ServerOrigin,
) -> tauri::Result<()> {
    if native_child_webviews_enabled() {
        #[cfg(feature = "unstable")]
        {
            return create_native_main_window(app, server_origin);
        }
        #[cfg(not(feature = "unstable"))]
        {
            eprintln!("[desktop] child Webview feature unavailable; fallback to WebviewWindow");
        }
    }
    create_main_window(app, server_origin).map(|_| ())
}

/// 取主窗口（可能已被关闭）。
pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

pub fn main_window_exists(app: &AppHandle) -> bool {
    if native_child_webviews_enabled() {
        app.get_window(MAIN_WINDOW_LABEL).is_some()
    } else {
        main_window(app).is_some()
    }
}

/// 导航到指定 URL（后端就绪后调用）。
pub fn navigate(window: &WebviewWindow, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|e| format!("非法 URL {url}: {e}"))?;
    window.navigate(parsed).map_err(|e| e.to_string())
}

pub fn navigate_for_runtime(app: &AppHandle, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|e| format!("非法 URL {url}: {e}"))?;
    if native_child_webviews_enabled() {
        let host = app
            .get_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "主窗口不存在".to_string())?
            .webviews()
            .into_iter()
            .find(|view| view.label() == HOST_WEBVIEW_LABEL)
            .ok_or_else(|| "宿主 Webview 不存在".to_string())?;
        host.navigate(parsed).map_err(|e| e.to_string())
    } else {
        let window = main_window(app).ok_or_else(|| "主窗口不存在".to_string())?;
        navigate(&window, url)
    }
}

#[cfg(test)]
mod tests {
    use super::NavigationDecision::{Allow, Block, OpenExternally};
    use super::*;

    const ORIGIN: &str = "http://127.0.0.1:34810";

    #[test]
    fn iframe_srcdoc_and_blank_are_allowed() {
        // ★ 这条锁的是一个真机故障：切到 iframe 载体后 pane 文档走 about:srcdoc 加载，
        //   而 wry 的 on_navigation 对子框架同样回调 —— 此前被判 Block，表现为
        //   「tab 栏在、点了也打不开面板」，日志里刷 `拒绝导航: about:srcdoc`。
        assert_eq!(decide_navigation("about:srcdoc", None), Allow);
        assert_eq!(decide_navigation("about:blank", Some(ORIGIN)), Allow);
        // 放行只限这两个字面量：其余 about: 仍按原规则拒绝，别把整个 scheme 开成白名单。
        assert_eq!(decide_navigation("about:config", None), Block);
        assert_eq!(decide_navigation("about:srcdoc#x", None), Block);
    }

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
