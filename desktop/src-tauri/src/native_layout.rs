//! 单窗口多 Webview 原生布局管理。
//!
//! 该模块只管理载体：矩形、可见性、保活与销毁；不认识 AIGC/素材等业务词。
//! 通过 `PI_WEB_NATIVE_CHILD_WEBVIEWS=1` 开启，旧顶层 WebviewWindow 载体仍可回退。

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Position, Rect, Size, State, Window};

use crate::window::{native_child_webviews_enabled, HOST_WEBVIEW_LABEL, MAIN_WINDOW_LABEL};

pub const WORKSPACE_MODE: &str = "workspace";
pub const HOST_FULLSCREEN_MODE: &str = "host-fullscreen";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutMode {
    Workspace,
    HostFullscreen,
}

impl Default for LayoutMode {
    fn default() -> Self {
        Self::Workspace
    }
}

impl LayoutMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            WORKSPACE_MODE => Ok(Self::Workspace),
            HOST_FULLSCREEN_MODE => Ok(Self::HostFullscreen),
            _ => Err("PANE_LAYOUT_INVALID_MODE".to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutMetrics {
    /// 内容井顶边相对窗口 client 顶（下方留给 Pane content；上方留给 tabs 等 chrome）。
    pub top_height: f64,
    /// 内容井左缘（宿主 chat + resize 在其左）。
    pub left_width: Option<f64>,
    /// 内容井宽度；缺省时用 pane_ratio 或默认 0.34。
    pub pane_width: Option<f64>,
    pub pane_ratio: Option<f64>,
    /// 内容井底边距窗口底的间隙（状态栏等）；0 表示贴底。
    pub bottom_height: f64,
    pub min_width: f64,
    pub scale_factor: Option<f64>,
}

impl Default for LayoutMetrics {
    fn default() -> Self {
        Self {
            top_height: 0.0,
            left_width: None,
            pane_width: None,
            pane_ratio: Some(0.34),
            bottom_height: 0.0,
            min_width: 280.0,
            scale_factor: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct PaneBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
struct PaneRecord {
    bounds: PaneBounds,
    visible: bool,
    keep_alive: bool,
    initialized: bool,
    last_active: u64,
    /// 上一次 apply 是否已对句柄 show；用于 metrics 跟手时跳过重复 show/focus。
    applied_visible: bool,
}

#[derive(Debug, Default)]
struct LayoutState {
    mode: LayoutMode,
    metrics: LayoutMetrics,
    panes: HashMap<String, PaneRecord>,
    active_tick: u64,
    /// 上次成功下发的 host / 槽矩形；未变则跳过 set_bounds。
    last_host_bounds: Option<PaneBounds>,
    last_slot_bounds: Option<PaneBounds>,
    last_top_label: Option<String>,
}

/// 逻辑像素近似相等（侧栏拖拽亚像素抖动不重下发）。
fn bounds_near(a: PaneBounds, b: PaneBounds) -> bool {
    (a.x - b.x).abs() < 0.5
        && (a.y - b.y).abs() < 0.5
        && (a.width - b.width).abs() < 0.5
        && (a.height - b.height).abs() < 0.5
}

/// 受控的原生布局状态；真实 Webview 句柄仍由 Tauri manager 持有。
#[derive(Debug, Default)]
pub struct NativeWebviewLayoutManager(Mutex<LayoutState>);

impl NativeWebviewLayoutManager {
    pub fn set_mode(&self, mode: LayoutMode) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        // 只改模式。HostFullscreen 时 apply_layout 会 hide 全部 content pane，
        // 但不得抹掉 visible 记忆——侧栏再开 workspace 时才能按原可见性恢复，否则白屏。
        state.mode = mode;
        Ok(())
    }

    pub fn set_metrics(&self, metrics: LayoutMetrics) -> Result<(), String> {
        if !metrics.top_height.is_finite()
            || metrics.top_height < 0.0
            || !metrics.min_width.is_finite()
            || metrics.min_width < 1.0
        {
            return Err("PANE_LAYOUT_INVALID_METRICS".to_string());
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        state.metrics = metrics;
        // 仅槽几何变：只作废 last_slot。勿清 last_host——拖拽每帧 host set_bounds 极重、不跟手。
        state.last_slot_bounds = None;
        Ok(())
    }

    /// show 前调用：丢掉 last_slot，保证 apply 一定写 child bounds。
    pub fn invalidate_applied_bounds(&self) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        state.last_slot_bounds = None;
        state.last_host_bounds = None;
        Ok(())
    }

    /// 公开算槽（create 首建位置用，避免 (0,0) 临时坐标）。
    pub fn slot_for_window(
        &self,
        window_width: f64,
        window_height: f64,
    ) -> Result<PaneBounds, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        let (_host, mut slot) = Self::calculate_bounds(
            state.mode,
            state.metrics,
            window_width,
            window_height,
        );
        if state.mode == LayoutMode::Workspace && (slot.width < 48.0 || slot.height < 48.0) {
            let fallback_w = (window_width * 0.34).max(280.0).min(window_width.max(1.0));
            slot = PaneBounds {
                x: (window_width - fallback_w).max(0.0),
                y: 0.0,
                width: fallback_w,
                height: window_height.max(1.0),
            };
        }
        Ok(slot)
    }

    pub fn register_pane(
        &self,
        label: String,
        bounds: PaneBounds,
        visible: bool,
        keep_alive: bool,
    ) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        state.active_tick = state.active_tick.saturating_add(1);
        let tick = state.active_tick;
        state.panes.insert(
            label,
            PaneRecord {
                bounds,
                visible,
                keep_alive,
                initialized: true,
                last_active: tick,
                applied_visible: false,
            },
        );
        Ok(())
    }

    pub fn set_pane_visibility(&self, label: &str, visible: bool) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        if visible {
            state.active_tick = state.active_tick.saturating_add(1);
        }
        let tick = state.active_tick;
        // hide_all 时可能尚未 register；静默忽略缺失项。
        let Some(pane) = state.panes.get_mut(label) else {
            return Ok(());
        };
        pane.visible = visible;
        pane.last_active = tick;
        // control hide/show 可能绕过 apply；标脏使下次 apply 强制对齐可见性。
        pane.applied_visible = !visible;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn set_pane_bounds(&self, label: &str, bounds: PaneBounds) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        let pane = state
            .panes
            .get_mut(label)
            .ok_or_else(|| "PANE_WEBVIEW_NOT_FOUND".to_string())?;
        pane.bounds = bounds;
        Ok(())
    }

    pub fn unregister_pane(&self, label: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?
            .panes
            .remove(label);
        Ok(())
    }

    fn calculate_bounds(
        mode: LayoutMode,
        metrics: LayoutMetrics,
        window_width: f64,
        window_height: f64,
    ) -> (PaneBounds, PaneBounds) {
        let width = window_width.max(1.0);
        let height = window_height.max(1.0);
        // 宿主始终铺满窗口：tabs / resize / chat 仍在 host WebView 内可点。
        // Pane child 只盖 content-well 矩形（left/top/width/bottom 由前端量槽上报）。
        let host_full = PaneBounds {
            x: 0.0,
            y: 0.0,
            width,
            height,
        };
        if mode == LayoutMode::HostFullscreen {
            return (host_full, PaneBounds::default());
        }
        let minimum = metrics.min_width.max(1.0);
        // 优先用前端 content-well 实测的 left/width；否则 ratio 回落。
        let requested = metrics
            .pane_width
            .or_else(|| metrics.pane_ratio.map(|ratio| width * ratio))
            .unwrap_or(width * 0.34)
            .max(minimum)
            .min((width - minimum).max(1.0));
        let pane_x = metrics
            .left_width
            .unwrap_or((width - requested).max(0.0))
            .clamp(0.0, (width - 1.0).max(0.0));
        let pane_w = metrics
            .pane_width
            .unwrap_or(requested)
            .clamp(1.0, (width - pane_x).max(1.0));
        let pane_y = metrics.top_height.clamp(0.0, height);
        let bottom = metrics.bottom_height.clamp(0.0, (height - pane_y).max(0.0));
        let pane_height = (height - pane_y - bottom).max(1.0);
        (
            host_full,
            PaneBounds {
                x: pane_x,
                y: pane_y,
                width: pane_w,
                height: pane_height,
            },
        )
    }

    /// 原子地把宿主与所有 child panes 应用到同一窗口 client 坐标系。
    ///
    /// 侧栏拖拽时 metrics 每帧都到；几何未变跳过 set_bounds，可见性未变跳过 show/focus，
    /// 避免「每帧 show+set_focus」抢 z-order 造成过度插帧感。
    pub fn apply_layout(&self, app: &AppHandle) -> Result<(), String> {
        if !native_child_webviews_enabled() {
            return Ok(());
        }
        let window = app
            .get_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "PANE_LAYOUT_HOST_NOT_FOUND".to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let (mode, metrics, panes, last_host, last_slot, last_top) = {
            let state = self
                .0
                .lock()
                .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
            (
                state.mode,
                state.metrics,
                state
                    .panes
                    .iter()
                    .map(|(label, pane)| {
                        (
                            label.clone(),
                            pane.visible,
                            pane.keep_alive,
                            pane.initialized,
                            pane.applied_visible,
                        )
                    })
                    .collect::<Vec<_>>(),
                state.last_host_bounds,
                state.last_slot_bounds,
                state.last_top_label.clone(),
            )
        };
        let logical_width = f64::from(size.width) / scale.max(0.01);
        let logical_height = f64::from(size.height) / scale.max(0.01);
        let (host_bounds, pane_bounds) = Self::calculate_bounds(
            mode,
            metrics,
            logical_width,
            logical_height,
        );
        let webviews = window.webviews();
        let host_changed = last_host.map(|b| !bounds_near(b, host_bounds)).unwrap_or(true);
        if let Some(host) = webviews.iter().find(|view| view.label() == HOST_WEBVIEW_LABEL) {
            // host 铺满供 chat/tabs；仅尺寸/位置变化时 set_bounds。
            if host_changed {
                host.set_bounds(to_rect(host_bounds))
                    .map_err(|e| e.to_string())?;
            }
            if mode == LayoutMode::HostFullscreen {
                host.show().map_err(|e| e.to_string())?;
                host.set_focus().map_err(|e| e.to_string())?;
            }
        }
        // metrics 尚未上报时 pane 槽可能过小 → 回落右栏默认，避免 1×1 白屏。
        let mut slot = pane_bounds;
        if mode == LayoutMode::Workspace && (slot.width < 48.0 || slot.height < 48.0) {
            let fallback_w = (logical_width * 0.34).max(280.0).min(logical_width.max(1.0));
            slot = PaneBounds {
                x: (logical_width - fallback_w).max(0.0),
                y: 0.0,
                width: fallback_w,
                height: logical_height.max(1.0),
            };
        }
        let slot_changed = last_slot.map(|b| !bounds_near(b, slot)).unwrap_or(true);
        // Pane 共享右侧槽；仅槽变时 set_bounds，仅可见性/z-order 需要时 show+focus。
        let mut top_label: Option<String> = None;
        let mut raise_top = host_changed;
        let mut applied_visibility: Vec<(String, bool)> = Vec::new();
        for (label, recorded_visible, keep_alive, initialized, was_applied_visible) in panes {
            if label.starts_with("pane-overlay") {
                continue;
            }
            let Some(view) = webviews.iter().find(|view| view.label() == label) else {
                continue;
            };
            if !initialized && !keep_alive {
                continue;
            }
            if mode == LayoutMode::HostFullscreen {
                // 全屏宿主：内容 pane 一律 hide。勿因 applied_visible 跳过——
                // 外部 show 路径可能已把句柄露出而状态未同步。
                let _ = view.hide();
                applied_visibility.push((label, false));
                continue;
            }
            if slot_changed {
                view.set_bounds(to_rect(slot))
                    .map_err(|e| e.to_string())?;
            }
            if recorded_visible {
                if !was_applied_visible {
                    view.show().map_err(|e| e.to_string())?;
                    raise_top = true;
                }
                top_label = Some(label.clone());
                applied_visibility.push((label, true));
            } else {
                if was_applied_visible {
                    view.hide().map_err(|e| e.to_string())?;
                }
                applied_visibility.push((label, false));
            }
        }
        // host 几何变过或 top 切换时再 focus，防止 host set_bounds 盖住 child。
        // 纯 metrics 跟手（槽宽变、可见性不变）不抢 focus。
        if top_label.as_ref() != last_top.as_ref() {
            raise_top = true;
        }
        let overlay_top = crate::pane_relay::overlay_wants_top();
        if raise_top {
            if let Some(label) = top_label.as_ref() {
                if let Some(view) = webviews.iter().find(|view| view.label() == label) {
                    let _ = view.show();
                    // 菜单在顶时 content 只 show 不 focus，避免抢焦关菜单。
                    if !overlay_top {
                        let _ = view.set_focus();
                    }
                }
            }
        }
        // 菜单 overlay 打开时：content set_bounds/show 可能抢 z，最后再抬 overlay。
        // content **保持 show**，只调整叠放，绝不 hide content 去「让路」。
        if overlay_top {
            for view in &webviews {
                let label = view.label();
                if label.starts_with("pane-overlay") {
                    let _ = view.show();
                    let _ = view.set_focus();
                }
            }
        }
        let mut state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        state.last_host_bounds = Some(host_bounds);
        state.last_slot_bounds = Some(slot);
        state.last_top_label = top_label;
        for (label, applied) in applied_visibility {
            if let Some(pane) = state.panes.get_mut(&label) {
                pane.applied_visible = applied;
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn calculate_for_test(
        mode: LayoutMode,
        metrics: LayoutMetrics,
        width: f64,
        height: f64,
    ) -> (PaneBounds, PaneBounds) {
        Self::calculate_bounds(mode, metrics, width, height)
    }
}

fn to_rect(bounds: PaneBounds) -> Rect {
    Rect {
        position: Position::Logical(tauri::LogicalPosition::new(bounds.x, bounds.y)),
        size: Size::Logical(tauri::LogicalSize::new(
            bounds.width.max(1.0),
            bounds.height.max(1.0),
        )),
    }
}

#[tauri::command]
pub fn pane_layout_set_mode(
    window: Window,
    app: AppHandle,
    manager: State<'_, NativeWebviewLayoutManager>,
    mode: String,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PANE_RELAY_NOT_HOST".to_string());
    }
    manager.set_mode(LayoutMode::parse(&mode)?)?;
    manager.apply_layout(&app)
}

#[tauri::command]
pub fn pane_layout_set_metrics(
    window: Window,
    app: AppHandle,
    manager: State<'_, NativeWebviewLayoutManager>,
    metrics: LayoutMetrics,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PANE_RELAY_NOT_HOST".to_string());
    }
    manager.set_metrics(metrics)?;
    manager.apply_layout(&app)
}

#[tauri::command]
pub fn pane_layout_is_native(window: Window) -> Result<bool, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PANE_RELAY_NOT_HOST".to_string());
    }
    Ok(native_child_webviews_enabled())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_host_stays_full_window() {
        let metrics = LayoutMetrics {
            left_width: Some(600.0),
            top_height: 36.0,
            pane_width: Some(400.0),
            bottom_height: 0.0,
            min_width: 240.0,
            ..Default::default()
        };
        let (host, pane) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::Workspace,
            metrics,
            1000.0,
            600.0,
        );
        // 宿主铺满，tabs/resize 仍在 host WebView。
        assert_eq!(host, PaneBounds { x: 0.0, y: 0.0, width: 1000.0, height: 600.0 });
        assert_eq!(pane.x, 600.0);
        assert_eq!(pane.y, 36.0);
        assert_eq!(pane.width, 400.0);
        assert_eq!(pane.height, 564.0);
    }

    #[test]
    fn host_fullscreen_hides_pane_region() {
        let (host, pane) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::HostFullscreen,
            LayoutMetrics::default(),
            900.0,
            700.0,
        );
        assert_eq!(host, PaneBounds { x: 0.0, y: 0.0, width: 900.0, height: 700.0 });
        assert_eq!(pane, PaneBounds::default());
    }

    #[test]
    fn content_well_bottom_inset_shrinks_pane_height() {
        let metrics = LayoutMetrics {
            left_width: Some(500.0),
            top_height: 40.0,
            pane_width: Some(480.0),
            bottom_height: 24.0,
            min_width: 240.0,
            ..Default::default()
        };
        let (_host, pane) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::Workspace,
            metrics,
            1000.0,
            800.0,
        );
        assert_eq!(pane.height, 800.0 - 40.0 - 24.0);
    }
}
