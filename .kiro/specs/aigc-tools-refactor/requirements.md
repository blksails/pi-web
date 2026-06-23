# Requirements Document

## Introduction

本规格重构 `@pi-web/tool-kit` 现有的 AIGC 生成工具(`aigc-generation-tools` spec 的产物)。原架构以 `Category` + `variants[]` 双层抽象承载工具与多 provider 变体,`model` 仅作自由字符串、`size`/`n` 等参数藏在不可见的 `userParams`。本次重构将其**拍平**:`model` 升为 LLM 可见的枚举入参并在运行时路由到对应执行声明;工具参数对齐 OpenAI Images API 并提升进可见 schema;工具按 OpenAI 端点拆分为 `image_generation` 与 `image_edit` 两个 snake_case 工具。多 provider 能力(DashScope / NewAPI / OpenRouter)保留,仅由以 `model` 为中心的路由表承载。

消费者有两类:**LLM agent**(调用工具、选择 model、传参)与**集成开发者**(装配工具、消费导出 API)。两者的可观察契约——工具名、参数 schema、model 枚举、降级行为、导出符号——是本规格的需求对象。

## Boundary Context

- **In scope**:
  - `image_generation`、`image_edit` 两个工具的名称、参数 schema、model 枚举与默认 model。
  - `model` 作为 LLM 可见入参的路由语义(命中 / 缺省 / 非法回退)。
  - 多 provider 路由项迁移到统一的 model 路由表;DashScope + NewAPI 的 model 在本轮工具声明中暴露。
  - 死字段移除与符号/目录重命名,且导出契约随之更新。
  - 宿主集成同步:示例 agent、Web 扩展工具渲染器键、扩展注册表。
  - 既有质量门(类型检查 / 单元测试 / 浏览器 e2e)在重构后保持绿。
- **Out of scope**:
  - `image_variation` 工具(variations 端点在 OpenAI 体系仅 `dall-e-2` 支持,而 `dall-e-*` 已被排除,故本轮不建)。
  - OpenRouter 的具体 model 在工具声明中的暴露(provider 工厂保留以备后续,但本轮不进任一工具的 model 列表)。
  - 新增计费、面板侧栏渲染、本地执行(`runLocal`)等既有未启用能力。
- **Adjacent expectations**:
  - attachment store 接缝(`AttachmentToolContext` 经 globalThis 注入)与分层存储行为不变,工具仍据此落库产物并回引用。
  - 前端 bundle 的 externals 边界不变:声明层从主入口导出、执行层仅从 `runtime` 子入口导出。
  - pi tool result 消息流仅携带 `content`、不携带 `details` 的既有事实不变。

## Requirements

### Requirement 1: model 作为 LLM 可见入参与运行时路由

**Objective:** 作为调用工具的 LLM agent,我希望通过单一的 `model` 枚举入参选择具体模型,以便在一个工具内按需切换 provider/model 而无需理解内部变体抽象。

#### Acceptance Criteria
1. The tool-kit 编译器 shall 为每个工具追加一个可选的 `model` 入参,其取值枚举等于该工具所有路由项的 model 标识集合。
2. When LLM 在调用中提供了与某路由项匹配的 `model` 值, the tool-kit 编译器 shall 使用该路由项的执行声明完成调用。
3. When LLM 在调用中省略 `model`, the tool-kit 编译器 shall 使用该工具声明的默认 model 对应的路由项。
4. If LLM 提供了不在枚举内的 `model` 值, then the tool-kit 编译器 shall 回退到默认 model 并继续执行,而非报错中止。
5. The tool-kit 编译器 shall 在工具执行结果的结构化明细中记录本次实际使用的 model 标识。

### Requirement 2: image_generation 工具契约

**Objective:** 作为 LLM agent,我希望用 `image_generation` 工具从文本生成图像,并能控制张数、尺寸与 OpenAI 风格的生成参数,以便产出符合预期的图像。

#### Acceptance Criteria
1. The AIGC 工具集 shall 暴露一个名为 `image_generation` 的工具。
2. The `image_generation` 工具 shall 在其入参 schema 中包含必填的 `prompt` 与可选的 `model`、`n`、`size`、`negative_prompt`、`background`、`quality`、`moderation`。
3. The `image_generation` 工具 shall 提供 `wan2.6-t2i`、`qwen-image-pro`、`gpt-image-2` 三个可路由 model,且默认 model 为 `gpt-image-2`。
4. When 某次调用的目标 model 不消费某个 OpenAI 专属参数(如 `background`/`quality`/`moderation`), the `image_generation` 工具 shall 静默忽略该参数而非报错。
5. When 生成成功, the `image_generation` 工具 shall 将产出图像经 attachment store 落库,并在工具结果的 `content` 中携带可在前端渲染的图像引用。

### Requirement 3: image_edit 工具契约

**Objective:** 作为 LLM agent,我希望用 `image_edit` 工具按指令编辑一张已有图像(可选遮罩与参考图),以便对上传或既有图像做局部或整体修改。

