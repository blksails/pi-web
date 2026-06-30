# Requirements Document

## Introduction

pi-web 框架的内置工具当前存在两种并行机制:AIGC 工具(`image_generation` / `image_edit`)走声明式 `ToolSpec` + `compileTool` 通用编译器 + `customTools` 装配;而 `extension-manager` / `auto-title` 走普通 pi extension(`pi.registerTool` / `registerCommand`)。`ToolSpec` 这层声明式工具框架几乎只对 AIGC 的"多 provider × 多 model 同构 HTTP 调用"划算,却被当作通用"内置工具框架",抬高了认知与维护成本。

本特性删除 `ToolSpec` 类型与 `compileTool` 通用编译器,把 AIGC 工具改写为基于 `pi.registerTool` 的进程内 `ExtensionFactory`(经 `AgentDefinition.extensions` 装载),使所有内置工具统一为普通 pi extension 形态;同时保留附件 seam 与通用执行层并降级为可被任意手写 `execute` 复用的共享工具集。重构以"对最终用户与 agent 不可见(画图功能、工具协议形态完全不变)"为硬约束。

详细技术计划见 `docs/refactor-detoolspec-plan.md`。

## Boundary Context

- **In scope**: `packages/tool-kit` 内 AIGC 工具与 `engine/` 的重构;`examples/aigc-agent` 的装配方式改动;`tool-kit` 主入口与 `runtime` 子入口的导出面调整;相关单元/集成/e2e 测试与 `docs/product` AIGC 章节更新。
- **Out of scope**: `extension-manager` / `auto-title`(已是 pi extension,不改);附件存储后端实现;前端 renderer / webext 组件;SSE 协议 schema;provider 端点的 HTTP 请求/响应业务逻辑(保留不改)。
- **Adjacent expectations**: 依赖 pi SDK 提供的 `pi.registerTool` / `ExtensionFactory` 与 `AgentDefinition.extensions` 装载能力;依赖 runner 的 option-mapper 透传进程内 `extensions`;依赖 runner 装配的 attachment seam(globalThis)与 attachment-bridge 闸门。

## Requirements

### Requirement 1: AIGC 图像工具的最终行为保持不变

**Objective:** As an agent author / 最终用户, I want AIGC 文生图与图像编辑能力在重构后完全照常工作, so that 重构对使用方不可见。

#### Acceptance Criteria
1. The AIGC 能力 shall 继续以工具名 `image_generation` 与 `image_edit` 暴露给 LLM。
2. When LLM 调用 `image_generation` 并提供 `prompt`, the AIGC 工具 shall 生成图像、落附件存储并以签名 URL 回流对话。
3. When LLM 调用 `image_edit` 并提供 `image` 与 `prompt`, the AIGC 工具 shall 完成图像编辑、落附件存储并回流产物引用。
4. The AIGC 工具的 tool result shall 保持现有 `content` 形态(文本说明 + `![name](displayUrl)` markdown 图)与 `details` 形态(成功为 `{ ok:true, model, assets[] }`,失败为 `{ ok:false, error }`)不变。
5. The AIGC 工具 shall 继续支持现有全部参数(`prompt`/`n`/`size`/`negative_prompt`/`background`/`quality`/`moderation`/`model`,以及编辑专属 `mask`/`reference_images`/`response_format`)与现有全部 model 路由(`gpt-image-2`/`wan2.7-image-pro`/`wan2.7-image-pro-bailian`/`qwen-image-edit-max`/`wan2.7-image-edit-bailian`)。

### Requirement 2: 内置工具统一为 pi extension 装配形态

**Objective:** As a framework maintainer, I want AIGC 工具以普通 pi extension 形态提供, so that 所有内置工具采用一致的注册与装配机制。

#### Acceptance Criteria
1. The AIGC 能力 shall 以进程内 `ExtensionFactory`(`aigcExtension`)提供,并经 `pi.registerTool` 注册 `image_generation` 与 `image_edit`。
2. When `examples/aigc-agent` 启动, the agent shall 经 `AgentDefinition.extensions: [aigcExtension]` 装载 AIGC 工具,而不再经 `customTools`。
3. The Tool-Kit 包 shall 不再提供 `buildAigcTools` / `AIGC_TOOLS` 等以 `customTools` 装配 AIGC 的入口。
4. Where agent 设置 `noTools: "builtin"`, the AIGC extension 注册的工具 shall 仍然可用。
5. When AIGC extension 被装载, the AIGC 工具 shall 在会话工具表构建完成前完成注册,使 LLM 首轮即可调用。

### Requirement 3: 移除声明式 ToolSpec 引擎

**Objective:** As a framework maintainer, I want 删除 ToolSpec 声明式工具框架, so that 内置工具不再背负只服务单一形态的通用抽象。

