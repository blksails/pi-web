# Research & Design Decisions — rich-chat-ui

## Summary
- **Feature**: `rich-chat-ui`
- **Discovery Scope**: Extension(扩展 `@pi-web/ui` + `@pi-web/react`,并薄透传扩展 `@pi-web/protocol` + `@pi-web/server`)
- **Key Findings**:
  - `@pi-web/ui` 已有 `<PiChat>`、`PartRenderer`、`RendererRegistry`(单例+工厂)、`PiChatSlots`(header/footer/sidebar/messageActions)、`cn()`、自建 button/card/dialog/select 与 `streamdown` 的 `<Response>`、`PiReasoning`、`PiToolPart`。依赖已含 radix-dialog/radix-select、cva、clsx、lucide、streamdown、tailwind-merge —— **无需新增 npm 依赖**即可实现 AI Elements 等价元件。
  - `@pi-web/react` 已有 `usePiSession`/`usePiControls`/`useExtensionUI`、`PiTransport`、`createPiClient`、`ControlStore`(SSE 旁路 stats/extensionUiQueue)。`usePiControls` 已暴露 `getCommands()`+`commands` 状态。`PiClient` 已有 `getCommands/getMessages/getStats/getState` 与 `setModel/abort/...` 写方法,但**缺** `getAvailableModels/fork/getForkMessages`。
  - `@pi-web/protocol` 的 `RpcCommand` 已定义 `get_available_models`/`fork`/`get_fork_messages`/`get_commands`;`PromptRequest` 已支持 `images?: ImageContent[]`(`{type:"image",data,mimeType}`)。但缺这三者的 **REST DTO**。
  - `@pi-web/server` HTTP 路由为**逐命令显式注册**(`create-handler.ts` 注册表 + `routes/{command,query}-routes.ts`,每能力一个 `PiSession` 方法)。`set_model`→`POST /sessions/:id/model`、`commands`→`GET /sessions/:id/commands` 为既有范本。**无通用 control 透传端点**。
  - 因此"模型选择器(Req 4)"与"消息分支(Req 8)"要端到端可用,必须补齐 REST 薄透传(DTO + PiSession 方法 + 路由 + PiClient 方法)。

## Research Log

### 现有可复用接缝
- **Context**: 决定富 UI 复用哪些既有机制,避免重复造轮子。
- **Sources Consulted**: `packages/ui/src/{chat,parts,controls,registry,ui,lib}`、`packages/react/src/{hooks,client,transport,sse}`、`packages/protocol/src/{rpc,transport}`、`packages/server/src/http`。
- **Findings**:
  - `RendererRegistry`:`registerToolRenderer/registerDataPartRenderer` + `resolve*`,单例 `defaultRendererRegistry` + `createRendererRegistry()`。Sources 折叠可经 `registerDataPartRenderer("source", ...)` 接入。
  - `usePiControls.state`:每操作 `{pending,error}`,Submit/Selector 进行态可直接消费。
  - `PiTransport.sendMessages`:订阅 SSE `/stream` 后 `POST /messages`,是附件图片注入点。
- **Implications**: 富组件作为**新增**装配,复用注册表 + 插槽 + 控件 hooks;不改既有 `<PiChat>`。

### REST 薄透传范本
- **Context**: 需把已存在的 RpcCommand 暴露给前端。
- **Findings**: `command-routes.ts` 中 `POST /sessions/:id/model → session.setModel(provider, modelId)`;`query-routes.ts` 中 `GET /sessions/:id/commands → {commands}`。新增三能力严格镜像该范本。
- **Implications**: 新增 `PiSession.getAvailableModels()/fork(entryId)/getForkMessages()` + 路由 `GET /sessions/:id/models`、`POST /sessions/:id/fork`、`GET /sessions/:id/fork-messages` + `PiClient` 同名方法 + protocol REST DTO。无新 RPC 能力、不改会话/轮次语义。

### Web Speech / 附件 / 联网开关 可行性
- **Findings**: 浏览器 `SpeechRecognition|webkitSpeechRecognition`(lib.dom 类型,需运行时 guard);图片附件经 `FileReader`→base64→`ImageContent`;联网开关 pi 无对应能力,仅作 UI 状态 + prompt 提示传递。
- **Implications**: 三者均为 UI 层 + 薄 hook,降级路径明确(隐藏/禁用 + 可读提示),不阻断基本对话。