#### Acceptance Criteria
1. The AIGC 工具集 shall 暴露一个名为 `image_edit` 的工具。
2. The `image_edit` 工具 shall 在其入参 schema 中包含必填的 `image` 与 `prompt`,以及可选的 `mask`、`model`、`n`、`size`、`reference_images`、`response_format`。
3. The `image_edit` 工具 shall 提供 `qwen-image-edit-max`、`gpt-image-2` 两个可路由 model,且默认 model 为 `qwen-image-edit-max`。
4. When `image`、`mask` 或 `reference_images` 的取值为 attachment 公开 id(`att_` 前缀), the `image_edit` 工具 shall 在发往 provider 前将其解析为可直接消费的内联数据。
5. When 目标 model 不支持遮罩(如 `gpt-image-2` 之外的整图改写路径或反之), the `image_edit` 工具 shall 按该 model 的能力处理而不因无关参数中止。

### Requirement 4: 多 provider 路由项保留与迁移

**Objective:** 作为集成开发者,我希望 DashScope、NewAPI、OpenRouter 三个 provider 的执行声明在新路由模型下继续可用,以便后续无需重写即可扩充 model。

#### Acceptance Criteria
1. The AIGC 工具集 shall 保留 DashScope、NewAPI、OpenRouter 三个 provider 的路由项工厂,且其返回类型对齐新的 model 路由项类型。
2. The DashScope 路由项 shall 继续支持其同步与异步(轮询)两种执行形态。
3. While provider 调用所需的环境变量缺失, the tool-kit 编译器 shall 返回「能力不可用」的降级结果而非崩溃子进程。
4. Where OpenRouter provider 工厂被保留, the AIGC 工具集 shall 在本轮不将其 model 纳入任一工具的 model 枚举。

### Requirement 5: 抽象拍平、死字段移除与符号重命名

**Objective:** 作为集成开发者,我希望废弃的多变体抽象与无消费者的字段被移除、符号与目录按新模型重命名,以便代码契约清晰一致。

#### Acceptance Criteria
1. The tool-kit shall 以 `ToolSpec` 取代 `Category`、以 `ModelRoute` 取代 `Variant` 作为公开类型契约。
2. The tool-kit shall 将编译函数命名为 `compileTool`、工具集常量命名为 `AIGC_TOOLS`,并使工具声明位于 `aigc/tools` 目录。
3. The tool-kit shall 移除无消费者的 `CategoryUi`、`userParams`、`paramOverrides`、`ProviderOption` 等字段与类型。
4. The tool-kit 主入口 shall 仅导出声明层符号,其导出列表随重命名同步更新且不再引用已删除的旧符号。

### Requirement 6: 前端边界与降级语义保持(回归保护)

**Objective:** 作为集成开发者,我希望重构不破坏既有的前端 bundle 边界与容错语义,以便宿主应用与会话流程不发生回归。

#### Acceptance Criteria
1. The tool-kit 主入口 shall 不直接或间接顶层引入 pi SDK、pi-ai 或 undici 等运行时库;执行层符号仅从 `runtime` 子入口导出。
2. If attachment 上下文未注入(`available===false`), then the tool-kit 编译器 shall 返回降级结果而非抛出未捕获错误。
3. If provider 返回业务错误或无有效图像产物, then the tool-kit 编译器 shall 返回 `ok:false` 的结构化错误结果。
4. The tool-kit 编译器 shall 在工具执行的任何失败路径上返回结果对象而非使 runner 子进程崩溃。

### Requirement 7: 宿主集成同步

**Objective:** 作为集成开发者,我希望示例 agent 与 Web 扩展渲染层随工具重命名一并更新,以便端到端链路在新工具名下继续工作。

#### Acceptance Criteria
1. The 示例 aigc-agent shall 以新工具名 `image_generation` 与 `image_edit` 装配工具,且其系统提示引用的工具名与参数与新契约一致。
2. The aigc-agent Web 扩展 shall 以 `image_generation` 与 `image_edit` 为键注册其工具渲染器。
3. When 用户在浏览器中触发 `image_generation` 或 `image_edit`, the aigc-agent Web 扩展 shall 将其图像产物渲染为图片,并保留默认工具卡片外观与 图片/JSON 视图切换。

### Requirement 8: 质量门与端到端验证

**Objective:** 作为集成开发者,我希望重构后类型检查、单元测试与浏览器 e2e 全绿,以便确认契约变更未引入回归。

#### Acceptance Criteria
1. The tool-kit shall 在重构后通过 TypeScript 类型检查且无类型错误。
2. The tool-kit shall 更新受影响的单元测试以对齐新类型、新符号与新工具契约,且单元测试套件通过。
3. When 在隔离 e2e 环境运行, the aigc-agent shall 完成至少一次真实 `image_generation` 调用并落库产物,且浏览器中即时调用与历史回放的工具卡片展示一致。
