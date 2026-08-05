# Design Document

## Overview

**Purpose**：让 pane chrome 在启用原生子 WebView 的默认形态下重新可见可点。

**已定的事实**（证据见 `requirements.md` 的两节取证记录）：宿主 WebView 的 DOM
（`[1139,0,575,29]`、6 个子节点）、槽位几何、NSView 的 `frame`/`layer`、命中测试**全部正确**，
唯独该区域不出现在屏幕上。三个候选中两个已排除，只剩「宿主不重绘该区域」。

**Impact**：只加一次针对性的重绘触发，不改任何布局计算、不改 DOM、不改前端。

### Goals

- 子 WebView 的 bounds/可见性变更之后，宿主该区域重新出现（3.1、3.2）。
- 不回归拖拽跟手、全屏隐藏、浮层叠放（5.1–5.4）。

### Non-Goals

- 不修改槽位几何（已被测量洗清）。
- 不改动 chrome 的 DOM 或样式（已证明正确）。
- 不为此改变载体选择策略（载体门与几何门的分叉是另一件事）。

## Boundary Commitments

### This Spec Owns
- macOS 上「子 WebView 变更后触发宿主重绘」这一动作及其触发时机。

### Out of Boundary
- 槽位几何的计算与下发（`desktop-pane-chrome-occlusion` 已覆盖）。
- Windows / Linux —— 合成模型不同，本设计不声称适用（Req 4.2 要求如实标注未验证）。

### Allowed Dependencies
- `objc2` / `objc2-app-kit`（已在依赖树内，`view_tree.rs` 已使用）。

### Revalidation Triggers
- wry / Tauri 升级后子 WebView 的挂载方式变化。
- 宿主由「铺满窗口的单一 WebView」改为其他结构。

## 方案选型

| 方案 | 做法 | 取舍 | 结论 |
|------|------|------|------|
| A. 强制宿主重绘 | 子 WebView 应用完 bounds/可见性后，对宿主 NSView 发一次重绘请求 | 改动最小、只在槽变化时触发（拖拽已有去抖，不会每帧刷）；若 WKWebView 的合成不吃 `setNeedsDisplay:` 则无效 | **先试** |
| B. 调整时序 | 把宿主的 `set_bounds` 挪到子 WebView 操作之后 | 触碰既有的「host_changed 才 set_bounds」优化，可能引入拖拽卡顿 | 备选 |
| C. 上游 | 向 wry 报 issue | 周期不可控 | 并行做，不阻塞 |

采纳 **A**，失败则退 B；无论结果如何都做 C 的记录。

**A 为什么可能有效**：宿主是铺满窗口的不透明 WebView，子 WebView 是它的兄弟。子视图的
`set_bounds`/`show` 会让 AppKit 重排兄弟层级，而宿主被 child 覆盖过的区域在 child 让开后
可能没有被标脏——这正是「几何对、图层对、命中对，却不显示」的典型形态。

**A 失败也有信息**：若强制重绘无效，说明问题不在脏区标记，而在更下层的合成，
届时 Req 2.4 要求提出新候选而非宣布无解。

## File Structure Plan

### Modified Files
- `desktop/src-tauri/src/view_tree.rs` — 增加 `force_host_redraw()`：定位宿主视图并请求重绘。仅读取视图树结构，不改任何几何。
- `desktop/src-tauri/src/native_layout.rs` — `apply_layout` 在槽变化且完成子 WebView 操作后调用一次。

## Testing Strategy

**机械**：`force_host_redraw` 在找不到宿主视图时返回 `false` 且不 panic（与 Req 1.5 同源——拿不到就明说）。

**视觉（决定性）**：打包版 native 形态下打开多 pane agent，截图须**同时**可见 chrome 与 pane 内容；
并以一次实际点击证明可交互（Req 6.2：可见不等于可点，本缺陷两者同时失效）。

★ 本修复的有效性**只能由真机视觉判定**——单测无法覆盖 WKWebView 的合成行为。
若截图仍为空，如实记为「方案 A 无效」并转 B，不得以「已实施」代替「已生效」。

---

## 实施与验证状态（2026-08-05）

**方案 A 已实施**：`view_tree.rs::force_host_redraw()` + `apply_layout` 在槽变化且完成子
WebView 操作后调用一次。`cargo test` 96/96，`force_host_redraw` 在 227 次槽变化中
**0 次找不到宿主视图**（说明定位逻辑本身可靠）。

**★ 但尚未通过视觉验证，不得视为已生效。** 验证轮次中 pane 一直停在
「正在连接 agent…」从未就绪，chrome 带的状态因此不构成有效读数——
pane 没起来时该区域本就不该有内容。

按本设计 Testing Strategy 已写明的规则：**「已实施」不等于「已生效」**。
方案 A 的有效性判定**仍然待定**，须在 pane 正常就绪的一轮里重取：

1. 打包版 native 形态，pane 完成连接（右侧显示真实内容而非「正在连接」）；
2. 截图须同时可见 chrome 与 pane 内容；
3. 再以一次实际点击证明可交互（Req 6.2）。

三条都过才判 A 有效；若 chrome 仍为空，按 Req 2.4 记为「A 无效」并转方案 B。

**顺带发现（与本 spec 无关，另记）**：验证轮次中曾出现后端 node 子进程未启动导致白屏，
以及 pane 长时间停在「正在连接 agent…」。二者是否同源未查。
