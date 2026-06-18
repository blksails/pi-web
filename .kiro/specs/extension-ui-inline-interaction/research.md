# Research & Design Decisions

## Summary
- **Feature**: `extension-ui-inline-interaction`
- **Discovery Scope**: Extension（既有 UI 层改造）
- **Key Findings**:
  - 扩展 UI 是**旁路队列**（`ControlStore.extensionUiQueue`，FIFO），不在 `useChat` 的 `messages` 流内；交互请求是 agent 发起的瞬时 RPC 事件，**无"属于哪条消息"的锚点信息**。
  - 现状 `PiPermissionDialog`（`dialog/pi-permission-dialog.tsx`）以 Radix 模态弹窗呈现 confirm/select/input/editor 四类；`useExtensionUI.respond` 成功即 `dequeueExtensionUi`，**无任何已应答历史**。
  - `PiChat`（`chat/pi-chat.tsx:584`）与 `PiChatBasic`（`chat/pi-chat-basic.tsx:198`）**两处**均内嵌 `<PiPermissionDialog>`，删除旧组件须同改两装配。
  - 已有原子组件 `ui/card.tsx`、`ui/button.tsx`，**无 `ui/alert.tsx`**；Card 足以承载内联卡，无需新增 shadcn 组件。
  - `SubmitButton` 已占用 `data-pi-submit`，内联卡提交钩子须改名避免冲突。

## Research Log

### 集成点：扩展 UI 数据通道与渲染锚点
- **Context**: 内联卡需要数据源与一个可承载的"消息流位置"。
- **Sources Consulted**: `packages/react/src/hooks/use-extension-ui.ts`、`packages/ui/src/chat/pi-chat.tsx`、`pi-chat-basic.tsx`、`elements/conversation.tsx`、`packages/protocol/src/rpc/extension-ui.ts`。
- **Findings**:
  - `useExtensionUI` 暴露 `queue`（FIFO 只读）、`current = queue[0]`、`respond(id, response)`、`error`、`pending`。成功 `respond` 后 hook 内部 `dequeueExtensionUi`，`queue[0]` 自动前进。
  - `Conversation` 渲染 `data-pi-conversation-viewport`（`overflow-y-auto`、`role="log"`、`aria-live="polite"`），`useAutoScroll` 贴底时自动滚到最新 children。
  - `PiChatBasic` 的消息区是 `data-pi-chat-messages` 的 `overflow-y-auto` div（同样 `role="log" aria-live="polite"`）。
- **Implications**: 内联卡作为消息流容器的**末尾子节点**渲染即可视觉内联、随流滚动，且无需触碰 `useChat`/transport/协议层。留痕在客户端组件本地维护。

### 技术对齐：复用既有 shadcn 等价层而非引入 AI Elements 包
- **Context**: 参考来自 AI SDK Elements 的 Confirmation/Suggestion，但项目自建 shadcn 等价层。
- **Findings**: 项目 `tech.md` 指明 UI 为 shadcn/ui（Radix + Tailwind）+ 自建 AI Elements 等价件；现有 `Suggestions`、`Notifications` 等均为自建无状态元件，主题走 CSS 变量、无硬编码颜色。
- **Implications**: 不引入 `@ai-sdk/elements` 依赖；以 Card + lucide 图标自建内联卡，沿用 `cn` 与 CSS 变量主题，与既有元件一致。

## Design Decisions

### Decision: 内联渲染锚点 = 消息流容器末尾（非 messages 数组）
- **Context**: 扩展 UI 请求无消息锚点，但要"内联在对话流中"。
- **Alternatives Considered**:
  1. 把请求转为 `UIMessage` data-part 注入 `messages` —— 需改 transport/`useChat`，违背旁路队列架构，工程大。
  2. 在消息流容器末尾、`ChatError` 旁渲染独立内联区 —— 视觉内联、随流滚动，零协议改动。
- **Selected Approach**: 方案 2。`PiInteraction` 作为 `Conversation` children（`PiChat`）/ 消息 div（`PiChatBasic`）的末尾节点渲染。
- **Rationale**: 满足"内联 + 弱打断"，且不破坏"扩展 UI 不入消息流（旁路队列）"既有契约。
- **Trade-offs**: 内联区不随某条历史消息定位，而是恒在流尾；对瞬时交互语义而言可接受。

### Decision: 应答留痕 = 组件本地 `useState`（mount 生命周期）
- **Context**: `respond` 成功即出队，需在 UI 侧留痕。
- **Alternatives Considered**:
  1. ControlStore 增 `resolvedExtensionUi` 历史 —— 改动 react/store 层，仍内存态、刷新丢，收益有限。
  2. 持久化进 session —— 改 transport/server，且交互为实时语义、重放意义有限。
  3. 组件本地 `useState` 记录 `resolved` 列表，出队后仍渲染终态。
- **Selected Approach**: 方案 3。`respond` 成功后把 `{ id, request, outcome }` 追加到本地 `resolved`。
- **Rationale**: 命令式、零跨层改动；生命周期=组件 mount 期，刷新/重连不恢复，恰好契合"瞬时交互"与需求 6 的非持久边界。
- **Trade-offs**: 刷新丢失留痕（已在需求 6 明示，非缺陷）。

### Decision: FIFO 串行 + 单组件命令式 API
- **Context**: 多请求与组件形态。
- **Selected Approach**: 仅 `queue[0]`（且未在 `resolved` 中）为 active 可应答；`resolved` 留痕按序堆其上方。单一 `PiInteraction` 组件，props 沿用旧签名 `{ extensionUI, className }`，不引入组合式子组件族。
- **Rationale**: 贴合既有 FIFO 队列语义与命令式调用约定（用户决策），避免乱序应答破坏 agent 预期；最小组件面。

### Decision: 删除 `PiPermissionDialog`，两装配改挂内联组件
- **Selected Approach**: 删除 `dialog/pi-permission-dialog.tsx` 及其在 `@pi-web/ui` 入口的导出；`PiChat`/`PiChatBasic` 移除 Dialog import 与挂载，改在消息流末尾挂 `PiInteraction`。
- **Rationale**: 用户确认直接删除；模态与内联两条渲染路径并存无必要。

## Risks & Mitigations
- **留痕与队列状态竞争**（出队时机 vs 本地记录）— `respond` 包装中"先 await 成功、再追加 resolved"，失败不追加；渲染时以 `resolved` 的 id 集合去重 active，避免重复卡。
- **可达性回退**（失去模态焦点捕获）— active 卡出现时 `scrollIntoView` + 聚焦首动作 + 容器 `role="group"`/`aria-live="polite"` 播报；非模态不做 focus trap（需求 5.4 要求不锁定）。
- **测试钩子破坏**（e2e/单测依赖 `data-pi-permission-dialog`）— 设计统一新钩子命名并在任务中显式列出 4 个 e2e 与 3 个单测的迁移点。
- **`data-pi-submit` 冲突** — 内联提交钩子改 `data-pi-interaction-submit`。

## References
- AI SDK Elements — Confirmation: https://elements.ai-sdk.dev/components/confirmation （内联、三态留痕的视觉参考）
- AI SDK Elements — Suggestion: https://elements.ai-sdk.dev/components/suggestion （本特性范围外，仅视觉参照）
- 既有规格 `extension-ui-surfaces`（ambient 能力与 e2e 基线）
