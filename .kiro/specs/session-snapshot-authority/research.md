# Research Log — session-snapshot-authority

## 发现范围

扩展既有系统（light discovery）。前序已对 server / react / ui / protocol 四层做过文件级探查；本轮定向核对了精确形态，确认设计落点。

## 关键发现（带文件锚点）

### 协议层
- `packages/protocol/src/transport/sse-frame.ts`：`ControlPayloadSchema = z.discriminatedUnion("control", […])`，现有成员 `extension-ui / queue / stats / error / logs`（+ `ui-rpc` 由 web-ext 并入、`session-status` 由 `session-status.ts` 并入）。顶层 `SseFrameSchema` 以 `kind` 判别 `uiMessageChunk | control`。`makeControlFrame(payload)` 便捷构造器。
  - **含义**：新增 `session-state` 帧 = 仿照 `session-status.ts`，新建 `session-state.ts` 定义 schema 并入 `ControlPayloadSchema` 联合。零侵入、向后兼容（旧消费者 default 分支忽略）。
- **`control:"stats"` 帧已存在**（sse-frame.ts:30-32）。即「stats 双源」= 既有 stats 帧 + REST `GET /stats`。设计将 stats 收入权威快照，stats 帧过渡期保留。

### 服务端层
- `packages/server/src/session/pi-session.ts`：
  - `setLifecycle()`（:236）→ `lifecycleFrame()`（:219，`control:session-status`）→ 广播（:251）；`subscribe()` 回放 `logs`（:334）+ `lifecycle`（:341）——**这两帧即硬编码粘性回放**。
  - `CachedState`（session.types.ts:114）= `{ model, thinkingLevel, stats, state, updatedAt }`，被动、仅 REST 拉、不广播。
  - `_lifecycle` 已是单向状态机权威字段（session-readiness-handshake 落地）。
- `packages/server/src/rpc-channel/pi-rpc-process.ts`：`turnActive`（:124）在 `agent_start`→true（:532）、`agent_end`→false（:533）。**busy 信号已存在，仅未对外**。

### 前端层
- `packages/react/src/sse/control-store.ts`：`ControlSnapshot { queue, stats, error, extensionUiQueue, ambient, lifecycle }` 不可变快照；`applyControlFrame` switch 按 control 子类型更新（stats :171、session-status :198）；`getSnapshot` 稳定引用配合 `useSyncExternalStore`。**已是控制面 reducer**。
- `packages/ui/src/chat/pi-chat.tsx`：`isBusy = status==='submitted'||'streaming'`（:481，useChat 黑盒）；stats 轮询 effect（:481-498，`turnJustEnded` 触发 `getStats`）；`sessionReady` 取 `controls.lifecycle`（:514-516）；`canSubmit`（:549）；`data-pi-busy`（:1400，e2e 锚点）；就绪前开空闲控制流接粘性帧（:536-548，与 busy 门控耦合——改动须保留）。

## 综合（Generalization / Build-vs-Adopt / Simplification）

- **Generalization**：`subscribe()` 的「logs+lifecycle」硬编码回放是「晚订阅者收敛到最新 last-value」的两个特例 → 抽象为 `StickyFrameRegistry`（last-value Map），新增可重放状态仅需注册键。`CachedState` 是「会话权威状态」的被动雏形 → 升级为主动 `SessionSnapshot`（含 busy）。
- **Build-vs-Adopt**：复用既有 `z.discriminatedUnion` 帧机制、既有 `ControlStore` reducer、既有 `turnActive` 信号、既有 e2e（`PI_WEB_STUB_AGENT=1` + Playwright）。不引入新库。
- **Simplification**：不替换 `useChat`（AI SDK 黑盒）——绕过它，仅消费 `messages`，busy/stats/ready 改读权威快照。lifecycle 不再有第二来源：`session-state` 快照含 lifecycle，ControlStore 收到 session-state 时同步内部 lifecycle/stats，存量读者零改动。

## 设计决策与理由

1. **新增 `session-state` 帧而非改造 `session-status`**：保持 session-readiness-handshake 契约不变（就绪锚点不动），快照帧承载更宽状态；过渡期两帧并存满足 R8.3。
2. **busy 由纯 reducer 从 agent 事件派生**：`reduceSnapshot(prev, event)` 纯函数（R7.1）；扩展命令不发 `agent_start` → busy 永不置 true → 卡死从根消除。
3. **StickyFrameRegistry 仅管 last-value 粘性态**（lifecycle、session-state、未来扩展）；logs 仍走 ring-buffer 回放（不同语义，不强并）。
4. **ControlStore 收 session-state 时同步 lifecycle/stats 内部切片**：单一内部权威，存量 `controls.lifecycle/stats` 读者不改即受益；新增 `busy`、`session` 暴露。
5. **PART_KINDS 单一真相源**：仿现有 `data-part.ts` schema，提取 `Record<PartKind,{schema,fromEvent}>`；translate 与前端注册遍历它；契约测试遍历断言无孤儿（R6.5）。

## 风险

- 空闲控制流门控（pi-chat.tsx:536-548）与 busy 耦合：改 isBusy 来源须回归验证「就绪前不卡 / Tier3 控制流不破 prompt 流」。
- stub-agent（`lib/app/stub-agent-process.mjs`）需能驱动 session-state 帧路径，否则 e2e 覆盖不到——STEP1 验证点。
- STEP4 协议契约触及 data-part 渲染注册（pi-chat.tsx:334-340 等），最具侵入性，末位实施、独立可回退。
