# Research & Design Decisions

## Summary
- **Feature**: `detoolspec-unify-builtin-tools`
- **Discovery Scope**: Extension(对既有 `packages/tool-kit` 的内聚重构)
- **Key Findings**:
  - `compileTool` 底层是 `defineTool`(`@earendil-works/pi-coding-agent`),其 `ToolDefinition.execute` 第 5 参即 `ExtensionContext`(含 `ctx.ui`)(`engine/compile-tool.ts:517-523`)。**交互补全在 `customTools` 形态下本就可用,转 extension 是形态统一决策,非能力缺口。**
  - `AgentDefinition.extensions?: Array<string | ExtensionFactory>`(`agent-kit/src/types.ts:79`)支持进程内 factory 函数,且 runner 已透传(`server/src/runner/option-mapper.ts:121-123`)。AIGC 可写成 in-process `ExtensionFactory` 经 `extensions: [...]` 挂载,无需磁盘路径/install/强制注入。
  - `engine/` 中只有 `compile-tool.ts` 与 `types.ts` 的声明层类型是 ToolSpec 专属;`endpoint-adapter`/`var-resolver`/`normalize-image`/`proxy-fetch` 与 ToolSpec 无关,可保留为通用 util。
  - provider 工厂(`dashscope`/`newapi`/`openrouter`)的 `buildBody`/`pickResult`/`detectError`/`async` 逻辑是真实价值,与 ToolSpec 无关,仅 `ModelRoute` 的 `model`/`label` 路由元数据是包装。

## Research Log

### 现状装配链与消费者
- **Context**: 确认 AIGC 当前如何到达 agent,改装配会影响谁。
- **Sources Consulted**: `examples/aigc-agent/index.ts`、`aigc/index.ts`、`runtime.ts`、`server/src/runner/option-mapper.ts`、`attachment/seam.ts`、`attachment-wiring.ts`。
- **Findings**:
  - `examples/aigc-agent` 经 `customTools: buildAigcTools()` 装配;`buildAigcTools` = `AIGC_TOOLS.map(compileTool)`(`aigc/index.ts:39-49`)。
  - 附件能力经 globalThis seam(`SEAM_KEY`)在 runner 装配,工具内 `getAttachmentToolContext()` 取用;与工具来源(customTools/extension)无关。
  - attachment-bridge 闸门(`beforeToolCall`/`afterToolCall`)按 args 的 `att_` 引用工作,与工具来源无关(`attachment-wiring.ts`)。
- **Implications**: 改为 extension 装配只动 `examples/aigc-agent` 与 tool-kit 导出面;seam 与闸门不受影响,零外溢可达成。

### compileTool 编排可被无损抽取
- **Context**: 去掉 compileTool 后两工具如何不重复编排。
- **Sources Consulted**: `engine/compile-tool.ts:372-495`(`runExecute`)。
- **Findings**: `runExecute` 的编排(必选项补全 → model 路由 → `checkRequiredVars` → attachment ctx 检查 → `resolveMediaFields` → `runEndpoint` → 乐观预览 → `persistPicked` → 结果组装)与 ToolSpec 的"声明式工具框架"无强耦合,可抽取为接收显式参数的运行时函数。
- **Implications**: 抽 `runImageTool` 运行时编排器,两工具 `execute` 共用;媒体字段从 `mediaKind` 自动遍历改为显式字段名列表。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 保 customTools,仅手写 ToolDefinition | 用 `defineTool` 手写,去 ToolSpec,仍 `customTools` | 改动最小 | AIGC 仍与 extension-manager/auto-title 形态不一,未达"统一" | 被否:不满足统一目标 |
| B. ExtensionFactory + `extensions`(选定) | AIGC 经 `pi.registerTool` 写成 in-process factory,`extensions:[aigcExtension]` 挂载 | 与既有 extension 形态一致;例子可跑;无强制注入 | 装配链改动中等 | 选定 |
| C. 完全手写零 helper | 两工具各写全套编排 | 最彻底去抽象 | ~150 行 ×2 重复、易漂移 | 被否:维护成本 |

