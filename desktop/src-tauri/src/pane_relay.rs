//! Pane WebView 中继（spec isolated-panes 任务 5.2，Req 9.3/9.4）。
//!
//! Rust 侧只做「instanceId+epoch 绑定 + webview 标签鉴权」的信封路由：`message` 为
//! `serde_json::Value` 原样透传，不解析、不改写协议消息。协议语义（握手、epoch 幂等、
//! 授权、错误码）全部在 TS 两端（panes-kit `adapters/tauri.ts` / `adapters/tauri-bootstrap.ts`）。
//!
//! 授权面：
//! - `pane_relay_bind` / `pane_relay_unbind` / `pane_relay_to_guest` 仅宿主主窗口可调
//!   （`allow-pane-relay-host`，挂 `capabilities/default.json`）；
//! - `pane_relay_to_host` 仅 pane webview 可调（`allow-pane-relay-guest`，挂
//!   `capabilities/panes.json` 的 `pane-*` 标签），且调用方标签必须等于绑定标签。
//!
//! epoch 规则（与 TS `createRelayPanePort` / Guest bridge 对齐）：
//! - 绑定单调：同 instanceId 以更低 epoch 重绑被拒（旧 handle 迟到的 bind 无效）；
//! - 解绑须 epoch 匹配：已被更高 epoch 重绑时，旧 handle 的 dispose 不误伤新绑定；
//! - 上行 epoch 0 = 握手前 `pane:ready`，放行（是否消费由 TS 端按绑定过滤）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, WebviewBuilder, WebviewUrl, WebviewWindowBuilder,
};
#[cfg(not(windows))]
use tauri::{LogicalPosition, LogicalSize};

use crate::native_layout::NativeWebviewLayoutManager;
use crate::window::{native_child_webviews_enabled, HOST_WEBVIEW_LABEL, MAIN_WINDOW_LABEL};

/// Rust → 宿主主窗口的上行事件名（与 panes-kit `TAURI_PANE_RELAY_HOST_EVENT` 一致）。
pub const HOST_EVENT: &str = "pane-relay-host";
/// Rust → pane webview 的下行事件名（与 panes-kit `TAURI_PANE_RELAY_GUEST_EVENT` 一致）。
pub const GUEST_EVENT: &str = "pane-relay-guest";

/// 原生 IPC 信封：只包路由标识，`message` 原样透传（Req 9.3）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEnvelope {
    pub instance_id: String,
    pub epoch: u64,
    pub message: serde_json::Value,
}

/// 稳定错误码（跨 IPC 以字符串呈现，TS 端可依码分支）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayError {
    NotHost,
    Unbound,
    StaleEpoch,
    LabelMismatch,
}

impl std::fmt::Display for RelayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            RelayError::NotHost => "PANE_RELAY_NOT_HOST",
            RelayError::Unbound => "PANE_RELAY_UNBOUND",
            RelayError::StaleEpoch => "PANE_RELAY_STALE_EPOCH",
            RelayError::LabelMismatch => "PANE_RELAY_LABEL_MISMATCH",
        })
    }
}

#[derive(Debug)]
struct Binding {
    epoch: u64,
    label: String,
}

/// 纯逻辑绑定表（不依赖 tauri 运行时，可单测）。
#[derive(Debug, Default)]
pub struct PaneRelayRegistry {
    bindings: HashMap<String, Binding>,
    bounds_revisions: HashMap<String, u64>,
    host_position: Option<(i32, i32)>,
}

impl PaneRelayRegistry {
    /// 绑定（或以不低于既有 epoch 重绑）。
    pub fn bind(&mut self, instance_id: &str, epoch: u64, label: &str) -> Result<(), RelayError> {
        if let Some(existing) = self.bindings.get(instance_id) {
            if epoch < existing.epoch {
                return Err(RelayError::StaleEpoch);
            }
        }
        self.bindings.insert(
            instance_id.to_owned(),
            Binding {
                epoch,
                label: label.to_owned(),
            },
        );
        Ok(())
    }

