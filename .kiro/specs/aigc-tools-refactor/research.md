# Research & Design Decisions

## Summary
- **Feature**: `aigc-tools-refactor`
- **Discovery Scope**: Extension(对 `aigc-generation-tools` 既有产物的重构)
- **Key Findings**:
  - 现状**已有** `model` 作为 LLM 入参(`compile-category.ts` 追加可选 `model` 自由字符串,`selectVariant` 按其路由)。"废弃 variants" 的真实 delta 不是引入 model 路由,而是:把 `Category`+`variants[]` 双层抽象拍平为 `ToolSpec`+`models[]`、把 `model` 从自由 string 收紧为 enum、把藏在 `userParams` 的参数提升进可见 `inputSchema`、按 OpenAI 端点拆工具。
  - `paramOverrides`/`ProviderOption`/`altProviders`/`CategoryUi.icon`/`CategoryUi.placement` 在 compile 与 runEndpoint 中**零消费**(死字段),与 `userParams` 一并可安全删除。`CategoryUi.label` 是唯一消费点 → 提升为 `ToolSpec.label`。
  - 执行原语 `EndpointBehavior`/`runEndpoint`/`AsyncSpec`/attachment 落库链全部可复用——`runEndpoint` 吃 `EndpointBehavior`,`ModelRoute = EndpointBehavior & {model,label}` 直接兼容,无需改执行引擎。

## Research Log

### 现状路由与参数可见性
- **Context**: 判断重构对编译器与 provider 的影响面。
- **Sources Consulted**: `engine/compile-category.ts`、`engine/types.ts`、`engine/endpoint-adapter.ts`、`aigc/providers/{dashscope,openrouter,newapi}.ts`、`aigc/categories/{text-to-image,image-edit}.ts`。
- **Findings**:
  - `buildParameters` 已注入可选 `model: Type.String`(自由文本),`selectVariant` 实现 args.model > defaultVariant > 首项的回退。
  - provider 工厂返回 `Variant`,其字段即 `EndpointBehavior` + `{name,label,description}`;`name` 充当路由键。
  - 生图 provider 的 args 已用 `prompt`/`negative_prompt`/`size`/`n`;编辑 provider 用 `instruction`/`image_url`/`mask_url`/`reference_image_urls`(需 OpenAI 化为 `prompt`/`image`/`mask`/`reference_images`)。
- **Implications**: 编译器改动集中在「`model` 改 enum + 字段/类型重命名 + 删 userParams 链」;provider 改动集中在「编辑工具字段改名 + 新 OpenAI 参数透传 + 返回类型 Variant→ModelRoute」;执行引擎零改动。

### NewAPI 网关 model 可用性
- **Context**: 用户给的是 OpenAI 官方文档参数(dall-e-2/3、gpt-image-1),不等于自建 NewAPI 网关支持这些 model 名。
- **Findings**: 上一轮浏览器 e2e 经 `gpt-image-2` 实际生成成功(水墨竹);`dall-e-*`/`gpt-image-1` 未经该网关验证。
- **Implications**: `image_generation` 默认 model 取经验证的 `gpt-image-2`;不盲目假设网关支持 OpenAI 标准 model 名。

## Design Decisions

### Decision: 拍平 variants 为 model 路由表(保留路由本质)
- **Alternatives Considered**:
  1. 彻底转单 provider OpenAI 兼容端点 — 丢弃 DashScope 异步/OpenRouter。
  2. 保留多 provider,以 `model` 为中心的路由表承载(用户选定)。
- **Selected Approach**: `ToolSpec.models: ModelRoute[]` + `defaultModel`;`ModelRoute.model` 既是 LLM enum 取值也是路由键。多 provider 由各 ModelRoute 的 `EndpointBehavior` 承载。
- **Rationale**: 满足"保留多 provider"且去掉双层抽象;执行引擎无需改。
- **Trade-offs**: model enum 是异构 model 名并集(OpenAI 与 DashScope 命名风格不同);OpenAI 专属参数对非 OpenAI model 由 buildBody 静默忽略。

### Decision: image_variation 暂缓
- **Context**: variations 端点在 OpenAI 体系仅 `dall-e-2` 支持,而 `dall-e-*` 被用户排除。
- **Selected Approach**: 本轮不建该工具;provider 工厂层不新增 variation 路径。
- **Follow-up**: 后续若网关支持 gpt-image 系 variations,再补工具与 model。

### Decision: 参数从 userParams 提升进 inputSchema,死字段删除
- **Selected Approach**: `size`/`n` 等改为 LLM 可见 schema 字段;删除 `userParams`/`paramOverrides`/`ProviderOption`/`CategoryUi`;`label` 提升至 `ToolSpec` 顶层。
- **Rationale**: 这些字段零运行时消费,保留只增维护面;参数可见性提升让 LLM 可控。
- **Trade-offs**: 移除了 `validateUserParams` 的 min/max 运行时校验;由 provider/上游 API 负责取值校验(可接受)。

## Risks & Mitigations
- **风险:gpt-image-2 之外的 OpenAI 标准 model 名网关不支持** — 默认用经验证的 `gpt-image-2`;其余不纳入本轮 enum。
- **风险:编辑工具字段改名(instruction→prompt 等)破坏既有 e2e/单测** — 同步更新 provider args、工具声明、测试夹具与 ownership 守卫(递归扫 `att_` 不受字段名影响)。
- **风险:主入口误引入运行时库破坏 externals 边界** — 保持 types/providers/tools 纯声明从主入口导出,`compileTool`/`buildAigcTools` 仅从 `runtime` 子入口导出;以单测/typecheck 守。

## References
- 既有 spec:`.kiro/specs/aigc-generation-tools/`(被本规格重构的原始产物)
- OpenAI Images API 参数(用户提供的端点规格:generations / edits / variations)
