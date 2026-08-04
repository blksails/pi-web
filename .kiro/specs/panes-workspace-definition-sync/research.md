# Research & Design Decisions

## Summary

- **Feature**: `panes-workspace-definition-sync`
- **Discovery Scope**: Extension（既有系统的时序修复，集成面为主）
- **Key Findings**:
  - F1：workspace 由 `useState` 惰性初始化建立一次，`definition` 后续变化不重建——这是缺陷的机制本体。
  - F2：持久化快照只存「当前可见 instance 列表」，**结构上无法区分**「用户主动关闭」与「因清单不完整而未曾打开」。这是本设计必须正面解决的核心张力（Req 2.3）。
  - F3：`instanceIds` 是**桌面原生 WebView 的 label 种子**，用于跨 route remount 保持「一个 pane 一个 WebView」。粗暴重建 workspace 会破坏桌面形态，故补齐必须是「增量补开」而非「整体重建」。
  - F4：`panes-host.tsx:483` 已存在 `useEffect(..., [definition])`（重置 parked/errors），是补齐逻辑的天然落点，无需新造监听机制。
  - F5：`mergePaneSources` 经实测正确，不在改动范围。

## Research Log

### 缺陷机制定位

- **Context**：aigc-agent 声明的 4 个 pane 一个都不打开，而 panes-agent 的 3 个正常。
- **Sources Consulted**：运行时 React fiber 读取（Chrome DevTools）、`packages/panes-kit/src/react/panes-host.tsx`、`packages/panes-kit/src/instances.ts`、`packages/panes-kit/src/merge.ts`、网络请求与 localStorage 实测。
- **Findings**：
  - `panes-host.tsx:375` 的 `React.useState(() => restoredPaneWorkspace(definition, ...))` 惰性初始化只在首次 mount 执行；文件内五处 `[definition]` 依赖的 effect 均不触及 workspace。
  - 首帧 `definition` 只含 `host:session-info`（`hostPaneSource` 同步、运行时车道 extension 异步）。host 来源 `initialPaneIds` 为 `null`，单来源合并后为空，`createPaneWorkspace`（`instances.ts:25`）落到回退分支 `?? [definition.panes[0]!.id]`，打开内置 pane。
  - 该结果经 `panes-host.tsx:499-517` 的持久化 effect 写盘，下次 `restoredPaneWorkspace` 读回、`declared` 校验通过（内置 pane 确实仍在清单里），形成自我固化。
  - 决定性证据（同一时刻 fiber 读出）：`DEFINITION.initialPaneIds = [search, materials, canvas, logs]`，`WORKSPACE = [host:session-info]`。
- **Implications**：修复点在 workspace 与 definition 的同步，不在解析、装载或合并链路。

### 已排除的假设（勿在实现阶段重新怀疑）

| 假设 | 证伪方式 | 结果 |
|---|---|---|
| webext 解析失败 | `GET /api/webext/resolve` | `found:true`，manifest 与 `entries` 齐全 |
| 扩展代码加载失败 | 网络面板 | `web-extension.same-origin.mjs` + 4 个 singleton 全 200 |
| 装载门控拒绝 | 页面内手动调 `loadExtension` | `status:"loaded"`，扩展完整 |
| 两层 `{definition,config}` 读取失败 | 检查宿主归一逻辑 | 正常剥层 |
| `mergePaneSources` 拒绝或算错 | 页面内手动跑合并 | 5 个 pane、**零 rejections**、`initialPaneIds` 正确 |
| 面板宽度为 0 | 恢复宽度后复测 | workspace 仍被覆盖回 host-only |
| 纯持久化脏数据 | 清空 localStorage + 新建会话 | 仍复现 |

### 竞态性质

- **Context**：需要判定验收证据的强度要求。
- **Findings**：清空持久化后新建会话曾**偶然出现四个 pane 全开**（extension 抢在 mount 前到达），随后 reload 又被打回 host-only。
- **Implications**：单次通过不能作为修复证明（Req 5）。测试必须**显式构造**「definition 后到」的时序，而非依赖真实网络时机。

### 桌面原生 pane 的约束

- **Context**：Req 4.3 要求桌面形态行为一致。
- **Sources Consulted**：`PersistedPaneWorkspace.instanceIds` 的代码注释、`adapters/tauri-runtime.ts` 的引用点。
- **Findings**：注释原文 `Native child WebView label seed; keeps one WebView per pane across route remounts`。instanceId 直接参与原生 WebView 的标识。
- **Implications**：**不得**用「丢弃旧 workspace、按新 definition 整体重建」的方案——那会更换全部 instanceId，导致桌面下 WebView 被重建。补齐必须保留既有 instance 的身份。

## Architecture Pattern Evaluation

| 选项 | 描述 | 优势 | 风险 / 局限 | 结论 |
|---|---|---|---|---|
| A. definition 变化即整体重建 workspace | `[definition]` effect 里重跑 `createPaneWorkspace` | 实现最简 | 破坏 instanceId 稳定性（F3），且会把用户已关闭的 pane 全部重开（违反 Req 2） | **否决** |
| B. 延迟挂载 PanesHost 直到 extension 落定 | 宿主在装载完成前不渲染面板 | 消除竞态源头 | 首屏多一次空窗/闪烁；且「落定」无普适判据（agent 可能永远没有 webext，Req 4.5） | **否决**（作为兜底思路保留） |
| C. 快照记录「当时已知的 pane 全集」+ 增量补开 | 持久化增记 `knownPaneIds`；definition 变化时只补开「新出现且属于初始集合」的 pane | 结构上区分用户意图（解 Req 2.3）；保留 instanceId（解 F3）；兼容旧快照 | 需要一次持久化结构演进；旧快照需降级判定 | **选定** |

