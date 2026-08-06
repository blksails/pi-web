# Requirements Document

## Project Description (Input)

**谁遇到问题**：pi-web 桌面版（macOS）用户。

**现状**：右侧面板的 pane chrome（tab 栏、收起/更多/新开/刷新/切换器按钮）**既不可见也不可点**。
tab 栏是切换与新开 pane 的唯一入口，用户因此被锁在首个 pane 里，无法经 UI 恢复。

**已经查清的部分**（来自 spec `desktop-pane-chrome-occlusion` 的真机诊断，证据见其
`visual-acceptance.md`）：

- **一个开关就能翻转**：`PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 时 chrome 完整渲染且可交互；
  默认（启用原生子 WebView）时不可见且不吃点击。同一份打包产物、同一个 agent、同一个会话。
- **布局逻辑已被测量洗清**，四个候选逐一被机械证据排除：

  | # | 候选 | 判据 |
  |---|------|------|
  | 1 | 几何算错、槽落在 `y=0` | 槽实测 `(991, 29, 479×879)`，`top_height=Some(29)` |
  | 2 | chrome 子树没渲染 | 关掉原生载体后完整渲染 |
  | 3 | 某个句柄压在 chrome 带上 | 全量句柄快照：**所有**非宿主句柄 `y ≥ 29`，无一例外 |
  | 4 | 句柄实际位置差一个标题栏高度（28px 与 29px 太像） | **377 个样本 `dy` 恒为 `0.0`** |

- **出现过的全部 WebView label**：`main-host`、`pane-overlay-menu`、`pane-warm-0..9`
  （内容 pane 复用预热壳，没有独立的 `pane-<id>-N` 标签）。

**因此故障在哪一层**：在本仓 Rust 代码**之下**。算得对、下发对、句柄落位对、无遮挡物，
而 chrome 依然不可见不可点。剩余解释空间在 wry `0.55.1` / WKWebView / macOS AppKit 合成层：

- 存在 child webview 时宿主 WebView 不重绘右上那 29px（脏区/重绘问题）；
- child 的 `CALayer` 超出其 `frame`（layer ≠ frame），视觉上盖住而 `bounds` 读数正常；
- child 的 `NSView` 进入响应链，吞掉该区域的点击。

三者都能同时解释「看不见 + 点不到 + 关掉即恢复」，**且都无法用现有的 bounds 读数分辨**。

**期望的改变**：

1. 定位到具体是哪一种（或第四种），并给出证据，而不是换个说法继续猜。
2. 修掉它，使 chrome 在启用原生子 WebView 时同样可见可交互。
3. 若根因在上游（wry / Tauri）且短期无法修，给出可长期承受的规避，并说明代价。

## 边界

- **In scope**：macOS 上原生子 WebView 与宿主 WebView 的视图层次、合成与命中测试；
  取得该层证据所需的诊断手段；据此的修复或规避。
- **Out of scope**：pane 槽位几何的计算与下发（已由 `desktop-pane-chrome-occlusion` 覆盖并洗清）；
  pane 生命周期与预热池策略；Windows / Linux 平台（机制不同，见下）；chrome 自身的视觉设计。
- **Adjacent expectations**：依赖 `desktop-pane-chrome-occlusion` 已建立的诊断
  （`PI_WEB_PANE_LAYOUT_DEBUG=1` 的槽与句柄快照、`pane_layout_debug_state` 命令），
  本 spec 在其上增加视图层次维度，不重复几何维度。

### 关于平台

Linux 侧 wry 走 WebKitGTK（`webkit2gtk 2.0.2` + `gtk 0.18.2`），子 WebView 是塞进 GTK
容器的 widget，摆放与合成模型与 macOS 的 NSView 完全不同；Windows 走 WebView2。
本缺陷**只在 macOS 上被观察到，且从未在另两个平台验证过**——「是否平台特有」本身是一条需求。

## Requirements

### Requirement 1: 取得视图层次证据

**Objective:** 作为维护者，我希望能直接观测到原生子 WebView 在系统视图层次里的真实状态，以便不再靠排除法猜测。

#### Acceptance Criteria

1. When 维护者开启诊断并打开至少一个 pane，the 桌面版 shall 输出窗口视图层次中每个视图的标识、位置、尺寸与是否隐藏。
2. The 诊断 shall 同时给出视图的**绘制层**几何与**布局**几何，使二者不一致时可被发现——现有的 bounds 读数只反映后者。
3. When 维护者需要判断某点的点击归属，the 诊断 shall 提供该点实际命中的视图标识。
4. The 诊断 shall 在不重新编译的前提下开启，并在关闭时不产生额外输出。
5. If 所在平台不提供上述观测手段，then the 诊断 shall 明确报告「本平台不支持」，而非静默输出空结果。

### Requirement 2: 判别三个候选

**Objective:** 作为维护者，我希望三个候选被逐一判定为成立或排除，以便修复针对的是真实机制。

#### Acceptance Criteria

1. When 证据齐备，the 调查 shall 对「宿主不重绘该区域」给出成立或排除的判定及其依据。
2. When 证据齐备，the 调查 shall 对「子视图绘制层超出布局范围」给出成立或排除的判定及其依据。
3. When 证据齐备，the 调查 shall 对「子视图吞掉该区域点击」给出成立或排除的判定及其依据。
4. If 三者全部被排除，then the 调查 shall 提出新的候选并说明其如何解释「看不见 + 点不到 + 关掉即恢复」这一组事实，而不是宣布无解。
5. The 调查 shall 对每条判定附上可复现的观测步骤——**排除法本身不构成证据**。

### Requirement 3: 修复或可承受的规避

**Objective:** 作为桌面版用户，我希望在启用原生子 WebView 的默认形态下也能切换 pane。

#### Acceptance Criteria

1. When 用户在默认形态下打开面板，the 桌面版 shall 使 pane chrome 可见。
2. When 用户点击 chrome 上的按钮，the 桌面版 shall 响应该点击。
3. While 修复尚未落地，the 项目 shall 提供一条书面的规避手段及其代价说明。
4. If 根因位于上游依赖且短期不可修，then the 项目 shall 记录上游问题的定位（版本、复现条件），并说明所选规避为何可长期承受。

### Requirement 4: 平台归属

**Objective:** 作为维护者，我希望知道这是不是 macOS 特有问题，以便判断影响面与回归范围。

#### Acceptance Criteria

1. The 调查 shall 说明该缺陷是否在 Windows 与 Linux 形态下同样出现。
2. If 未在其他平台验证，then the 结论 shall 如实标注「未验证」，而不是按机制相似推断。

### Requirement 5: 既有行为不回归

**Objective:** 作为桌面版用户，我希望修复不改变我已经习惯的表现。

#### Acceptance Criteria

1. When 用户拖拽面板宽度，the 桌面版 shall 保持 pane 跟手，不出现相较修复前更明显的滞后。
2. When 宿主进入全屏模式，the 桌面版 shall 隐藏全部内容 pane，并在退出后按原可见性恢复。
3. When pane 的浮层菜单打开，the 桌面版 shall 保持既有的叠放次序与焦点表现。
4. Where 运行在网页宿主，the 系统 shall 保持既有布局行为逐字段不变。

### Requirement 6: 证据与可验证性

**Objective:** 作为验收者，我希望「chrome 可见且可点」能被机械判定，以便这个缺陷不会再一次只能靠肉眼在真机上撞见。

#### Acceptance Criteria

1. When 修复完成，the 验收 shall 产出真机截图，图中 chrome 与 pane 内容同时可见。
2. When 修复完成，the 验收 shall 以一次实际点击证明 chrome 可交互——**可见不等于可点**，本缺陷两者同时失效。
3. If 任一新增断言在修复前的代码上不会失败，then the 验收 shall 判定该断言无效并重写。
4. The 验收 shall 同时给出机械证据与视觉证据；缺任一侧不得判定通过。

## 当前受阻

本 spec 停在 requirements 阶段：design 需要先有 Requirement 1 的视图层次证据，而取证依赖
真机视觉操作。上一轮会话中截图能力在取数后失效（`SCContentFilter failure`，屏幕未锁），
诊断态 `.app` 已存档，能力恢复后可直接续跑。

---

## 取证进展（2026-08-05，NSView 树 + 浏览器 DOM）

### 已取得的证据

**① NSView 树**（`view_tree.rs`，`PI_WEB_PANE_LAYOUT_DEBUG=1` 时前 6 次槽变化各打一次）：

```
content=[1200, 800]  槽=(717, 29, 479x771)  pane记录=4  视图数=13