## Design Decisions

### Decision: AIGC 以 in-process ExtensionFactory 装配(选 B)
- **Context**: 统一内置工具为 pi extension 形态(Req 2)。
- **Alternatives Considered**: A(保 customTools 手写)、B(ExtensionFactory)、C(强制注入文件路径)。
- **Selected Approach**: 新建 `aigc/extension.ts` 导出 `aigcExtension: ExtensionFactory`,内部 `pi.registerTool` 注册两工具;`examples/aigc-agent` 用 `extensions: [aigcExtension]`。
- **Rationale**: `extensions` 字段已被 runner 透传,in-process factory 无需文件/install;与 extension-manager 形态一致;非强制注入(并非所有 agent 都画图)。
- **Trade-offs**: 装配方式变更需回归"工具首轮可调用";换取形态统一。
- **Follow-up**: 验证 extension 注册时机在工具表构建前;验证 `noTools:"builtin"` 不影响 extension 工具。

### Decision: 保留运行时编排器 runImageTool(非声明式)
- **Context**: 去 compileTool 后避免两工具重复编排(Req 4.4)。
- **Selected Approach**: 抽 `aigc/run-image-tool.ts`,接收 `routes`/`defaultModel`/`requiredParams`/`mediaFields` 等显式参数,复用保留的通用 util 完成编排。
- **Rationale**: 它是运行时函数而非"声明式工具框架",符合去 ToolSpec 精神,同时消除重复。
- **Trade-offs**: 保留一个共享抽象,但其接口面远小于 ToolSpec(无 schema→ToolDefinition 编译、无 model enum 注入魔法)。

### Decision: types.ts 拆分而非整删
- **Context**: `runEndpoint` 依赖 `EndpointBehavior`/`AsyncSpec`/`PickedResult` 等执行层类型。
- **Selected Approach**: 新建 `engine/endpoint-types.ts` 收纳执行层类型;删除 `types.ts` 中的声明层类型(`ToolSpec`/`ModelRoute`/`InteractionSpec`/`EndpointInputSchema`/`JsonSchemaProp`/`MediaKind`/`Pricing`)。
- **Rationale**: 执行层类型是通用契约须保留;声明层类型是 ToolSpec 专属须删。

### Decision: provider 工厂去 ModelRoute 包装
- **Context**: 保留 provider 业务逻辑,去掉路由元数据(Req 4.3)。
- **Selected Approach**: 工厂改返回 `EndpointBehavior`(+ 轻量 `{ id, label }` 供 routes 表与描述使用);`model` 路由改由手写 `parameters.model`(`Type.Union`)+ `runImageTool` 的 `routes` 映射表达。
- **Rationale**: 把"选哪个 model"从声明式路由表移到手写工具的参数 + helper 查表,逻辑等价、去框架化。

## Risks & Mitigations
- **extension 注册时机** — in-process factory 的 `registerTool` 须在工具表构建前完成。缓解:集成测试断言两工具在会话就绪后即出现在 commands/tool 列表;e2e 首轮调用验证。
- **execute ctx 一致性** — AIGC 依赖 `ctx.ui.select/input` 与 `onUpdate`。缓解:`extension-manager.ts:199` 已实证 `pi.registerTool` 的 execute 拿 `ExtensionContext`;集成测试 mock `ctx.ui` 覆盖补全与取消路径。
- **零外溢回归** — 工具 result 形态若变会波及前端 renderer。缓解:`runImageTool` 复用现 `buildImageResult` 的 content/details 组装;集成测试断言 result 形态;e2e 校验。
- **悬空引用** — 删 ToolSpec 后残留 import 致编译失败。缓解:`pnpm typecheck` 全量 + grep 残留符号。

## References
- pi SDK 类型:`@earendil-works/pi-coding-agent`(`defineTool`/`registerTool`/`ExtensionFactory`/`ExtensionContext`/`ToolDefinition`/`AgentToolResult`)、`@earendil-works/pi-ai`(`Type`)。
- 计划稿:`docs/refactor-detoolspec-plan.md`。
