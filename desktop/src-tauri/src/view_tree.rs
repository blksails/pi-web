//! macOS 视图层次诊断（spec desktop-native-webview-chrome-dead，Req 1）。
//!
//! ## 为什么需要这一层
//!
//! pane chrome 在启用原生子 WebView 时**既不可见也不可点**，关掉即恢复。而 Rust 侧
//! 能观测到的一切都正常：槽算得对、下发对、句柄 `bounds` 读回也对（377 个样本 `dy`
//! 恒为 0），且没有任何句柄压在 chrome 那 29px 上（`native_layout.rs` 的句柄快照已证）。
//!
//! 剩下的三个解释——宿主不重绘该区、child 的 `CALayer` 超出其 `frame`、child 的
//! `NSView` 吞掉点击——**都在 wry 的 API 之下**，`bounds` 读数一概看不见。只有 NSView
//! 树本身能分辨它们：
//!
//! | 候选 | 在本 dump 里长什么样 |
//! |------|----------------------|
//! | CALayer 超出 frame | 某个视图的 `layer` 矩形比它的 `frame` 大，且向上越过 y=29 |
//! | NSView 吞点击 | `hitTest` 在 chrome 带内命中的不是宿主视图 |
//! | 宿主不重绘 | 前两项都正常，但宿主视图在该区域 `needsDisplay` 恒为 false |
//!
//! ## 坐标系
//!
//! AppKit 默认 y 轴**向上**（原点在左下）。而我们的槽几何是 y 向下（原点在左上，与 Web
//! 一致）。为免比对时反复换算出错，本模块把每个视图的矩形统一转成**窗口 content 视图的
//! 左上原点坐标**再打印，与 `native_layout.rs` 的槽坐标可直接逐字比对。
//!
//! ## 安全性
//!
//! 只读。不改任何视图状态，不做 `setFrame` / `setHidden` / `display` 之类的写操作——
//! 诊断本身若改变了被观测对象，读数就没有意义了。

#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSView, NSWindow};
use objc2_foundation::{NSPoint, NSRect};

/// 一个视图节点的只读快照。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewNode {
    /// 在树中的深度，用于缩进还原层次。
    pub depth: usize,
    /// Objective-C 类名（`WKWebView`、`NSVisualEffectView` …）。
    pub class: String,
    /// frame，已转成窗口 content 视图的**左上原点**坐标（与槽几何同坐标系）。
    pub frame: [f64; 4],
    /// backing layer 的矩形，同样转成左上原点坐标；无 layer 时为 `None`。
    ///
    /// ★ 与 `frame` 不一致正是候选之一：视觉上盖住而 `bounds` 读数正常。
    pub layer_frame: Option<[f64; 4]>,
    pub hidden: bool,
    pub alpha: f64,
    /// 是否不透明。宿主若被一个不透明视图盖住，重绘与否都看不见。
    pub opaque: bool,
    /// 是否有 backing layer。
    pub wants_layer: bool,
}

/// 视图层次 + 指定点的命中测试结果。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewTreeSnapshot {
    /// content 视图的尺寸（左上原点坐标系下的宽高）。
    pub content_size: [f64; 2],
    pub nodes: Vec<ViewNode>,
    /// 对若干探针点做 `hitTest` 的结果：`(x, y, 命中的类名)`。
    ///
    /// ★ 这一项直接回答「chrome 带里的点击被谁吃掉了」——需求 1.3。
    pub hit_tests: Vec<HitProbe>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HitProbe {
    /// 探针点，左上原点坐标。
    pub point: [f64; 2],
    /// 命中的视图类名；`None` 表示没有视图接收该点。
    pub class: Option<String>,
}

/// 取 Objective-C 对象的类名。
fn class_name(obj: &AnyObject) -> String {
    obj.class().name().to_string_lossy().into_owned()
}

/// AppKit 的左下原点矩形 → 左上原点矩形（相对 content 视图）。
fn flip_rect(r: NSRect, content_height: f64) -> [f64; 4] {
    [
        r.origin.x,
        content_height - r.origin.y - r.size.height,
        r.size.width,
        r.size.height,
    ]
}

