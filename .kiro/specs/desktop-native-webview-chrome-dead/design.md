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

### 视觉验证读数（2026-08-05 晚，rebuild9）

启动方式：打包版（dmg 提取，二进制正负控确认含方案 A 串），
`PI_WEB_AGENT_DIR=<全新目录>` 绕开登录门，原生载体默认态，
`PI_WEB_PANE_LAYOUT_DEBUG=1`。

- **判据 1（pane 就绪且有内容）✓**：打开历史会话后，画廊 pane 渲染出真实内容
  （9 张图片网格、统计行、筛选行、底部工具条）。日志确认载体为原生子 WebView：
  `pane-warm-0 bounds=(571,29,849x846)` 与画面中内容区几何吻合。
- **判据 2（chrome 与 pane 内容同帧可见）✓**：多张截图中 chrome 带
  （「画廊」标签 + ✕ + 右侧 +/刷新按钮，逻辑 y 0–29）与其下 pane 内容同时可见。
  这正是此前打包版原生态 100% 复现为空白的那条带。
- **判据 3（点击可交互）✓（补读数 2026-08-05 晚）**：自动化点击因用户占用实机
  多轮未取得干净读数（输入法候选条持续更新、窗口多次被移动/抢焦点、两次点击
  经复盘落在标题栏上——移位后未重量几何就点，教训记档）。最终由**用户本人实机
  点击标签带确认「有反应，chrome 可交互」**。人工读数与自动化读数同等有效——
  判据要的是交互事实，不是取数方式。

### 判定：方案 A 有效（三条判据全过）

按本节前文写死的规则：三条都过才判 A 有效——现已全过，**记「方案 A 有效」**。

**归因附注（降级为可选项）**：chrome 从「恒空白」变为「可见可点」与方案 A 同轮
出现，但 A 无独立开关，同构建内无法 A/B。若将来症状复发或需严格归因，
构建去掉 force_host_redraw 的对照包复跑即可；当前不阻塞收口。

---

## ★ 方案 A 之外的一次错误尝试：翻转载体默认值（已回退）

**做了什么**：把 `native_child_webviews_enabled()` 的默认值从「开」翻成「关」，
以为这样就切到 iframe 载体、规避 chrome 不可见的问题。

**为什么是错的**：`PI_WEB_NATIVE_CHILD_WEBVIEWS=0` **不是切到 iframe**。
`pane_relay.rs` 的 native 分支 `return` 之后，非 native 分支走
`app.run_on_main_thread` + `get_webview_window(&label)`，建的是**独立的顶层
WebviewWindow**——位置由「宿主窗口屏幕坐标 + DOM 槽矩形」算出。

真机实测：那些窗口会飘到屏幕角落（用户报「奇怪的悬浮块」）。表现为
「tab 点了打不开面板」——**面板其实开了，只是开到别处去了**。

于是这次改动只是**把一个坏掉的载体换成另一个坏掉的载体**：

| 载体 | 缺陷 |
|------|------|
| 原生 child WebView（默认） | chrome 不可见也不可点（真因在 WKWebView 合成层） |
| 旧浮层（`=0`） | pane 窗口位置算错，飘到屏幕角落 |

**已回退**默认值，并把两条载体各自的缺陷写进 `window.rs` 的开关注释，
免得下次有人再想「翻个默认值规避一下」。

**教训**：我把 `=0` 的语义当成了「iframe」，而代码注释里写的是「回退旧顶层
WebviewWindow 载体」——**没读就假设了**。规避手段本身也要验证，不能因为它
「只是个开关」就跳过。用户先说「有 tab 但点不开面板」、再说「应该修错误方向了」，
两次都是对的。

**保留的部分**：`about:srcdoc` / `about:blank` 的导航放行是独立且正确的修复
（wry 的 `on_navigation` 对子框架同样回调），但它**不是**「点不开面板」的成因——
aigc-agent 的 pane 走 URL 载入而非 srcdoc。不要把这两件事混为一谈。