    /// 仅当 epoch 匹配才解绑。
    pub fn unbind(&mut self, instance_id: &str, epoch: u64) {
        if self.bindings.get(instance_id).map(|b| b.epoch) == Some(epoch) {
            self.bindings.remove(instance_id);
        }
    }

    fn accept_bounds_revision(&mut self, label: &str, revision: u64) -> bool {
        if self.bounds_revisions.get(label).is_some_and(|latest| revision <= *latest) {
            return false;
        }
        self.bounds_revisions.insert(label.to_owned(), revision);
        true
    }

    fn clear_bounds_revision(&mut self, label: &str) {
        self.bounds_revisions.remove(label);
    }

    fn record_host_position(&mut self, x: i32, y: i32) -> Option<(i32, i32)> {
        let previous = self.host_position.replace((x, y));
        previous.map(|(old_x, old_y)| (x - old_x, y - old_y))
    }

    /// 宿主 → Guest：校验绑定与 epoch，返回目标 webview 标签。
    pub fn guest_target(&self, envelope: &RelayEnvelope) -> Result<&str, RelayError> {
        let binding = self
            .bindings
            .get(&envelope.instance_id)
            .ok_or(RelayError::Unbound)?;
        if binding.epoch != envelope.epoch {
            return Err(RelayError::StaleEpoch);
        }
        Ok(&binding.label)
    }

    /// Guest → 宿主：调用方标签必须等于绑定标签；epoch 0（`pane:ready`）放行。
    pub fn accept_from_guest(
        &self,
        envelope: &RelayEnvelope,
        caller_label: &str,
    ) -> Result<(), RelayError> {
        let binding = self
            .bindings
            .get(&envelope.instance_id)
            .ok_or(RelayError::Unbound)?;
        if binding.label != caller_label {
            return Err(RelayError::LabelMismatch);
        }
        if envelope.epoch != 0 && envelope.epoch != binding.epoch {
            return Err(RelayError::StaleEpoch);
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct PaneRelayState(pub Mutex<PaneRelayRegistry>);

/// 主窗口移动时在壳层同步平移所有原生 Pane。
///
/// JS 的 getBoundingClientRect 负责槽位尺寸；但主窗移动不改变它，不能等待前端重排。
/// 此处直接按宿主物理坐标增量平移，首帧即随窗移动；后续 JS 绝对 bounds 仅作校正。
pub fn follow_host_window_moved(app: &AppHandle, x: i32, y: i32) {
    let delta = app
        .state::<PaneRelayState>()
        .0
        .lock()
        .ok()
        .and_then(|mut registry| registry.record_host_position(x, y));
    let Some((delta_x, delta_y)) = delta.filter(|(dx, dy)| *dx != 0 || *dy != 0) else {
        return;
    };
    #[cfg(windows)]
    {
        const SWP_NOZORDER: u32 = 0x0004;
        const SWP_NOACTIVATE: u32 = 0x0010;
        #[repr(C)]
        struct Rect {
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
        }
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
            fn SetWindowPos(
                hwnd: isize,
                insert_after: isize,
                x: i32,
                y: i32,
                width: i32,
                height: i32,
                flags: u32,
            ) -> i32;
        }
        for (label, view) in app.webview_windows() {
            if !label.starts_with("pane-") {
                continue;
            }
            let Ok(hwnd) = view.hwnd() else {
                continue;
            };
            let mut rect = Rect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let moved = unsafe {
                GetWindowRect(hwnd.0 as isize, &mut rect) != 0
                    && SetWindowPos(
                        hwnd.0 as isize,
                        0,
                        rect.left + delta_x,
                        rect.top + delta_y,
                        (rect.right - rect.left).max(1),
                        (rect.bottom - rect.top).max(1),
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    ) != 0
            };
            if !moved {
                eprintln!("[panes] failed to follow host move: {label}");
            }
        }
    }
}

fn require_host(label: &str) -> Result<(), String> {
    if label == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err(RelayError::NotHost.to_string())
    }
}

fn lock<'a>(
    state: &'a tauri::State<'_, PaneRelayState>,
) -> Result<std::sync::MutexGuard<'a, PaneRelayRegistry>, String> {
    state
        .0
        .lock()
        .map_err(|_| "PANE_RELAY_POISONED".to_string())
}

