# Research & Design Decisions

## Summary

- **Feature**: `desktop-pane-chrome-occlusion`
- **Discovery Scope**: Extension（既有系统的缺陷修复 + 结构加固），轻量发现
- **Key Findings**：
  1. **「未知」在类型层无法表达**。`LayoutMetrics.top_height` 是 `f64`（默认 `0.0`），而它的两个同类字段 `left_width` / `pane_width` 都是 `Option<f64>`。于是「顶边未知」只能坍缩成 `0.0`——而 `0.0` 恰好是唯一会盖住 chrome 的值。这是本缺陷的根，不是表象。
  2. **三条独立路径都会产出同一个 y=0 铺满矩形**：正常算式吃默认 metrics（`native_layout.rs:287`）、"槽过小"兜底（`:361-371`，显式写死 `y: 0.0` 与全高）、child 首建位置（`slot_for_window` → `:164` 用 `state.metrics`）。三处各自看都"合理"，合起来构成一个没有出口的降级面。
  3. **载体门与几何门不是同一个门**。native 载体只要 `__TAURI__` 存在就启用（`tauri-runtime.ts:861`），而几何上报要求 `pane_layout_is_native` 解析为 `true`（`panes-host.tsx:495` → `:508` 早退）。二者一旦分叉，就是"child 照建、几何永不上报"——与观察到的持久性遮挡完全吻合。
  4. **show 前的几何保障存在但会被静默跳过**：`placeThenShow`（`panes-host.tsx:1364`）确实 `await ensureTauriContentWellMetrics` 再 `show()`，但 `measureContentWell` 在槽 <48px 时返回 `undefined`，`publishOnce` 便**不发 IPC 直接返回**，而 `show()` 照常执行。保障写了，但没有把"没量到"当成阻断条件。
  5. **该路径自动化覆盖为零**：`native_layout.rs` 的三个既有用例全部传入明确的非零 `top_height`（36 / 40）或走 `HostFullscreen`；产生遮挡矩形的兜底分支位于 `apply_layout` 内，需要真实 `AppHandle`，结构上跑不到测试里。

## Research Log

### 主题一：chrome 是否可能被"正确几何"盖住

- **Context**：先要排除"结构本身就重叠"，否则修几何是白修。
- **Sources Consulted**：`packages/panes-kit/src/react/panes-host.tsx:1728`（`<header data-panes-chrome data-panes-tabs>`）、`:1734`（`<div data-panes-content-well>`）。
- **Findings**：header 与 content-well 是同一个 flex 列的**兄弟节点**，header 在前。`measureContentWell` 取的是 well 的 `rect.top`（`tauri-runtime.ts:303`），天然落在 header 之下。
- **Implications**：**几何正确时不可能遮挡**。因此症状必然等价于"几何没到 Rust，或到了但没被采纳"。这把排查面从"布局算法"收敛到了"几何链路的可达性"，是后续所有判断的前提。

### 主题二：Rust 侧"几何未知"到底会画出什么

- **Context**：需要知道降级态的具体矩形，才能判断它是否与 chrome 相交。
- **Sources Consulted**：`desktop/src-tauri/src/native_layout.rs:56-68`（`Default`）、`:287-289`（`calculate_bounds`）、`:361-371`（`apply_layout` 兜底）、`:155-170`（`slot_for_window`）。
- **Findings**：默认 `top_height: 0.0`、`bottom_height: 0.0`、`pane_ratio: Some(0.34)`。正常算式得 `y=0`、`height=窗口高`；兜底分支显式写死同样的 `y: 0.0` 与全高；首建位置同样吃默认 metrics。
- **Implications**：`:361` 的注释自陈用于"metrics 尚未上报时"——**作者已经识别出这一态，但为它选的兜底恰好是从窗口顶端铺满**。缺省语义应当是"信息不足时不要遮挡"，现状是"信息不足时全遮"。修兜底矩形只是止血；让"未知"可表达才是根治。

### 主题三：几何链路上有哪些静默失败点

- **Context**：需求 3 要求失败可取证；先要把静默点列全。
- **Sources Consulted**：`tauri-runtime.ts:264-267`（`isTauriNativePaneLayout` 的 `.catch(() => false)`）、`:300`（尺寸阈值丢弃）、`:328-333`（`flushContentWellMetrics` 对 `undefined` 静默 return）、`:384`（`lastMetricsKey` 去重）、`native_layout.rs:126-132`（`set_metrics` 校验拒绝，前端无回执）、`panes-host.tsx:534-536`（事件监听 `.catch(() => undefined)`）。
- **Findings**：至少 6 处 fail-soft，且**没有任何一处留下痕迹**。其中 `isTauriNativePaneLayout` 的 catch 会把"命令报错"与"本来就不是 native"混成同一个 `false`——两种完全不同的状况被压成一个值。
- **Implications**：这解释了为什么这个缺陷只能靠肉眼在真机上撞见。诊断必须落在这 6 处，而不是笼统加一句日志。与既有记忆一致：**四层 fail-soft 叠加 = 零报错**。

### 主题四：触发条件的候选与判别方法

- **Context**：需求 4.4 要求给出真实触发条件，而不是"改完看着好了"。
- **Findings**：静态推理能收敛到三个候选，但**无法单靠读代码分辨**，因为它们的表征相同（chrome 被盖）：

  | 候选 | 机制 | 是否解释"持久不恢复" | 判别方法 |
  |------|------|----------------------|----------|
  | C1 载体/几何门分叉 | `pane_layout_is_native` 返回 false 或被拒 → 上报 effect 从未安装 | **能**（无人再上报，永不自愈） | 诊断中打印该命令的返回值与是否走了 catch 分支 |
  | C2 首帧量槽失败 | 槽 <48px 被丢弃，`show()` 照走 | 不能（ResizeObserver 随后会纠正）——除非同时命中 C1 | 诊断中打印被丢弃的 rect 与时刻 |
  | C3 Rust 校验拒绝 | `set_metrics` 返回 Err，前端无感知 | 能（Rust 保留旧值/默认值） | 诊断中打印被拒数值与拒绝原因 |