fn walk(view: &NSView, depth: usize, content: &NSView, ch: f64, out: &mut Vec<ViewNode>) {
    // 统一换算到 content 视图坐标，再翻转 y —— 直接读 `frame` 得到的是相对父视图的值，
    // 跨层比对会错位。
    let bounds = view.bounds();
    let in_content: NSRect = view.convertRect_toView(bounds, Some(content));

    let (layer_frame, wants_layer) = {
        match view.layer() {
            Some(layer) => {
                let lf = layer.frame();
                // layer.frame 相对父 layer；把它按同样的方式挪到 content 坐标下比对。
                let origin_shift = NSPoint {
                    x: in_content.origin.x + (lf.origin.x - view.frame().origin.x),
                    y: in_content.origin.y + (lf.origin.y - view.frame().origin.y),
                };
                let rect = NSRect {
                    origin: origin_shift,
                    size: lf.size,
                };
                (Some(flip_rect(rect, ch)), true)
            }
            None => (None, false),
        }
    };

    out.push(ViewNode {
        depth,
        class: class_name(view.as_ref()),
        frame: flip_rect(in_content, ch),
        layer_frame,
        hidden: view.isHidden(),
        alpha: view.alphaValue(),
        opaque: view.isOpaque(),
        wants_layer,
    });

    let subviews: Retained<objc2_foundation::NSArray<NSView>> = view.subviews();
    for sub in subviews.iter() {
        walk(&sub, depth + 1, content, ch, out);
    }
}

/// 让宿主 WebView 重新绘制（spec desktop-native-webview-chrome-dead，方案 A）。
///
/// ## 为什么需要
///
/// 宿主是铺满窗口的不透明 WebView，子 pane WebView 是它的**兄弟**。子视图的
/// `set_bounds` / `show` 会让 AppKit 重排兄弟层级，而宿主被 child 覆盖过的区域在
/// child 让开后可能没有被标脏——这正是本缺陷「几何对、图层对、命中对，却不显示」的形态。
///
/// ## 只做一件事
///
/// 对宿主视图（content 视图下第一个铺满全窗的子视图）请求重绘。**不改任何几何**，
/// 不碰子视图，也不改可见性——诊断与修复都不该动被观测对象之外的东西。
///
/// 返回是否找到了宿主视图。找不到时返回 `false` 而非静默成功——
/// 与 Req 1.5 同源：拿不到就明说。
///
/// # Safety
/// `ns_window` 必须是 `tauri::Window::ns_window()` 返回的有效指针。
pub unsafe fn force_host_redraw(ns_window: *mut std::ffi::c_void) -> bool {
    if ns_window.is_null() {
        return false;
    }
    let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    let Some(content) = window.contentView() else {
        return false;
    };
    let cb = content.bounds();
    // 宿主 = content 下铺满全窗的那个子视图（pane 与 overlay 都只占局部）。
    for sub in content.subviews().iter() {
        let f = sub.frame();
        let full = (f.size.width - cb.size.width).abs() < 1.0
            && (f.size.height - cb.size.height).abs() < 1.0
            && f.origin.x.abs() < 1.0
            && f.origin.y.abs() < 1.0;
        if full {
            sub.setNeedsDisplay(true);
            // 子层同样标脏：WKWebView 的实际内容在其后代里，只标顶层可能不下传。
            for inner in sub.subviews().iter() {
                inner.setNeedsDisplay(true);
            }
            return true;
        }
    }
    false
}

/// 对给定窗口取一次只读快照。
///
/// `probes` 是左上原点坐标下的探针点；每个点会做一次 `hitTest`，用于回答
/// 「该位置的点击实际归谁」。
///
/// # Safety
/// `ns_window` 必须是 `tauri::Window::ns_window()` 返回的有效指针。
pub unsafe fn snapshot(
    ns_window: *mut std::ffi::c_void,
    probes: &[(f64, f64)],
) -> Option<ViewTreeSnapshot> {
    if ns_window.is_null() {
        return None;
    }
    let window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
    let content: Retained<NSView> = window.contentView()?;
    let ch = content.bounds().size.height;
    let cw = content.bounds().size.width;

    let mut nodes = Vec::new();
    walk(&content, 0, &content, ch, &mut nodes);

    let hit_tests = probes
        .iter()
        .map(|&(x, y)| {
            // 探针点从左上原点翻回 AppKit 的左下原点。
            let p = NSPoint { x, y: ch - y };
            // hitTest 期望的是**父视图**坐标系；content 的父是 window 的 frame view，
            // 二者原点一致，故直接传 content 坐标可用。
            let hit = content.hitTest(p);
            HitProbe {
                point: [x, y],
                class: hit.map(|v| class_name(v.as_ref())),
            }
        })
        .collect();

    Some(ViewTreeSnapshot {
        content_size: [cw, ch],
        nodes,
        hit_tests,
    })
}