## Architecture Pattern Evaluation
| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 富组件进 `@pi-web/ui` + 薄透传补齐后端(选用) | 元件层 + `<PiChatPro>` 装配层 + react 数据 hooks + protocol/server REST 薄透传 | 可复用、端到端可用、符合 §13.1 分层开放包 | 触及 4 个包,但均为低风险镜像式扩展 | brief 决策 A |
| B. 仅在 Next app `components/ai-elements` 组装 | 最快、最贴近示例 | 不进共享包、复用性差;模型/分支仍缺后端 | 不满足开放包目标 | 被否 |
| C. 仅 UI/react 层,模型/分支全部降级隐藏 | 边界最小 | Req 4/8 失效,不满足"完成" | —— | 被否 |

## Design Decisions

### Decision: 薄透传扩展边界(把已存在 RpcCommand 暴露为 REST)
- **Context**: Req 4(模型选择器)/Req 8(分支)需 `get_available_models`/`fork`/`get_fork_messages`,但 REST 面缺失。
- **Alternatives Considered**:
  1. 全部降级隐藏(C)—— Req 4/8 失效。
  2. 加通用 control 透传端点 —— 偏离既有逐命令路由风格,影响面更大。
  3. 镜像 `setModel`/`commands` 范本,逐能力补 REST 薄透传(选用)。
- **Selected Approach**: rich-chat-ui 拥有这三能力的 REST 表面(protocol DTO + `PiSession` 方法 + 路由 + `PiClient` 方法 + react hook + ui 组件)。
- **Rationale**: RpcCommand 已存在,透传纯属"暴露"而非"新增能力";风险低且与现有范式一致;使特性端到端可交付。
- **Trade-offs**: 触及 `@pi-web/server`/`PiSession`(超出 brief 原列的 ui/react),但仅加镜像式方法,不改会话语义。
- **Follow-up**: 实现时确认 `PiSession` 底层 RpcChannel 能直接发送这三 command;e2e 验证模型切换与分支切换。

### Decision: 新增 `<PiChatPro>` 与现有 `<PiChat>` 并存
- **Selected Approach**: `@pi-web/ui` 新增导出 `<PiChatPro>`;`<PiChat>` 保持不变;app-shell 切到 `<PiChatPro>`。
- **Rationale**: 非破坏,保基线 483 测试全绿。

### Decision: AI Elements 等价元件自实现(不依赖 registry/CLI 联网)
- **Selected Approach**: 在 `packages/ui/src/elements/` 用既有依赖实现等价无状态元件;模型选择器用自定义轻量 popover(button + 受控面板 + 点击外部关闭),避免新增 `@radix-ui/react-popover`。
- **Rationale**: 离线可控、依赖稳定、不引入新基础设施。

### Decision: Sources 经 DataPartRenderer 接入,缺失则隐藏
- **Selected Approach**: 注册 `source` 类 data-part 渲染器;协议无 source chunk 时仅渲染已有 data-part,无则隐藏。源 chunk 的协议支持记为**可选 upstream**(Req 9.3 为 optional feature,降级可接受)。

## Risks & Mitigations
- 透传触及 `PiSession`/server → 镜像既有 `setModel` 路径,加专门单测 + 路由测试,保证不回归。
- useChat 图片附件流转 → 在 `PiTransport.sendMessages` 将 UIMessage 的图片/file part 映射为 `PromptRequest.images`,加 transport 单测。
- Web Speech 浏览器差异 → 运行时 feature-detect + 优雅降级,不纳入 e2e 硬断言(仅断言按钮存在性随能力变化)。
- 分支 fork 树复杂度 → 本期仅线性同级版本切换,完整树可视化记 downstream。
- 富组件 a11y → 复用 radix dialog/select 的可达性,自定义 popover 补 `aria-expanded`/键盘关闭。

## References
- `PLAN.md` §1/§4/§13.1/§13.4 —— 分层开放包与事件→UIMessage 设计权威来源
- `.kiro/specs/rich-chat-ui/brief.md` —— discovery 决策(Decisions 1–5)
- AI SDK v5 `useChat` / `ChatTransport` —— 流式态与消息发送契约(已在 `@pi-web/react` 实现)
- Web Speech API(MDN)—— 浏览器本地转写,运行时 feature-detect
