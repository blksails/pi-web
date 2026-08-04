# Gaps & Known Deviations

本文件记录实施后**仍未完全满足**的验收条件、以及实施过程中发现但刻意未纳入本 spec 的问题。
每条都标明证据来源，避免下游把「已知偏差」误当成「已解决」。

## G1 — Req 1.2 的「无可观察差异」未完全成立（已知偏差，未修）

**验收条件原文**：「While agent 的 pane 清单需要异步取得，when 清单最终到达，the Pane 面板
shall 使最终的已打开集合与清单声明的初始打开集合一致，其结果与清单在首次呈现时即已就绪的
情形**没有可观察差异**。」

**实测结果**（aigc-agent，真机）：

| 首帧清单状态 | 最终已打开集合 | 与 `initialPaneIds` 的关系 |
|---|---|---|
| 已完整（赢竞态） | `[search, materials, canvas, logs]` | 完全一致 |
| 仅内置 pane（输竞态） | `[host:session-info, search, materials, canvas, logs]` | 多出一个内置 pane |

> 取证方式：读 `<persistenceKey>:workspace` 快照的 `paneIds`，而非数屏幕上的 tab。
> 「赢竞态」那一轮恰好撞上 G2（面板宽度为 0），屏幕上只看得见 1 个 tab —— 若以 tab 计数
> 取证会得出完全错误的结论。输竞态那一轮宽度正常，5 个 tab 与快照一致，两者互为印证。

**成因**：首帧清单只有宿主内置 pane 时，`createPaneWorkspace` 按既有回退规则
`definition.initialPaneIds ?? [definition.panes[0]!.id]` 打开 `host:session-info`
（该回退来自 `host-builtin-panes` spec 的 Req 1.6，非本次引入）。清单补齐后
`reconcilePaneWorkspace` 遵循「只增不减」保留了它，于是比赢竞态的情形多一个 tab。

**为何不在本轮修**：

- 要消除该差异，就得在补齐时**关闭**那个回退打开的内置 pane。但 workspace 里
  **无法区分**「首帧回退打开的」与「用户主动打开的」——这与 Req 2.3 面对的是同一类
  信息缺失问题，解决它需要再引入一个「回退标记」概念并贯穿持久化，复杂度与回归风险
  都高于收益。
- 该偏差的用户可观察影响是**多出一个宿主内置面板**（会话信息），本身是有用的功能面板，
  不遮挡也不妨碍 agent 声明的 pane，与缺陷本体（agent pane 一个都打不开）不在一个量级。
- 强行关闭它与 Req 2「不得关闭用户可能想要的 pane」存在直接张力。

**若要修**：建议另立 spec，把「pane 是因何被打开的」（回退 / 初始集合 / 用户操作）
显式建模进 workspace 与持久化契约，而不是在本 spec 里打补丁。

## G2 — 面板宽度无持久化记录时回落为 0（既存问题，非本 spec 引入）

**现象**：删除 `<persistenceKey>:sidebar` 键后进入会话，面板容器 `clientWidth` 为 0，
`tablist` 的 `overflow: hidden` 使得**只有第一个 tab 可见**，其余 tab 虽在 DOM 中却被裁掉；
四个 pane 的 iframe 均已挂载但宽度为 0。

**证据**：真机实测。清空 `pi-web:aigc-studio:panes:*` 后首次进入，`panelW: 0`、
`tabCount: 1`，而同一时刻 workspace 已含 4 个 pane、iframe 也有 4 个。写回
`{"open":true,"width":915}` 并 reload 后 5 个 tab 全部正常显示。

**归属**：与 workspace ↔ definition 同步无关，是面板宽度自身的初值/回退逻辑问题。
排查本缺陷时一度被它掩盖（看起来像「pane 没打开」，实际是「打开了但宽度为 0 看不见」），
故记录在此以免下次重复误判。

**建议**：宽度缺省值应有非零回退（或按容器比例计算），另立 issue 处理。

## G3 — `persistenceKey` 不含 sessionId，布局跨会话共享

**现象**：`aigc-agent` 声明的 `persistenceKey` 是 `pi-web:aigc-studio:panes`，不含会话标识，
因此同一 agent 的**所有会话**共用一份面板布局。排查期间这导致「新建会话」也读到旧布局，
一度让人误判为「清空持久化无效」。

**归属**：这是 agent 侧的声明选择（`panes.config.persistenceKey`），宿主只是照办。
design 已将其列为 Out of Boundary。

**建议**：若希望布局按会话隔离，应由 agent 在 key 中带上会话维度，或由宿主提供
显式的「按会话隔离」选项——属于契约层面的讨论，不是本 spec 的修复对象。

## G4 — `packages/ui` 三个 logs pane 测试失败（已修复）

**失败用例**：