TaoView                  frame=[0,   0, 1200, 800]  layer=[0,   0, 1200, 800]
  WryWebView(宿主)       frame=[0,   0, 1200, 800]  layer=[0,   0, 1200, 800]  opaque=true
    WKFlippedView        frame=[0,   0, 1200, 800]  layer=[0,   0, 1200, 800]
  WryWebView(overlay)    frame=[-880, 791, 320, 240] layer=同 frame  hidden=true
  WryWebView(pane) ×3    frame=[717, 29, 479, 771]  layer=同 frame  hidden=true
  WryWebView(pane) ×1    frame=[717, 29, 479, 771]  layer=同 frame  hidden=false
```

**② 命中测试**：

```
[729,   8] → 宿主 WryWebView      ← chrome 带内
[1172,  8] → 宿主 WryWebView      ← chrome 带内
[729,  69] → pane WryWebView      ← 内容区（对照）
```

**③ 浏览器（iframe 载体）不复现**——同一后端、同一会话，用 DevTools 读 DOM：

```
[data-panes-host]         x=1312  w=479  h=906   carrier=iframe
[data-panes-chrome]       x=1312  y=0    w=479  h=29   children=6
[data-panes-content-well] x=1312  y=29   w=479  h=877  iframes=4
```

六个按钮各有真实坐标（收起/关闭×3/更多/新开/刷新/切换器），chrome 正常渲染。

### 因此再排除两个候选（累计六个）

| # | 候选 | 判据 | 结论 |
|---|------|------|------|
| 5 | child 的 `CALayer` 超出 `frame` | **每个视图 `layer` 与 `frame` 逐字相同** | 推翻 |
| 6 | child 的 `NSView` 吞掉 chrome 带的点击 | chrome 带内命中的是**宿主**，点击确实到达宿主 | 推翻 |

### 剩下的唯一候选

**宿主 WebView 不重绘/不响应 chrome 所在的那 29px** —— 几何对、图层对、命中对、宿主收得到点击，
而 chrome 依然不可见不可点，且**仅在启用原生子 WebView 时**如此。

### 下一步该取的证据

桌面版**宿主自身**的 DOM 盒模型：`[data-panes-chrome]` 在 native 载体下的 `getBoundingClientRect()`。
浏览器（iframe 载体）已证明正常，缺的是同一份 DOM 在 native 载体下的读数。取法二选一：

1. release 构建开启 devtools 特性，直接在桌面 WebView 上 Inspect；
2. 走 pane relay 往宿主 realm 注入一段只读量测脚本，把盒模型回传到 stderr。

方案 1 更直接；方案 2 不需要额外构建配置但要动通道。

### 本轮的一个方法教训

用截图像素反推坐标**误差会累积到超过结论本身**：窗口尺寸、标题栏高度、缩放系数三者
各有误差，叠起来足以把「差 10px」和「不差」混为一谈。中途窗口被移动后彻底失效。
凡是能从 DOM / 视图树直接读到的数值，一律不要用像素反推。

---

## 判定：三个候选全部有结论（2026-08-05，宿主 DOM 读数）

release 构建开启 `devtools` feature 后，直接在**打包版、native 载体**的宿主 WebView
控制台量得：

```json
{"n":1,"box":[1139,0,575,29],"kids":6,"carrier":"tauri-webview","vw":1718,"vh":910}
```

- chrome 元素**存在且唯一**（`n=1`）
- 盒模型 `[1139, 0, 575, 29]` —— x/y/宽/高全部正确，与内容槽上下相邻不重叠
- **6 个子节点**（收起 / 关闭×N / 更多 / 新开 / 刷新 / 切换器）全在
- `carrier="tauri-webview"` —— 确认是 native 形态，不是回退态

### Requirement 2 的三条判定

| 候选 | 判定 | 依据 |
|------|------|------|
| 2.2 子视图绘制层超出布局范围 | **排除** | NSView 树里每个视图 `layer` 与 `frame` 逐字相同 |
| 2.3 子视图吞掉该区域点击 | **排除** | chrome 带内 `hitTest` 命中的是**宿主**，点击确实到达宿主 |
| 2.1 宿主不重绘该区域 | **成立（唯一幸存）** | DOM 正确、几何正确、图层正确、命中正确，而该区域在屏幕上为空 |

### 因此结论

**宿主 WebView 的 DOM、布局、几何、图层、命中测试全部正确，唯独该区域不出现在屏幕上。**
问题在 WKWebView 的绘制/合成，不在本仓任何 JS/TS/Rust 逻辑内——也因此，任何不触及
渲染层的改动都不可能修好它（见下方 PR #26 的核对）。

### 顺带核对：PR #26 与本缺陷无关

有说法称 PR #26（`feat: add agic video studio agent workflow`）解决了本问题。核对不成立：

```
desktop/ 目录       改动 0 个文件
native_layout.rs    0
pane_relay.rs       0
panes-host.tsx      0
tauri-runtime.ts    0
```

194 个改动文件中 121 个在 `examples/`；panes-kit 只新增了 `browser-policy.ts`
（URL 归一化 + origin 白名单）及其测试。而本缺陷的判据开关
`PI_WEB_NATIVE_CHILD_WEBVIEWS` 只在 `desktop/src-tauri/src/window.rs` 读取，
该 PR 未触及该文件，**不可能改变这一行为**。

### 视觉证据

`va-native-on-chrome-missing.png` —— 打包版 native 形态：右侧面板只有内容，
顶部 29px 的 chrome 带为空。对照组（`PI_WEB_NATIVE_CHILD_WEBVIEWS=0`）下
同一位置显示完整的「会话信息 / 搜图 / 素材 / 画布 / 日志」标签与四个按钮。

### 下一步（design 阶段可以开始了）

Requirement 1 与 2 已满足，阻塞解除。design 需要在以下方向中选型：

1. **强制重绘**：几何变更后主动让宿主 WebView 失效该区域（`setNeedsDisplay:` / 触发 layout）
2. **规避重叠时序**：child 的 `set_bounds` / `show` 与宿主绘制的顺序调整
3. **上游**：向 wry / Tauri 报告并跟进；期间以 `PI_WEB_NATIVE_CHILD_WEBVIEWS=0` 承受