## Design Decisions

### Decision: 以「已知全集」而非「打开列表」承载用户意图

- **Context**：Req 2.3 要求必须能区分「用户主动关闭」与「因清单不完整而未曾打开」，而现有快照结构（F2）做不到。
- **Alternatives Considered**：
  1. 记录显式的「用户关闭过的 pane」黑名单——语义直接，但需要在每个 close 路径埋点，且黑名单会随 definition 变化而失效（pane 被移除后黑名单条目成为垃圾）。
  2. 快照记录写盘当时 definition 的**全部** pane id（`knownPaneIds`），用差集推导用户意图。
- **Selected Approach**：方案 2。`knownPaneIds \ paneIds` 即「用户见过但选择不开」的集合，予以尊重；`当前 definition 的 pane \ knownPaneIds` 即「写快照时尚不知道」的集合，其中属于 `initialPaneIds` 的补开。
- **Rationale**：单一字段同时承载两个判定，且天然随 definition 收敛（pane 被移除后差集自动消失，无垃圾条目）。无需改动任何 close 路径，降低回归面。
- **Trade-offs**：需要一次持久化结构演进；旧快照没有该字段，须有降级路径（见下一条决策）。
- **Follow-up**：实现时确认 `knownPaneIds` 写入点与 `paneIds` 同一处 effect，避免两者写入时机不一致产生撕裂快照。

### Decision: 旧快照的降级判定只覆盖「可确证被污染」的形态

- **Context**：Req 3 要求纠正存量污染，但 Req 3.3 同时要求「不得借纠正之名丢弃用户既有布局」。旧快照缺 `knownPaneIds`，无法精确推导用户意图。
- **Alternatives Considered**：
  1. 旧快照一律丢弃，按 `initialPaneIds` 重建——会误伤所有正常保存过布局的用户。
  2. 只在**可确证被污染**的形态下纠正：快照内容**仅由内置命名空间 pane 构成**，且当前 definition 的 `initialPaneIds` 中存在**一个都不在快照里**的 agent pane。
- **Selected Approach**：方案 2。该形态正是缺陷的唯一产物特征——正常使用中用户不可能把所有 agent pane 都关掉却恰好只留内置 pane。
- **Rationale**：把误伤面压到可论证的最小集；对无法确证的旧快照保持沿用（宁可少纠正，不可乱纠正）。
- **Trade-offs**：极端情况下（用户确实手动只留内置 pane）会被误纠正一次；纠正后写入带 `knownPaneIds` 的新快照，此后不再重复纠正（Req 3.2）。
- **Follow-up**：内置命名空间前缀取既有常量，不新造判定规则。

### Decision: 补齐落在既有 `[definition]` effect，不新建监听

- **Context**：需要在 definition 变化时触发补齐。
- **Selected Approach**：复用 `panes-host.tsx:483` 已有的 `useEffect(..., [definition])`，在其中调用新的纯函数 `reconcilePaneWorkspace`。
- **Rationale**：避免引入第二条 definition 监听导致两处顺序耦合；该 effect 本就是「definition 换了要重置的东西」的归属地。
- **Trade-offs**：该 effect 现有职责会扩大，需在注释中写明两类职责的关系。
- **Follow-up**：确认补齐 dispatch 不与同 effect 内的 `setParkedInstanceIds(new Set())` 产生顺序依赖。

## Risks & Mitigations

- **R1 回归面大**：`panes-kit` 被 6 个示例 agent、宿主内置 pane、桌面原生路径共用 —— 以纯函数单测覆盖判定逻辑，以 `panes-host.test.tsx` 覆盖时序，全量两条命令（`pnpm test` + `pnpm test:app`）作为回归判据。
- **R2 竞态被误判为已修复**：测试必须**显式构造** definition 后到的时序（rerender 传入新 definition），不得依赖真实网络时机；并对「用户关闭后不复现」单列用例（Req 5）。
- **R3 持久化结构演进破坏旧客户端**：`knownPaneIds` 设为可选字段，旧代码读新快照时忽略该字段、行为不变；新代码读旧快照走降级路径。
- **R4 误纠正用户布局**：降级判定限定在「仅含内置 pane」这一可确证形态，且纠正后立即写入新格式快照，保证只发生一次。
- **R5 桌面 WebView 被重建**：补齐只新增 instance，绝不重建既有 instance 的 instanceId —— 以「补齐前后既有 instanceId 集合不变」作为测试断言。

## References

- `packages/panes-kit/src/react/panes-host.tsx:375`（惰性初始化）、`:483`（definition effect）、`:499-517`（持久化写入）、`:253-292`（`restoredPaneWorkspace`）
- `packages/panes-kit/src/instances.ts:21-33`（`createPaneWorkspace` 与回退分支）
- `packages/panes-kit/src/merge.ts:205-235`（`initialPaneIds` 合成规则，本次不改）
- `.kiro/specs/host-builtin-panes/design.md`（Req 1.6 / 2.5 的既有设计意图来源）
- `.kiro/steering/tech.md`（测试分档：实现者跑 `scoped-test.mjs`，复查者跑 `pnpm test` + `pnpm test:app`）