#[tauri::command]
pub fn pane_relay_bind(
    window: tauri::Window,
    state: tauri::State<'_, PaneRelayState>,
    instance_id: String,
    epoch: u64,
    label: String,
) -> Result<(), String> {
    require_host(window.label())?;
    lock(&state)?
        .bind(&instance_id, epoch, &label)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pane_relay_unbind(
    window: tauri::Window,
    state: tauri::State<'_, PaneRelayState>,
    instance_id: String,
    epoch: u64,
) -> Result<(), String> {
    require_host(window.label())?;
    lock(&state)?.unbind(&instance_id, epoch);
    Ok(())
}

#[tauri::command]
pub fn pane_relay_to_guest(
    window: tauri::Window,
    app: AppHandle,
    state: tauri::State<'_, PaneRelayState>,
    envelope: RelayEnvelope,
) -> Result<(), String> {
    require_host(window.label())?;
    let label = lock(&state)?
        .guest_target(&envelope)
        .map(str::to_owned)
        .map_err(|e| e.to_string())?;
    app.emit_to(label.as_str(), GUEST_EVENT, &envelope)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pane_relay_to_host(
    webview: tauri::Webview,
    app: AppHandle,
    state: tauri::State<'_, PaneRelayState>,
    envelope: RelayEnvelope,
) -> Result<(), String> {
    lock(&state)?
        .accept_from_guest(&envelope, webview.label())
        .map_err(|e| e.to_string())?;
    let target = if native_child_webviews_enabled() {
        HOST_WEBVIEW_LABEL
    } else {
        MAIN_WINDOW_LABEL
    };
    app.emit_to(target, HOST_EVENT, &envelope)
        .map_err(|e| e.to_string())
}

// child bounds 统一由 NativeWebviewLayoutManager::apply_layout 写入；勿在 create/control 里
// 再套屏幕坐标换算（易把 display:none 槽的 1×1 固化进合成层）。

fn require_pane_label(label: &str) -> Result<(), String> {
    if label.starts_with("pane-") {
        Ok(())
    } else {
        Err("PANE_WEBVIEW_INVALID_LABEL".to_string())
    }
}

#[cfg(windows)]
fn set_webview_bounds(
    view: &tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_factor: Option<f64>,
) -> Result<(), String> {
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowPos(
            hwnd: isize,
            insert_after: isize,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }
    let hwnd = view.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let scale = scale_factor
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(Ok)
        .unwrap_or_else(|| view.scale_factor().map_err(|error| error.to_string()))?;
    let ok = unsafe {
        SetWindowPos(
            hwnd,
            0,
            (x * scale).round() as i32,
            (y * scale).round() as i32,
            (width.max(1.0) * scale).round() as i32,
            (height.max(1.0) * scale).round() as i32,
            // 宿主移动/缩放时，异步排队会令子 WebView 落后一拍；命令本已在 UI 线程，
            // 同步提交可与本帧的 host rect 对齐。revision 仍会拒绝过时采样。
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn set_webview_bounds(
    view: &tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    _scale_factor: Option<f64>,
) -> Result<(), String> {
    view.set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    view.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn set_window_owner(
    view: &tauri::WebviewWindow,
    owner: &tauri::WebviewWindow,
) -> Result<(), String> {
    const GWLP_HWNDPARENT: i32 = -8;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    }
    let child = view.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let parent = owner.hwnd().map_err(|error| error.to_string())?.0 as isize;
    // SAFETY: 两个 HWND 均由当前 Tauri 进程持有，且仅改 owner 槽。
    unsafe {
        SetWindowLongPtrW(child, GWLP_HWNDPARENT, parent);
    }
    Ok(())
}

/// 隐藏全部 **content** pane（保留 webview 与 visible 记忆）；不销毁。
#[tauri::command]
pub fn pane_webview_hide_all(window: tauri::Window, app: AppHandle) -> Result<(), String> {
    require_host(window.label())?;
    if native_child_webviews_enabled() {
        let manager = app.state::<NativeWebviewLayoutManager>();
        // 仅切模式 + hide；勿写 visible=false，否则回 workspace 时全员不可见 → 白屏。
        let _ = manager.set_mode(crate::native_layout::LayoutMode::HostFullscreen);
        if let Some(host) = app.get_window(MAIN_WINDOW_LABEL) {
            for view in host.webviews() {
                let label = view.label().to_string();
                if !label.starts_with("pane-") {
                    continue;
                }
                let _ = view.hide();
            }
        }
        let _ = manager.apply_layout(&app);
        return Ok(());
    }
    for (label, view) in app.webview_windows() {
        if label.starts_with("pane-") {
            let _ = view.hide();
        }
    }
    Ok(())
}

/// 销毁全部 content pane webview（会话结束、换源、登出）。
#[tauri::command]
pub fn pane_webview_cleanup(window: tauri::Window, app: AppHandle) -> Result<(), String> {
    require_host(window.label())?;
    if native_child_webviews_enabled() {
        let manager = app.state::<NativeWebviewLayoutManager>();
        if let Some(host) = app.get_window(MAIN_WINDOW_LABEL) {
            for view in host.webviews() {
                if view.label().starts_with("pane-") {
                    let _ = view.hide();
                    let _ = manager.unregister_pane(view.label());
                    let _ = view.close();
                }
            }
        }
        let _ = manager.set_mode(crate::native_layout::LayoutMode::HostFullscreen);
        let _ = manager.apply_layout(&app);
        return Ok(());
    }
    for (label, view) in app.webview_windows() {
        if label.starts_with("pane-") {
            let _ = view.hide();
            let _ = view.close();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn pane_webview_window_create(
    window: tauri::Window,
    app: AppHandle,
    state: tauri::State<'_, PaneRelayState>,
    layout: tauri::State<'_, NativeWebviewLayoutManager>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    // 底层 pane chrome boot（tabs 边车）。宿主每次 create 传入；与页面 HTML 是否预 wrap 无关，
    // WebView2/WK 在每次导航都会再执行 initialization_script。
    chrome_boot: Option<String>,
) -> Result<(), String> {
    require_host(window.label())?;
    require_pane_label(&label)?;
    if let Ok(position) = window.outer_position() {
        let _ = lock(&state)?.record_host_position(position.x, position.y);
    }
    let url = url::Url::parse(&url).map_err(|_| "PANE_WEBVIEW_INVALID_URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("PANE_WEBVIEW_INVALID_URL".to_string());
    }
    let label_js =
        serde_json::to_string(&label).map_err(|error| error.to_string())?;
    let boot = chrome_boot.unwrap_or_default();
    let init_script = format!(
        "Object.defineProperty(window,'__PI_TAURI_PANE_LABEL__',{{value:{label_js},configurable:false}});{boot}"
    );
    if native_child_webviews_enabled() {
        #[cfg(feature = "unstable")]
        {
            let parent = app
                .get_window(MAIN_WINDOW_LABEL)
                .ok_or_else(|| "PANE_LAYOUT_HOST_NOT_FOUND".to_string())?;
            // content pane：忽略屏幕坐标，以 window+metrics 槽为准。
            let _ = (x, y, width, height);
            // 创建即进入 workspace，避免卡在 HostFullscreen 导致永远 hide。
            let _ = layout.set_mode(crate::native_layout::LayoutMode::Workspace);
            // 首建位置用当前 metrics 算槽，禁止 (0,0) 临时坐标（否则 ready 前会闪在左上）。
            let size = parent.inner_size().map_err(|e| e.to_string())?;
            let scale = parent.scale_factor().map_err(|e| e.to_string())?;
            let logical_w = f64::from(size.width) / scale.max(0.01);
            let logical_h = f64::from(size.height) / scale.max(0.01);
            // ★ 几何未知时没有可用槽（spec desktop-pane-chrome-occlusion，Req 4.1）。
            //   改动前这里必得一个矩形，且「未知」那一档正是 y=0 + 铺满全高 —— 首建即盖住
            //   chrome。现在退回一个**不遮挡**的占位：贴着右下角的最小矩形，仅用于建实例；
            //   它随即被 register_pane 记为不可见，几何到达后由 apply_layout 落到正确位置。
            let slot = layout.slot_for_window(logical_w, logical_h)?;
            let placement = slot.unwrap_or(crate::native_layout::PaneBounds {
                x: (logical_w - 1.0).max(0.0),
                y: (logical_h - 1.0).max(0.0),
                width: 1.0,
                height: 1.0,
            });
            if let Some(existing) = parent
                .webviews()
                .into_iter()
                .find(|view| view.label() == label)
            {
                // 复用实例须重新导航，否则可能停在空白页。
                existing.navigate(url).map_err(|e| e.to_string())?;
                layout.register_pane(label, placement, visible, true)?;
                let _ = layout.invalidate_applied_bounds();
                layout.apply_layout(&app)?;
                // 几何未知时不 show：那会把 pane 露在 1×1 占位上，且下一次 apply 才纠正。
                if visible && slot.is_some() {
                    let _ = existing.show();
                    let _ = existing.set_focus();
                }
                return Ok(());
            }
            let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(url.clone()))
                .initialization_script(init_script);
            let view = parent
                .add_child(
                    builder,
                    tauri::LogicalPosition::new(placement.x, placement.y),
                    tauri::LogicalSize::new(placement.width.max(1.0), placement.height.max(1.0)),
                )
                .map_err(|e| e.to_string())?;
            view.set_auto_resize(false).map_err(|e| e.to_string())?;
            // 先 register 再 layout；visible=false 时仍占位尺寸，ready 后 show 顶起。
            layout.register_pane(label.clone(), placement, visible, true)?;
            let _ = layout.invalidate_applied_bounds();
            layout.apply_layout(&app)?;
            if visible && slot.is_some() {
                view.show().map_err(|e| e.to_string())?;
                let _ = view.set_focus();
            } else {
                let _ = view.hide();
            }
            return Ok(());
        }
        #[cfg(not(feature = "unstable"))]
        return Err("PANE_NATIVE_CHILD_UNAVAILABLE".to_string());
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let build_app = app.clone();
    #[cfg(not(windows))]
    let owner_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "PANE_LAYOUT_HOST_NOT_FOUND".to_string())?;
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            if let Some(existing) = build_app.get_webview_window(&label) {
                let _ = existing.hide();
                let _ = existing.set_shadow(false);
                existing
                    .set_ignore_cursor_events(true)
                    .map_err(|error| error.to_string())?;
                set_webview_bounds(&existing, x, y, width, height, None)?;
                existing.navigate(url).map_err(|error| error.to_string())?;
                if visible {
                    existing.show().map_err(|error| error.to_string())?;
                }
                return Ok(());
            }
            // 首建即占宿主槽的最终 bounds，但 ready 前保持原生窗隐藏；
            // 免去“屏外可见窗移入槽位”的滑行动画与闪烁。
            let builder = WebviewWindowBuilder::new(&build_app, label, WebviewUrl::External(url))
                .initialization_script(init_script)
                .decorations(false)
                .shadow(false)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false)
                .visible(visible)
                .position(x, y)
                .inner_size(width.max(1.0), height.max(1.0));
            #[cfg(not(windows))]
            let builder = builder
                .parent(&owner_window)
                .map_err(|error| error.to_string())?;
            #[cfg(windows)]
            let builder = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
                Ok(args) if !args.trim().is_empty() => builder.additional_browser_args(args.trim()),
                _ => builder,
            };
            let view = builder.build().map_err(|error| error.to_string())?;
            let _ = view.set_shadow(false);
            view.set_ignore_cursor_events(true)
                .map_err(|error| error.to_string())?;
            Ok(())
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|_| "PANE_WEBVIEW_CREATE_CHANNEL_CLOSED".to_string())?
}

#[tauri::command]
pub fn pane_webview_window_control(
    window: tauri::Window,
    app: AppHandle,
    state: tauri::State<'_, PaneRelayState>,
    layout: tauri::State<'_, NativeWebviewLayoutManager>,
    label: String,
    action: String,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    scale_factor: Option<f64>,
    revision: Option<u64>,
) -> Result<(), String> {
    require_host(window.label())?;
    require_pane_label(&label)?;
    if let Ok(position) = window.outer_position() {
        let _ = lock(&state)?.record_host_position(position.x, position.y);
    }
    if native_child_webviews_enabled() {
        #[cfg(feature = "unstable")]
        {
            let parent = app
                .get_window(MAIN_WINDOW_LABEL)
                .ok_or_else(|| "PANE_LAYOUT_HOST_NOT_FOUND".to_string())?;
            let find_view = || {
                parent
                    .webviews()
                    .into_iter()
                    .find(|candidate| candidate.label() == label)
                    .ok_or_else(|| "PANE_WEBVIEW_NOT_FOUND".to_string())
            };
            return match action.as_str() {
                "show" => {
                    let view = find_view()?;
                    // 必须先退出 HostFullscreen，否则 apply_layout 会继续 hide 全部 content。
                    layout.set_mode(crate::native_layout::LayoutMode::Workspace)?;
                    layout.set_pane_visibility(&label, true)?;
                    // show 必写 bounds：丢 last_slot，避免 near 短路留下 create 时的错位。
                    layout.invalidate_applied_bounds()?;
                    layout.apply_layout(&app)?;
                    // 再顶一次 z-order（host 全窗时尤为关键）。
                    view.show().map_err(|e| e.to_string())?;
                    let _ = view.set_focus();
                    Ok(())
                }
                "hide" => {
                    let view = find_view()?;
                    // tab 切换：记 visible=false 并 hide。勿 apply_layout（会误触其它 pane 的 show 路径）。
                    // hide_all / HostFullscreen 不走此分支，不抹记忆。
                    layout.set_pane_visibility(&label, false)?;
                    let r = view.hide().map_err(|e| e.to_string());
                    crate::native_layout::force_host_redraw_for(&app);
                    r
                }
                "reload" => find_view()?.reload().map_err(|e| e.to_string()),
                "focus" => find_view()?.set_focus().map_err(|e| e.to_string()),
                "close" => {
                    let view = find_view()?;
                    let _ = view.hide();
                    let _ = layout.unregister_pane(&label);
                    let r = view.close().map_err(|e| e.to_string());
                    crate::native_layout::force_host_redraw_for(&app);
                    r
                }
                "set-bounds" => {
                    if let Some(revision) = revision {
                        if !lock(&state)?.accept_bounds_revision(&label, revision) {
                            return Ok(());
                        }
                    }
                    let view = find_view()?;
                    // content pane：忽略屏幕坐标，重算槽位。
                    let _ = (x, y, width, height, scale_factor);
                    layout.apply_layout(&app)
                }
                _ => Err("PANE_WEBVIEW_INVALID_ACTION".to_string()),
            };
        }
        #[cfg(not(feature = "unstable"))]
        return Err("PANE_NATIVE_CHILD_UNAVAILABLE".to_string());
    }
    let view = app
        .get_webview_window(&label)
        .ok_or_else(|| "PANE_WEBVIEW_NOT_FOUND".to_string())?;
    match action.as_str() {
        "show" => {
            #[cfg(windows)]
            set_window_owner(
                &view,
                &app.get_webview_window(MAIN_WINDOW_LABEL)
                    .ok_or_else(|| "PANE_LAYOUT_HOST_NOT_FOUND".to_string())?,
            )?;
            view.show().map_err(|error| error.to_string())?;
            view.set_ignore_cursor_events(false)
                .map_err(|error| error.to_string())
        }
        "hide" => {
            let _ = view.set_ignore_cursor_events(true);
            view.hide().map_err(|error| error.to_string())
        }
        "reload" => view.reload().map_err(|error| error.to_string()),
        "focus" => view.set_focus().map_err(|error| error.to_string()),
        "close" => {
            let _ = view.hide();
            view.close().map_err(|error| error.to_string())?;
            lock(&state)?.clear_bounds_revision(&label);
            Ok(())
        }
        "set-bounds" => {
            if let Some(revision) = revision {
                if !lock(&state)?.accept_bounds_revision(&label, revision) {
                    return Ok(());
                }
            }
            set_webview_bounds(
                &view,
                x.ok_or_else(|| "PANE_WEBVIEW_INVALID_BOUNDS".to_string())?,
                y.ok_or_else(|| "PANE_WEBVIEW_INVALID_BOUNDS".to_string())?,
                width.ok_or_else(|| "PANE_WEBVIEW_INVALID_BOUNDS".to_string())?,
                height.ok_or_else(|| "PANE_WEBVIEW_INVALID_BOUNDS".to_string())?,
                scale_factor,
            )
        }
        _ => return Err("PANE_WEBVIEW_INVALID_ACTION".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(instance_id: &str, epoch: u64) -> RelayEnvelope {
        RelayEnvelope {
            instance_id: instance_id.into(),
            epoch,
            message: serde_json::json!({ "type": "pane:lifecycle", "state": "visible" }),
        }
    }

    #[test]
    fn bind_is_epoch_monotonic_and_rebind_replaces_label() {
        let mut reg = PaneRelayRegistry::default();
        reg.bind("editor-1", 1, "pane-editor-1").unwrap();
        // 旧 handle 迟到的低 epoch 绑定被拒。
        assert_eq!(
            reg.bind("editor-1", 0, "pane-x"),
            Err(RelayError::StaleEpoch)
        );
        // reload：更高 epoch 重绑生效。
        reg.bind("editor-1", 2, "pane-editor-1").unwrap();
        assert_eq!(
            reg.guest_target(&envelope("editor-1", 2)).unwrap(),
            "pane-editor-1"
        );
        assert_eq!(
            reg.guest_target(&envelope("editor-1", 1)),
            Err(RelayError::StaleEpoch)
        );
    }

    #[test]
    fn unbind_requires_matching_epoch() {
        let mut reg = PaneRelayRegistry::default();
        reg.bind("editor-1", 2, "pane-editor-1").unwrap();
        // 旧 handle（epoch 1）的 dispose 不得误伤新绑定。
        reg.unbind("editor-1", 1);
        assert!(reg.guest_target(&envelope("editor-1", 2)).is_ok());
        reg.unbind("editor-1", 2);
        assert_eq!(
            reg.guest_target(&envelope("editor-1", 2)),
            Err(RelayError::Unbound)
        );
    }

    #[test]
    fn guest_uplink_enforces_label_and_epoch() {
        let mut reg = PaneRelayRegistry::default();
        reg.bind("editor-1", 3, "pane-editor-1").unwrap();
        assert!(reg
            .accept_from_guest(&envelope("editor-1", 3), "pane-editor-1")
            .is_ok());
        // 握手前 pane:ready（epoch 0）放行。
        assert!(reg
            .accept_from_guest(&envelope("editor-1", 0), "pane-editor-1")
            .is_ok());
        // 他人 webview 冒名被拒；旧 epoch 被拒；未绑定被拒。
        assert_eq!(
            reg.accept_from_guest(&envelope("editor-1", 3), "pane-other"),
            Err(RelayError::LabelMismatch)
        );
        assert_eq!(
            reg.accept_from_guest(&envelope("editor-1", 2), "pane-editor-1"),
            Err(RelayError::StaleEpoch)
        );
        assert_eq!(
            reg.accept_from_guest(&envelope("ghost", 1), "pane-ghost"),
            Err(RelayError::Unbound)
        );
    }

    #[test]
    fn bounds_revision_rejects_late_updates() {
        let mut reg = PaneRelayRegistry::default();
        assert!(reg.accept_bounds_revision("pane-editor-1", 1));
        assert!(!reg.accept_bounds_revision("pane-editor-1", 1));
        assert!(reg.accept_bounds_revision("pane-editor-1", 3));
        assert!(!reg.accept_bounds_revision("pane-editor-1", 2));
        reg.clear_bounds_revision("pane-editor-1");
        assert!(reg.accept_bounds_revision("pane-editor-1", 1));
    }

    #[test]
    fn host_move_reports_physical_delta_after_initial_position() {
        let mut reg = PaneRelayRegistry::default();
        assert_eq!(reg.record_host_position(100, 200), None);
        assert_eq!(reg.record_host_position(132, 184), Some((32, -16)));
    }

    #[test]
    fn envelope_roundtrips_message_verbatim_in_camel_case() {
        // Req 9.3：中继不解析、不改写。序列化字段名与 TS 信封（camelCase）逐字一致。
        let src = serde_json::json!({
            "instanceId": "editor-1",
            "epoch": 2,
            "message": { "type": "pane:result", "requestId": "editor-1:9", "ok": true, "data": { "深": [1, 2, 3] } }
        });
        let parsed: RelayEnvelope = serde_json::from_value(src.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), src);
    }

    /// 静态声明一致性（仿 `credential_acl_identifiers_are_declared_and_capability_wired`）：
    /// 真正的运行期 ACL 需要真实 webview，`cargo test` 进程内无宿主环境；此处锁定
    /// permission 声明与两份 capability 的挂载不漂移。
    #[test]
    fn pane_relay_acl_identifiers_are_declared_and_capabilities_wired() {
        let toml_src = include_str!("../permissions/pane-relay.toml");
        for identifier in ["allow-pane-relay-host", "allow-pane-relay-guest"] {
            assert!(
                toml_src.contains(&format!("identifier = \"{identifier}\"")),
                "permissions/pane-relay.toml 应声明 {identifier}"
            );
        }
        for cmd in [
            "pane_relay_bind",
            "pane_relay_unbind",
            "pane_relay_to_guest",
            "pane_relay_to_host",
            "pane_webview_hide_all",
            "pane_webview_cleanup",
            "pane_webview_window_create",
            "pane_webview_window_control",
            "pane_layout_set_mode",
            "pane_layout_set_metrics",
            "pane_layout_is_native",
            "pane_layout_debug_state",
        ] {
            assert!(
                toml_src.contains(cmd),
                "permissions/pane-relay.toml 应在某条 permission 的 commands.allow 中列出 {cmd}"
            );
        }

        let perms_of = |src: &str| -> Vec<String> {
            let cap: serde_json::Value =
                serde_json::from_str(src).expect("capability 应是合法 JSON");
            cap["permissions"]
                .as_array()
                .expect("capability 应含 permissions 数组")
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        };
        // 宿主主窗口:host 侧命令。
        let default_perms = perms_of(include_str!("../capabilities/default.json"));
        assert!(default_perms.contains(&"allow-pane-relay-host".to_string()));
        assert!(!default_perms.contains(&"allow-pane-relay-guest".to_string()));
        // pane webview:仅上行 + 事件监听,不得拿到 host 侧命令。
        let panes_cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/panes.json")).unwrap();
        assert_eq!(panes_cap["webviews"], serde_json::json!(["pane-*"]));
        let panes_perms = perms_of(include_str!("../capabilities/panes.json"));
        assert!(panes_perms.contains(&"allow-pane-relay-guest".to_string()));
        assert!(panes_perms.contains(&"core:event:allow-listen".to_string()));
        assert!(!panes_perms.contains(&"allow-pane-relay-host".to_string()));
    }
}
