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

## G4 — `packages/ui` 三个 logs pane 测试既存失败（非本 spec 引入，但需追查）

**失败用例**：

- `packages/ui/test/chat/pi-chat-logs.test.tsx` — `declares logs without auto-opening a React region`
- `packages/ui/test/chat/pi-chat-logs.test.tsx` — `opens logs only on demand and uses an HTML Guest iframe`
- `packages/ui/test/chat/pi-chat-logs-slot.test.tsx` — `does not render a logs contribution into the host tree`

**症状**：三者均报 `Unable to find an accessible element with the role "button" and name "新开 Pane"`，
页面只渲染出空态（「有什么可以帮你的?」），`PanesHost` 根本没出现。错误堆栈里
**没有任何 panes-kit / instances.ts / panes-host 的帧**。

**归属证据**：用 `git stash` 把本 spec 的全部改动撤下后跑同一组测试，失败数完全相同
（`pi-chat-logs` 2 failed、`pi-chat-logs-slot` 1 failed）。故**与本 spec 无关**。

**但需要追查**：这三个用例来自 PR #24（`aigc-pane-desktop-integration`），而该 PR 自身的
CI test job 只红在 `tier-guard` 一项，说明它们当时是绿的。合并该 PR 时曾手工解决
`packages/ui/src/chat/pi-chat.tsx` 的语义冲突（采纳 PR 的「日志仅作声明式 Guest Pane」
新语义，同时保留两层 panes 形态归一），**这三处失败很可能源于那次冲突解决**。

**建议**：单独排查，不要与本 spec 的改动混在一起判断。