- **Implications**：观察到的症状是**持久**的（截图里 chrome 始终不出现），据此 C1 与 C3 的先验高于 C2。但这是先验不是结论。**判别实验必须在加了诊断之后、在真机上跑**——这决定了任务顺序：先加可观测性，再定位，最后才谈"根治"。若诊断上齐后仍不复现，按需求 4.4 如实记为"不可复现"，不得以"已修复"含混带过。

## Architecture Pattern Evaluation

| 选项 | 描述 | 优点 | 风险 / 局限 | 结论 |
|------|------|------|-------------|------|
| A. 只改兜底矩形 | 把 `:361` 与默认值的 `y` 改成一个非零常量 | 改动最小 | chrome 高度是常量假设，改版即错；"未知"仍不可表达；三条路径要各改一遍且会漂移 | **否决** |
| B. 让"未知"可表达 + 未知即不显示 | `top_height` 改 `Option<f64>`；`None` 时不显示 pane，也不给出槽矩形 | 与同结构体的 `left_width` / `pane_width` 一致；错法在类型层就不成立；三条路径自然收敛到同一判断 | 需同步改前端上报与 `serde` 默认行为；须确保 `None` 不会造成"pane 永远不显示" | **采纳** |
| C. Rust 侧自行推算 chrome 高度 | 由后端假定/测量 chrome 高度 | 前端无需改 | 后端不该知道前端布局；等于把下游假设塞进上游，违反边界原则 | 否决 |

## Design Decisions

### Decision: 用 `Option<f64>` 表达"顶边未知"，并让"未知"等于"不显示 pane"

- **Context**：见 Key Findings 1。`0.0` 同时是合法值与缺省值，二义性直接导致最坏行为。
- **Alternatives Considered**：见上表 A / B / C。
- **Selected Approach**：`top_height: Option<f64>`；`None` 时 `calculate_bounds` 不产出可显示的内容槽，`apply_layout` 不 show 内容 pane；`slot_for_window` 在 `None` 时同样不给出"从顶端铺满"的矩形。
- **Rationale**：把"信息不足"从一个**值**升格为一个**状态**。此后"盖住 chrome"不再是某处忘了改的默认值，而是一个需要显式写出来才能达成的结果。
- **Trade-offs**：换来一个新风险——若几何永远到不了，pane 就永远不显示（从"看得见但没法切换"变成"看不见"）。这是**有意的取舍**：前者剥夺用户的恢复手段，后者不剥夺（chrome 还在，可以关掉重开、换 pane）。但正因如此，需求 3 的诊断不是可选项：不可见必须伴随可取证的原因。
- **Follow-up**：实施期须确认 `#[serde(default)]` 对 `Option` 字段的行为（缺字段 → `None`，而非 `Some(0.0)`），并用一条会红的用例锁住它。

### Decision: 诊断落在 6 个具名静默点上，而非笼统加日志

- **Context**：需求 3 要求"可取证"，泛泛的日志无法回答"是哪一环断的"。
- **Selected Approach**：对主题三列出的 6 处各留一条含数值与原因的记录；`isTauriNativePaneLayout` 的 catch 必须把"命令报错"与"非 native"区分开，不再压成同一个 `false`。
- **Rationale**：本缺陷的调查成本几乎全部来自"分不清断在哪一环"。诊断的价值不在于有日志，而在于**能判别候选**。
- **Trade-offs**：日志噪音。按仓库既有约定（日志默认关闭、可不重编译开启）控制。

### Decision: 验收必须同时具备机械证据与视觉证据

- **Context**：本缺陷的完整生命周期是"单测全绿 + 构建成功 + 真机坏掉"。任一侧单独都放过了它。
- **Selected Approach**：几何计算层用自动化用例锁"未知输入不产出与 chrome 相交的矩形"；真机层用截图证明 chrome 与内容同时可见。两者缺一不判过（需求 6.5）。
- **Rationale**：与仓库既有教训一致——**先证明判据能报红再信它报的绿**。新增断言必须先在修复前的代码上验证会失败。

## Risks & Mitigations

- **R1 `None` 导致 pane 永不显示** — 上报链路若有未发现的断点，用户从"能看见内容但切不了"变成"什么也看不见"。缓解：诊断先行（任务顺序上诊断在行为改动之前）；并保留一条"几何迟到后自动落位"的路径（需求 2.3）。
- **R2 兜底移除后暴露既有依赖** — 现有代码可能有别处依赖"槽总是有值"。缓解：`Option` 化会让所有消费点在编译期暴露，逐个显式处置，不用 `unwrap_or(0.0)` 糊过去。
- **R3 拖拽跟手回归** — 几何路径改动可能影响 `bounds_near` 去抖与单路 rAF 合并。缓解：需求 5.1 明确以修复前为基线；改动不触碰合并与去抖逻辑。
- **R4 触发条件不可复现** — 真机上加了诊断后问题不再出现（时序类缺陷常见）。缓解：需求 4.4 已允许如实记录为不可复现；此时结构性修复仍然成立，因为它消除的是**整个降级面**而非某一次触发。
- **R5 视觉验证环境成本** — 需要打包桌面版并在真机运行。缓解：复用既有 `agent-web-extension-visual-acceptance` 的证据约定（编号截图 + 明确选择器 + 缺口如实记录）。