#### Acceptance Criteria
1. The Tool-Kit 包 shall 不再包含 `ToolSpec` 类型定义与 `compileTool` 通用编译器。
2. The Tool-Kit 主入口 shall 不再导出声明层类型(`ToolSpec`/`EndpointInputSchema`/`JsonSchemaProp`/`MediaKind`/`ModelRoute`/`InteractionSpec`/`Pricing`)。
3. The Tool-Kit `runtime` 子入口 shall 不再导出 `compileTool` / `CompileDeps` / `ToolExecuteDetails` / `buildAigcTools` / `AIGC_TOOLS`。
4. If 任何仓库内代码仍引用已移除的 ToolSpec 符号, the workspace typecheck shall 失败(即重构须无悬空引用)。

### Requirement 4: 保留通用执行层与附件 seam 为可复用工具集

**Objective:** As an author of any 手写内置工具, I want 通用执行与附件能力以独立工具函数形式可用, so that 不依赖 ToolSpec 也能复用这些缝隙能力。

#### Acceptance Criteria
1. The Tool-Kit `runtime` 子入口 shall 继续导出通用执行层(`runEndpoint`/`resolveVars`/`resolveVarsOptional`/`checkRequiredVars`/`proxyFetch`/`normalizeImageDataUri`)。
2. The Tool-Kit `runtime` 子入口 shall 继续导出附件 seam 与落库能力(`getAttachmentToolContext`/`SEAM_KEY`/`persistPicked`/`resolveInputToDataUri`)。
3. The provider 工厂(dashscope / newapi / openrouter) shall 保留其 `buildBody` / `pickResult` / `detectError` / 异步轮询逻辑与端点常量,仅去除 `ModelRoute` 路由元数据包装。
4. The 运行时编排器(`runImageTool`) shall 复用上述通用工具完成"必选项补全 → model 路由 → 环境变量检查 → attachment 检查 → 媒体解析 → 端点调用 → 乐观预览 → 落库 → 结果组装",并被 `image_generation` 与 `image_edit` 的 `execute` 共同调用。

### Requirement 5: 交互补全与降级行为保持

**Objective:** As a 最终用户 / operator, I want 缺参补全与各类降级行为与重构前一致, so that 失败可控、体验不退化。

#### Acceptance Criteria
1. When 必选项(`model`/`size`/`prompt`)缺失且存在交互 UI(`ctx.hasUI` 且 `ctx.ui` 可用), the AIGC 工具 shall 经 `ctx.ui.select`(model/size)或 `ctx.ui.input`(prompt)提示补全。
2. If 用户取消补全(返回空), the AIGC 工具 shall 返回 `ok:false` 且不发起 provider 调用。
3. If 必选项缺失且无交互 UI 且无 fallback, the AIGC 工具 shall 返回 `ok:false`(`size` 有 fallback、`model` 回退 `defaultModel`、`prompt` 无兜底则失败)。
4. If 所选 model 的所需环境变量缺失, the AIGC 工具 shall 返回 `ok:false` 降级且不崩溃子进程。
5. If attachment 上下文不可用, the AIGC 工具 shall 返回 `ok:false` 降级。
6. If provider 返回零有效图像产物, the AIGC 工具 shall 返回 `ok:false` 而非误导性成功。
7. When 输入图字段为 `att_` 引用, the AIGC 工具 shall 将其解析为 data URI 并经 `normalizeImageDataUri` 规范化后再传给 provider。

### Requirement 6: 前端与协议零外溢

**Objective:** As a framework maintainer, I want 重构不波及前端与协议, so that 改动范围被限制在内置工具层。

#### Acceptance Criteria
1. The 重构 shall 不改变 SSE 协议 schema 与 `protocolVersion`。
2. The 重构 shall 不要求前端 renderer 或 webext 组件做任何改动。
3. The attachment-bridge 闸门(`beforeToolCall` 属主校验 / `afterToolCall` base64 剥离) shall 对经 extension 注册的 AIGC 工具继续生效。
4. The Tool-Kit 主入口 shall 保持前端安全(不在主入口引入 pi SDK / node-only 运行时值导入)。

### Requirement 7: 测试与 e2e 验证

**Objective:** As a framework maintainer, I want 重构以新鲜证据被验证, so that 行为不变与降级路径均有回归保障。

#### Acceptance Criteria
1. The 重构 shall 保留并通过通用工具测试(`endpoint-adapter` / `var-resolver` / `normalize-image` / `proxy-fetch` / `persist` / `seam`)。
2. The 重构 shall 以单元/集成测试覆盖 `runImageTool` 编排与 `aigcExtension` 的工具注册及 `execute`(mock provider、mock attachment ctx、mock `ctx.ui`),含成功路径与各降级路径。
3. When 经 `extensions: [aigcExtension]` 装载 `aigc-agent` 并调用 `image_generation`(stub provider), the e2e shall 验证产物成功回流且工具 result 形态符合 Requirement 1.4。
4. The workspace shall 通过 `pnpm typecheck`(`strict`、无 `any`)与受影响包的测试,并以新鲜运行输出为证据。