- `packages/ui/test/chat/pi-chat-logs.test.tsx` — `declares logs without auto-opening a React region`
- `packages/ui/test/chat/pi-chat-logs.test.tsx` — `opens logs only on demand and uses an HTML Guest iframe`
- `packages/ui/test/chat/pi-chat-logs-slot.test.tsx` — `does not render a logs contribution into the host tree`

### 归因（本文件初版写错了两处，此处更正）

初版写「这三个用例来自 PR #24」「很可能源于合并 PR #24 时的冲突解决」，**两条都不成立**：

- 测试文件来自更早的 `logging-system` spec（`93859f30` / `49894599`），PR #24 只是重写了它们；
- 在 **PR #24 分支上（`fd12f4f4`）直接跑同样红**（重装依赖后复验仍红），所以与合并无关。

初版还据「PR 的 CI 只红在 tier-guard」推断「当时是绿的」——这个推断的前提本身是错的，见 G5。

### 真因（两处，都已修）

**其一：`hasPanelRight` 判据取错来源**（`packages/ui/src/chat/pi-chat.tsx`）

`hasPanelRight = mergedPanes !== undefined`，而 `mergedPanes` **不含**宿主在
`showLogs && logsPanelVisible` 时注入的日志 pane。于是「只有注入的日志 pane、没有任何
内置/agent pane」时：`panesDefinition` 有值 → `keepPanesHostAlive` 把 aside 挂住，但
`showPanelRight` 为 false → 容器被打上 `aria-hidden="true"` 且宽度 0。

后果不止是测试红：**日志 pane 声明了却永远点不开** —— 连「新开 Pane」按钮都摸不到。
testing-library 的 `getByRole` 默认忽略 `aria-hidden` 子树，所以症状表现为「找不到按钮」。

修法：判据改取 `panesDefinition`。注意**不要**顺手把 `hasSurfacePanel` 一起改（源码注释
曾要求两者同时改）——那一个问的是「有没有承载 agent surface 的面板」，注入的日志 pane
不承载 surface，不该让它开启空闲控制流。两者在此刻意分岔，已在代码注释中写明。

**其二：`iframe src` 断言形态过时**（`packages/ui/test/chat/pi-chat-logs.test.tsx`）

`createLogsPaneDocument()` 已改为 HTML Guest 形态（`kind: "html"` + `src: "/pane-logs.html"`，
配套构建期写出 `public/pane-logs.html`），而断言仍期望 `data:text/html`（更早的 inline
srcDoc 形态）。该断言与**本用例自己的标题**（「uses an HTML Guest iframe」）自相矛盾，
判定为断言未跟上形态变更，已改为 `toBe("/pane-logs.html")` 并补断 `srcdoc` 不存在。

### 验证

修复后这两个文件 4/4 绿，`packages/ui` 全量 **114/114 文件、950/950 用例**全绿
（此前为 `2 failed | 112 passed`）。

红对照两轮，证明修复有判别力而非「把红改没」：把 `hasPanelRight` 改回 `mergedPanes`
→ 精确报红 3 个（正是原失败集）；把日志文档改回 inline → 精确报红 1 个（正是被改的断言）。

## G5 — CI 首错即停，6 个 workspace 包从不被验证（严重，未修）

**证据**：同一份代码，本地 `pnpm -r` 跑出 **20 组**测试汇总，PR #24 的 CI 只有 **14 组**。
缺失的第 20 组正是 `packages/ui`（114 个测试文件）。

**成因**：CI 的 test job 跑 `pnpm test`（即 `pnpm -r --workspace-concurrency=1 run test`），
`pnpm -r` 首错即停。`packages/core` 的 `tier-guard` 一红，其后包括 `packages/ui` 在内的
6 个包便再也不跑。job 耗时 4 分钟、timeout 是 30 分钟，**不是超时**。

**后果**：`tier-guard` 一红，后面全瞎。G4 那三处失败正是这样长期不可见的 —— PR #24 的
CI 报「只有 tier-guard 失败」，看起来像「其余全绿」，实际是「其余没跑」。**「没跑」与
「跑了且全绿」在 CI 摘要里长得一模一样**，这正是本仓多次踩到的同一类陷阱。

**建议**（注意其中一个显而易见的做法是**有害**的）：

- ⚠ **不要直接加 `pnpm --no-bail`**。实测其语义是「即使有失败也以 **0 退出码**退出」
  （`pnpm run --help` 原文），直接加上去会让 CI 从「漏跑一半」变成「永远绿」，比现状更糟。
- 可行方向：写一层薄包装，逐包跑测试并收集每包结果，**全部跑完后**按「是否存在失败」
  显式决定退出码；或用 `--no-bail` 跑完再自行解析各包结果并显式 `exit 1`。
- 另外值得加一道机械校验：在 job 末尾比对「实际产生测试汇总的包数」与「声明了
  `test` script 的包数」，使**漏跑本身可被机械发现**，而不是靠人去数汇总行——
  本次正是靠手工数出「本地 20 组 vs CI 14 组」才发现的。
