# Research Log — ui-components

## Discovery Scope

Greenfield React 组件库(`@blksails/ui`)。Discovery 类型:**Full(新特性)**,但因上游契约(`@blksails/react`、`@blksails/protocol`)与权威设计(`PLAN.md`)已稳定,研究聚焦"如何在既定契约上装配 AI Elements + 落地扩展点",而非外部技术选型探索。

## Key Findings

### 1. 上游契约已定,本层只装配与呈现
- `react-client/design.md` 已确定 `usePiSession`(暴露 `transport`/`status`/`error`/`close`)、`usePiControls`(`setModel`/`setThinking`/`abort`/`steer`/`followUp`/`getStats`/`getCommands` + `stats`/`commands`/操作态)、`useExtensionUI`(`queue`/`current`/`respond`/`error`)、`PiTransport`、`createPiClient`、可选 `PiProvider`。
- 结论:`@blksails/ui` 通过 props 接收这些 hooks 结果(或经 `PiProvider`),不重定义其行为;消息流来自 `useChat({ transport })`。

### 2. part 渲染映射来自 PLAN.md §4
- pi 事件已由 `session-engine` 翻译为 AI SDK `UIMessage` chunk:`text-*`→`Response`;`reasoning-*`→`<Reasoning>`;`tool-input-available`/`tool-output-available`→`<Tool>`;工具增量与 `compaction`/`auto_retry`/`queue` 为 `data-pi-*` part;`extension_ui_request` 走旁路(非 UIMessage)。
- 结论:本层 `PartRenderer` 按 part 类型分派即可,无需感知 SSE/翻译;工具三态对应 input-available(start)→ 累积 partialResult(update)→ output-available(end)。

### 3. 扩展点 = §13.4③ 渲染器注册表 + 插槽
- `registerToolRenderer(toolName, Component)` / `registerDataPartRenderer(type, Component)`:让 pi 扩展的 `customTool` / `setWidget`/`setStatus`/`notify` 部件映射到自定义 React UI。
- `<PiChat>` 暴露 header/footer/sidebar/messageActions 插槽。
- 决策:注册表用模块级单例 + `createRendererRegistry()` 工厂(可测隔离),`PartRenderer` 解析顺序「注册命中 → 默认回退」,重复注册覆盖语义。

### 4. 双分发 + 主题(§13.1 / §13.4)
- npm 聚合导出 + shadcn registry(`npx pi-web add chat`);主题全部走 shadcn CSS 变量,继承宿主。
- 决策:组件零硬编码颜色;AI Elements/shadcn 底座经 `npx ai-elements add`/`npx shadcn add` 生成纳入包内,作为脚手架任务。

## Architecture Decisions

- **Pattern**:Headless 消费 + 装配组件 + part 分派渲染 + 注册表扩展点。理由见 design.md「Architecture Integration」。
- **Build vs adopt**:文本/思考/工具/输入/操作的底层视觉采用 Vercel AI Elements(adopt),本层只做 pi 特化装配与三态/折叠/弹窗/控制(build)。避免重造 Markdown 流式渲染与 Radix primitives。
- **Boundary**:不绑定后端/路由(`app-shell`),不做非 React 嵌入(`embed-integrations`),仅依赖 `@blksails/react` + shadcn/AI Elements(brief 约束)。
- **类型来源**:协议派生类型(`ExtensionUIRequest`/`StatsResponse`/`CommandsResponse`/data-part type)从 `@blksails/react` re-export 消费,避免本层直接耦合 `@blksails/protocol`,保持单向依赖与单一上游接口。

## Synthesis Outcomes

- **Generalization**:工具与 data-part 的"可覆盖渲染"共用一套注册/解析机制(两张 map),`PartRenderer` 统一调用 `resolve* ?? 默认`。
- **Simplification**:控制面板组件(model/thinking/stats)接口同构(均接 `UsePiControlsResult`),共享操作态呈现约定;命令面板单独建模因其有键盘/过滤交互。
- **Testability**:`parts/` 与 `registry/` 不依赖 hooks → 可独立渲染/单元测试;`chat/`/`controls/`/`dialog/` 经 mock 会话(`test/fixtures/mock-session.ts`)测试;e2e 用 mock transport 脚本化推送 part。

## Risks

- AI Elements / `useChat` 大版本签名变化 → 装配集中于 `<PiChat>`/`PartRenderer`,变更面收敛(Revalidation Trigger)。
- AI SDK part 判别字段变化 → 集中于 `PartRenderer` 与注册表类型。
- 模块级单例注册表跨测试污染 → 用 `createRendererRegistry()` 隔离实例 + 重置入口。
- 扩展 UI 类别集合(select/confirm/input/editor)增减 → `<PiPermissionDialog>` 类别分派需同步。
