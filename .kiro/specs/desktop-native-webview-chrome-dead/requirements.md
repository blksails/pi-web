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
