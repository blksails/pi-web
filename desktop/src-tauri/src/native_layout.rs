//! 单窗口多 Webview 原生布局管理。
//!
//! 该模块只管理载体：矩形、可见性、保活与销毁；不认识 AIGC/素材等业务词。
//! 默认启用；`PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 回退旧顶层 WebviewWindow 载体（两者当前
//! 都有已知缺陷，见 `window.rs::native_child_webviews_enabled` 的注释）。

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

/// 内容槽的解算结果。
///
/// ★ `Hidden` 与「一个宽高为零的矩形」不是一回事：后者仍会被落位流程当成矩形去 `set_bounds`
///   并 `show`，而前者明确表示「此刻没有可显示的内容槽」，调用方**不得**回落到任何默认矩形。
///   本缺陷的成因正是「信息不足」被表达成了一个具体的值（0.0），而那个值恰好是最坏的。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ContentSlot {
    /// 几何已知且可显示；矩形保证落在 chrome 之下。
    Visible(PaneBounds),
    /// 几何未知，或模式要求隐藏。
    Hidden,
}

impl ContentSlot {
    fn bounds(self) -> Option<PaneBounds> {
        match self {
            Self::Visible(b) => Some(b),
            Self::Hidden => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutMetrics {
    /// 内容井顶边相对窗口 client 顶（下方留给 Pane content；上方留给 tabs 等 chrome）。
    ///
    /// ★ `None` = 宿主尚未量得，**不是** 0。与同结构体的 `left_width` / `pane_width` 语义对齐。
    ///   `#[serde(default)]` 对 `Option` 产出 `None`，故载荷缺该字段时不会被悄悄补成 `Some(0.0)`。
    pub top_height: Option<f64>,
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
            top_height: None,
            left_width: None,
            pane_width: None,
            pane_ratio: Some(0.34),
            bottom_height: 0.0,
            min_width: 280.0,
            scale_factor: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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
    ///
    /// ★ `last_slot_bounds` 的外层 `Option` 表示「本轮之前是否记录过」（`None` 由
    ///   `invalidate_applied_bounds` 置入以强制重下发），内层 `ContentSlot` 才表示
    ///   「当时是否有可显示的槽」。两个含义必须分开——把它们压进同一个 `None`，
    ///   正是本 spec 要消除的那类错误。
    last_host_bounds: Option<PaneBounds>,
    last_slot_bounds: Option<ContentSlot>,
    last_top_label: Option<String>,
}

/// 槽位诊断开关（Req 3.5：不重新编译即可开启）。
pub fn pane_layout_debug_enabled() -> bool {
    matches!(
        std::env::var("PI_WEB_PANE_LAYOUT_DEBUG").ok().as_deref().map(str::trim),
        Some("1" | "true" | "yes" | "on")
    )
}

/// 逻辑像素近似相等（侧栏拖拽亚像素抖动不重下发）。
fn bounds_near(a: PaneBounds, b: PaneBounds) -> bool {
    (a.x - b.x).abs() < 0.5
        && (a.y - b.y).abs() < 0.5
        && (a.width - b.width).abs() < 0.5
        && (a.height - b.height).abs() < 0.5
}

/// 方案 A 的手动触发口（spec desktop-native-webview-chrome-dead）：
/// pane_relay 的 hide / close / overlay 转换不经 `apply_layout`，但宿主 tab 带的
/// 像素已经变了；WKWebView 不会自动把被 child 让开的区域标脏，须同样强制重绘。
#[cfg(target_os = "macos")]
pub fn force_host_redraw_for(app: &AppHandle) {
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        if let Ok(ptr) = window.ns_window() {
            let _ = unsafe { crate::view_tree::force_host_redraw(ptr) };
        }
    }
}
#[cfg(not(target_os = "macos"))]
pub fn force_host_redraw_for(_app: &AppHandle) {}

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
        // 顶边缺席是合法的（表示「尚未量得」）；给了值就必须是有限非负数。
        let top_invalid = metrics
            .top_height
            .is_some_and(|t| !t.is_finite() || t < 0.0);
        if top_invalid || !metrics.min_width.is_finite() || metrics.min_width < 1.0 {
            // ★ 留痕（spec desktop-pane-chrome-occlusion，Req 3.3）：原实现只返回 Err，
            //   而前端的上报调用没有 catch —— 拒绝作为未处理的异步拒绝逃逸，两侧都看不见。
            //   结果是布局侧继续用旧值/默认值，pane 停在盖住 chrome 的矩形上，且无处可查。
            eprintln!(
                "[panes] 拒绝几何上报 PANE_LAYOUT_INVALID_METRICS: top_height={:?} min_width={} \
                 left_width={:?} pane_width={:?} bottom_height={}",
                metrics.top_height,
                metrics.min_width,
                metrics.left_width,
                metrics.pane_width,
                metrics.bottom_height,
            );
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

    /// 只读快照，供 `pane_layout_debug_state` 命令使用（Req 3.4）。
    pub fn debug_state(
        &self,
        window_width: f64,
        window_height: f64,
    ) -> Result<LayoutDebugState, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        let (_host, slot) = Self::calculate_bounds(
            state.mode,
            state.metrics,
            window_width,
            window_height,
        );
        Ok(LayoutDebugState {
            mode: match state.mode {
                LayoutMode::Workspace => WORKSPACE_MODE,
                LayoutMode::HostFullscreen => HOST_FULLSCREEN_MODE,
            },
            metrics: state.metrics,
            // `None` 表示「此刻没有可显示的内容槽」——零矩形会被误读成「算出来是 0」。
            content_slot: slot.bounds(),
            window_width,
            window_height,
            native_enabled: native_child_webviews_enabled(),
            pane_count: state.panes.len(),
        })
    }

    /// 公开算槽（create 首建位置用，避免 (0,0) 临时坐标）。
    pub fn slot_for_window(
        &self,
        window_width: f64,
        window_height: f64,
    ) -> Result<Option<PaneBounds>, String> {
        let state = self
            .0
            .lock()
            .map_err(|_| "PANE_LAYOUT_STATE_POISONED".to_string())?;
        let (_host, slot) = Self::calculate_bounds(
            state.mode,
            state.metrics,
            window_width,
            window_height,
        );
        // ★ 已删除「槽过小则回落到从窗口顶端铺满」的兜底（原 y: 0.0 + 全高）。
        //   那个兜底与 `apply_layout` 里的同名副本、以及默认 metrics 走正常算式的结果，
        //   三者产出的是同一个必然盖住 chrome 的矩形。现在「未知」由 ContentSlot::Hidden
        //   承载，首建时不给矩形；几何到达后 apply_layout 会补上落位。
        Ok(slot.bounds())
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
    ) -> (PaneBounds, ContentSlot) {
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
            return (host_full, ContentSlot::Hidden);
        }
        // ★ 顶边未知即不产出可显示的内容槽（spec desktop-pane-chrome-occlusion，Req 2.1/2.5）。
        //
        //   改动前这里是 `metrics.top_height.clamp(...)`，而 top_height 缺省为 0.0 ——
        //   于是「几何还没上报」与「chrome 高度真的是 0」不可区分，两者都算出 y=0、高度铺满，
        //   恰好盖住 tab 栏，用户随即失去切换 pane 的唯一入口。
        //
        //   现在「未知」由 Option 承载，且未知时**不给矩形**：没有矩形就没有遮挡。代价是
        //   几何迟到期间 pane 不显示 —— 这是有意的取舍，chrome 还在，用户仍有恢复手段。
        let Some(top) = metrics.top_height else {
            return (host_full, ContentSlot::Hidden);
        };
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
        let pane_y = top.clamp(0.0, height);
        let bottom = metrics.bottom_height.clamp(0.0, (height - pane_y).max(0.0));
        let pane_height = (height - pane_y - bottom).max(1.0);
        (
            host_full,
            ContentSlot::Visible(PaneBounds {
                x: pane_x,
                y: pane_y,
                width: pane_w,
                height: pane_height,
            }),
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
        let (host_bounds, pane_slot) = Self::calculate_bounds(
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
        // ★ 已删除「槽过小 → 回落右栏默认（y: 0.0 + 全高）」的兜底。
        //   它与 `slot_for_window` 里的同名副本、以及默认 metrics 走正常算式的结果，
        //   三者产出的是同一个必然盖住 chrome 的矩形 —— 而 chrome 正在 y=0 那一段。
        //   现在「几何未知」由 ContentSlot::Hidden 表达：不给矩形、不 show，chrome 保持可达。
        let slot = pane_slot.bounds();
        let slot_changed = match (last_slot, pane_slot) {
            // 都可见：沿用既有的近似去抖，拖拽亚像素抖动不重下发（5.1 的基线）。
            (Some(ContentSlot::Visible(prev)), ContentSlot::Visible(next)) => {
                !bounds_near(prev, next)
            }
            (Some(ContentSlot::Hidden), ContentSlot::Hidden) => false,
            // 没记录过（含 invalidate 之后）或可见性翻转：一律视为变了。
            _ => true,
        };
        // 落位快照（Req 3.4/3.5）：只在槽真正变化时打印，故拖拽期也不会刷屏。
        // 默认关闭，`PI_WEB_PANE_LAYOUT_DEBUG=1` 即可开启，不需要重新编译。
        if slot_changed && pane_layout_debug_enabled() {
            match slot {
                Some(b) => eprintln!(
                    "[panes] 落位 slot=({:.1},{:.1},{:.1}x{:.1}) 窗口={:.1}x{:.1} \
                     top_height={:?} mode={:?}",
                    b.x, b.y, b.width, b.height, logical_width, logical_height,
                    metrics.top_height, mode,
                ),
                // ★ 这一行是诊断的关键：几何未知时不再有矩形可打，直接报「无内容槽」。
                None => eprintln!(
                    "[panes] 无内容槽（几何未知或全屏）窗口={:.1}x{:.1} top_height={:?} mode={:?}",
                    logical_width, logical_height, metrics.top_height, mode,
                ),
            }
        }
        // ★ 全量句柄快照：回答「谁**实际**盖在 chrome 那条带子上」。
        //   上面的槽诊断只说明 Rust **下发**了什么，说明不了句柄实际在哪 —— 真机上
        //   chrome 被吃掉而槽坐标却正确（y=29 已让出），两者必有一处对不上。
        //   `apply_layout` 的循环会对 `!initialized && !keep_alive` 直接 continue，
        //   那类句柄的 bounds 自创建后无人再动，是头号嫌疑。
        if slot_changed && pane_layout_debug_enabled() {
            for view in &webviews {
                let b = view.bounds().ok().map(|r| {
                    // Rect 内部是物理像素；换算回逻辑像素才好与槽坐标直接比对。
                    let p = r.position.to_physical::<f64>(scale);
                    let s = r.size.to_physical::<f64>(scale);
                    (p.x / scale, p.y / scale, s.width / scale, s.height / scale)
                });
                // Tauri v2 的 Webview 没有 is_visible()，可见性只能看我们自己的记账。
                eprintln!("[panes] 句柄 label={} bounds={:?}", view.label(), b);
            }
        }
        // ★ NSView 树快照：只在**首次**有可见内容槽时打印一次（spec
        //   desktop-native-webview-chrome-dead，Req 1）。句柄 bounds 已证明布局侧一切正常，
        //   剩下的三个候选（宿主不重绘 / CALayer 超出 frame / NSView 吞点击）只有视图树能分辨。
        //   打一次就够——树是稳定的，每帧刷屏反而淹掉证据。
        // ★ 触发时机踩过一次坑：初版设成「首次出现可见内容槽」就 dump，结果树里只有宿主
        //   一个 WryWebView —— 那一刻子 WebView 还没挂上去，读数回答不了「谁盖住 chrome」。
        //   现在改成前若干次槽变化都打，并带上当前 pane 记录数，便于确认是不是「已挂上」那一帧。
        #[cfg(target_os = "macos")]
        if pane_layout_debug_enabled() && slot.is_some() {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static DUMPS: AtomicUsize = AtomicUsize::new(0);
            if DUMPS.fetch_add(1, Ordering::SeqCst) < 6 {
                if let Some(b) = slot {
                    // 探针：chrome 带内左右各一点 + 内容区一点作对照。
                    let probes = [
                        (b.x + 12.0, 8.0),
                        (b.x + b.width - 24.0, 8.0),
                        (b.x + 12.0, b.y + 40.0),
                    ];
                    match window.ns_window() {
                        Ok(ptr) => match unsafe { crate::view_tree::snapshot(ptr, &probes) } {
                            Some(snap) => {
                                eprintln!(
                                    "[panes] 视图树#{} content={:?} 槽=({:.1},{:.1},{:.1}x{:.1}) pane记录={} 视图数={}",
                                    DUMPS.load(Ordering::SeqCst),
                                    snap.content_size, b.x, b.y, b.width, b.height,
                                    panes.len(),
                                    snap.nodes.len(),
                                );
                                for n in &snap.nodes {
                                    eprintln!(
                                        "[panes]   {:indent$}{} frame={:?} layer={:?} hidden={} alpha={:.2} opaque={}",
                                        "", n.class, n.frame, n.layer_frame, n.hidden, n.alpha, n.opaque,
                                        indent = n.depth * 2,
                                    );
                                }
                                for h in &snap.hit_tests {
                                    eprintln!(
                                        "[panes]   命中 {:?} → {}",
                                        h.point,
                                        h.class.as_deref().unwrap_or("(无视图接收)")
                                    );
                                }
                            }
                            None => eprintln!("[panes] 视图树快照失败：contentView 不可得"),
                        },
                        // Req 1.5：本平台拿不到就明说，不静默输出空结果。
                        Err(e) => eprintln!("[panes] 视图树快照不可用：{e}"),
                    }
                }
            }
        }
        // Pane 共享右侧槽；仅槽变时 set_bounds，仅可见性/z-order 需要时 show+focus。
        let mut top_label: Option<String> = None;
        let mut raise_top = host_changed;
        // ★ 任一 pane 实际 show/hide 过（含 hide 路径——它不置 raise_top）。
        //   方案 A 的重绘触发要覆盖它：两 pane 同槽叠放切换时 slot 不变、hide 不抬 top，
        //   但宿主 tab 带的像素已经变了，漏触发即回到「带子空白」（真机踩过）。
        let mut visibility_flipped = false;
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
            // ★ 几何未知：不给 bounds、也不 show。宁可 pane 暂不可见，也不能拿一个
            //   盖住 chrome 的矩形把用户切换 pane 的唯一入口吃掉（Req 2.1/2.4）。
            //   几何到达后 set_metrics → apply_layout 会把它补上（Req 2.3）。
            let Some(slot_bounds) = slot else {
                let _ = view.hide();
                applied_visibility.push((label, false));
                continue;
            };
            if slot_changed {
                view.set_bounds(to_rect(slot_bounds))
                    .map_err(|e| e.to_string())?;
            }
            if recorded_visible {
                if !was_applied_visible {
                    view.show().map_err(|e| e.to_string())?;
                    raise_top = true;
                    visibility_flipped = true;
                }
                top_label = Some(label.clone());
                applied_visibility.push((label, true));
            } else {
                if was_applied_visible {
                    view.hide().map_err(|e| e.to_string())?;
                    visibility_flipped = true;
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
        // ★ 子 WebView 的 bounds/可见性变更后，让宿主重绘（spec
        //   desktop-native-webview-chrome-dead 方案 A）。宿主被 child 覆盖过的区域在 child
        //   让开后可能没被标脏 —— 这正是「几何对、图层对、命中对，却不显示」的形态。
        //   只在槽真变化时做，拖拽已有 bounds_near 去抖，不会每帧刷。
        #[cfg(target_os = "macos")]
        if slot_changed || raise_top || visibility_flipped {
            if let Ok(ptr) = window.ns_window() {
                let ok = unsafe { crate::view_tree::force_host_redraw(ptr) };
                if !ok && pane_layout_debug_enabled() {
                    eprintln!("[panes] 宿主重绘请求失败：未找到铺满全窗的宿主视图");
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
        state.last_slot_bounds = Some(pane_slot);
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
    ) -> (PaneBounds, ContentSlot) {
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

/// 当前实际生效的槽位几何（spec desktop-pane-chrome-occlusion，Req 3.4）。
///
/// ★ 存在的理由：排查本缺陷时，「布局侧此刻的 top_height 到底是多少」是唯一能直接分辨
///   「几何没送达」与「送达了但算错了」的证据，而此前**无法从外部取得**——只能读代码反推
///   默认值是 0.0，再猜它是不是没被覆盖。猜测正是这次排查耗时的来源。
///
/// 只读，不改任何状态；无凭据、无路径，可安全暴露给宿主 realm。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDebugState {
    pub mode: &'static str,
    pub metrics: LayoutMetrics,
    /// 按当前几何与窗口尺寸算出的内容槽；未知几何下为 `None`。
    pub content_slot: Option<PaneBounds>,
    pub window_width: f64,
    pub window_height: f64,
    pub native_enabled: bool,
    pub pane_count: usize,
}

#[tauri::command]
pub fn pane_layout_debug_state(
    window: Window,
    manager: State<'_, NativeWebviewLayoutManager>,
) -> Result<LayoutDebugState, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err("PANE_RELAY_NOT_HOST".to_string());
    }
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let width = f64::from(size.width) / scale.max(0.01);
    let height = f64::from(size.height) / scale.max(0.01);
    manager.debug_state(width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 取可见槽；`Hidden` 直接 panic，避免用例把「没有槽」误当成某个矩形。
    fn visible(slot: ContentSlot) -> PaneBounds {
        match slot {
            ContentSlot::Visible(b) => b,
            ContentSlot::Hidden => panic!("期望有可显示的内容槽，实得 Hidden"),
        }
    }

    #[test]
    fn workspace_host_stays_full_window() {
        let metrics = LayoutMetrics {
            left_width: Some(600.0),
            top_height: Some(36.0),
            pane_width: Some(400.0),
            bottom_height: 0.0,
            min_width: 240.0,
            ..Default::default()
        };
        let (host, slot) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::Workspace,
            metrics,
            1000.0,
            600.0,
        );
        // 宿主铺满，tabs/resize 仍在 host WebView。
        assert_eq!(host, PaneBounds { x: 0.0, y: 0.0, width: 1000.0, height: 600.0 });
        let pane = visible(slot);
        assert_eq!(pane.x, 600.0);
        assert_eq!(pane.y, 36.0);
        assert_eq!(pane.width, 400.0);
        assert_eq!(pane.height, 564.0);
    }

    #[test]
    fn host_fullscreen_hides_pane_region() {
        let (host, slot) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::HostFullscreen,
            LayoutMetrics::default(),
            900.0,
            700.0,
        );
        assert_eq!(host, PaneBounds { x: 0.0, y: 0.0, width: 900.0, height: 700.0 });
        assert_eq!(slot, ContentSlot::Hidden);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // spec desktop-pane-chrome-occlusion 任务 2.2
    //
    // ★ 上面三条既有用例**全部**传入明确的非零 top_height（36/40）或走全屏模式 ——
    //   也就是说「顶边未知」这条恰恰产生遮挡矩形的路径，此前自动化覆盖为零。
    //   下面几条补的正是它。
    // ───────────────────────────────────────────────────────────────────────────

    #[test]
    fn unknown_top_height_yields_no_content_slot() {
        // 缺陷原貌：top_height 缺省为 0.0 → 算出 y=0、高度铺满 → 恰好盖住 y=0 那一段的 chrome，
        // 用户随即失去切换 pane 的唯一入口。现在「未知」不产出任何矩形。
        let (_host, slot) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::Workspace,
            LayoutMetrics { top_height: None, ..Default::default() },
            1200.0,
            800.0,
        );
        assert_eq!(slot, ContentSlot::Hidden);
    }

    #[test]
    fn unknown_top_height_stays_hidden_across_window_sizes() {
        // 只测一组尺寸挡不住「某个尺寸下恰好回落成矩形」的错法（原兜底正是按尺寸阈值触发的）。
        for (w, h) in [(320.0, 240.0), (800.0, 600.0), (1440.0, 900.0), (3840.0, 2160.0)] {
            let (_host, slot) = NativeWebviewLayoutManager::calculate_for_test(
                LayoutMode::Workspace,
                LayoutMetrics {
                    top_height: None,
                    left_width: Some(w * 0.6),
                    pane_width: Some(w * 0.3),
                    ..Default::default()
                },
                w,
                h,
            );
            assert_eq!(slot, ContentSlot::Hidden, "窗口 {w}x{h} 下不应产出内容槽");
        }
    }

    #[test]
    fn known_top_height_never_intersects_chrome_band() {
        // chrome 占据 [0, top) 这一段；内容槽的顶边必须不小于 top，否则就是遮挡。
        for top in [1.0, 24.0, 36.0, 48.0, 120.0] {
            let (_host, slot) = NativeWebviewLayoutManager::calculate_for_test(
                LayoutMode::Workspace,
                LayoutMetrics {
                    top_height: Some(top),
                    left_width: Some(700.0),
                    pane_width: Some(400.0),
                    min_width: 240.0,
                    ..Default::default()
                },
                1200.0,
                800.0,
            );
            let pane = visible(slot);
            assert!(pane.y >= top, "top={top} 时槽顶 {} 落进了 chrome 区", pane.y);
            assert!(pane.height > 0.0);
        }
    }

    #[test]
    fn payload_without_top_height_deserializes_to_none() {
        // ★ 缺了这条，可选化会被序列化默认值悄悄抵消：`#[serde(default)]` 若对 Option 产出
        //   Some(0.0)，则前端不发该字段时布局侧收到的仍是一个「确定的 0」，缺陷原样复活。
        let parsed: LayoutMetrics = serde_json::from_str(
            r#"{"leftWidth":600.0,"paneWidth":400.0,"bottomHeight":0.0,"minWidth":240.0}"#,
        )
        .expect("载荷应可解析");
        assert_eq!(parsed.top_height, None);

        // 给了值就要如实带过来，别把 0 也吞成 None。
        let with_zero: LayoutMetrics =
            serde_json::from_str(r#"{"topHeight":0.0,"minWidth":240.0}"#).expect("可解析");
        assert_eq!(with_zero.top_height, Some(0.0));
    }

    #[test]
    fn invalid_top_height_is_rejected_but_absent_one_is_accepted() {
        let manager = NativeWebviewLayoutManager::default();
        // 缺席是合法的：表示「尚未量得」。
        assert!(manager
            .set_metrics(LayoutMetrics { top_height: None, ..Default::default() })
            .is_ok());
        // 给了非法值才拒绝。
        for bad in [f64::NAN, f64::INFINITY, -1.0] {
            assert!(
                manager
                    .set_metrics(LayoutMetrics { top_height: Some(bad), ..Default::default() })
                    .is_err(),
                "top_height={bad} 应被拒绝"
            );
        }
    }

    #[test]
    fn content_well_bottom_inset_shrinks_pane_height() {
        let metrics = LayoutMetrics {
            left_width: Some(500.0),
            top_height: Some(40.0),
            pane_width: Some(480.0),
            bottom_height: 24.0,
            min_width: 240.0,
            ..Default::default()
        };
        let (_host, slot) = NativeWebviewLayoutManager::calculate_for_test(
            LayoutMode::Workspace,
            metrics,
            1000.0,
            800.0,
        );
        assert_eq!(visible(slot).height, 800.0 - 40.0 - 24.0);
    }
}
