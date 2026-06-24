# Requirements Document

## Project Description (Input)
在 pi-web 移植/落地 AIGC 生成工具引擎(参考 pi-labs 的 aigc categories 体系)。

**首批范围(Wave 1)** 仅两个工具:
- `text_to_image`(文生图,含 sync / async 两类 provider)
- `image_edit`(图像编辑,验证附件输入 → 输出全链路)

**设计策略(spike-first):** 第一步用最直接方式把 `text_to_image` 端到端跑通(provider HTTP 调用 → attachment store 落库 → 工具结果用 **pi-web 默认工具卡片**渲染),据此验证「整体移植 pi-labs 声明式引擎(Category / Variant / EndpointBehavior)」vs「pi-web 原生手写 customTools」哪种引擎策略,再展开 `image_edit`。引擎策略是 design 阶段的待验证决策点。

Wave 1 的 variant / 生成参数**由 LLM 经工具 `inputSchema` 传参 + 固定默认 variant** 提供;**不做** web-ext 面板交互(见下「不在本范围」)。

**包结构决策(已定):** 引擎落地为**新建独立包 `@blksails/tool-kit`**(与 `agent-kit`/`web-kit` 后缀呼应,定位为 pi-web 的**通用工具套件 / 工具构建工具集**,provider-agnostic、可独立测试/复用)。AIGC categories 是它承载的**首批工具集**,而非包的全部——后续 builtin web tools 等可同栖于此。其中**执行半**(`EndpointBehavior` / `buildBody` / HTTP 调用 / async 轮询 / 密钥)只在 server/runner 侧消费,**绝不进前端 bundle**;**声明元数据半**(`category.label`/`icon`/`userParams`/`variants` 标签)需可序列化(类型契约归 `@blksails/protocol`);**Wave 1 暂不向前端下发**(面板后置),但包内分层须预留,使后续 Wave 接入面板时无需重构引擎。包内 AIGC 工具集建议归于子路径(如 `@blksails/tool-kit/aigc`),与未来其它工具集并列。

**关键接缝:**
- 工具作为 `customTools` 在 runner 子进程执行,并经 attachment-bridge `putOutput` 落 BlobStore(复用已实现并 e2e 通过的附件系统)。
- 工具结果 Wave 1 用 **pi-web 默认工具卡片**(`PiToolPart`)渲染,不注册自定义 renderer。

**不在本范围(后置至后续 Wave):**
- aigc web-extension 的 `panelRight` 面板(Tier1,选 variant/参数)。
- `renderers.tools` 自定义媒体卡片(Tier2,图/图集专用渲染)。
- session 级「面板状态(选中 variant / params)」跨 UI ↔ runner 进程通道(候选 web-ext Tier3 ui-rpc)及其与 LLM 传参的合并优先级。
- 声明元数据向前端下发(随面板一起后置)。

**参考实现(pi-labs):** `src/lib/aigc/{types,compile-category,endpoint-adapter,var-resolver}.ts` + `src/agents/aigc/categories/*` + `groups.ts`。pi-web 落地需解耦 pi-labs 自带的 DB/资产落库,改接 pi-web 的 attachment 存储。

## Introduction
本特性在 pi-web 引入 AIGC 生成类工具的首批能力(Wave 1):**文生图(`text_to_image`)** 与 **图像编辑(`image_edit`)**。工具由 agent 以 `customTools` 形式启用,LLM 通过工具参数驱动生成;产出经 pi-web 附件存储落库并以引用形式回流对话,在对话中以**默认工具卡片**呈现。引擎承载于新建的通用工具套件包 `@blksails/tool-kit`,AIGC 为其首批工具集。Wave 1 聚焦「调用 → 生成 → 落库 → 展示」的后端闭环,**不含**面板交互与自定义媒体卡片。

## Boundary Context
- **In scope**: `text_to_image` / `image_edit` 两个工具;LLM 经工具参数传 `prompt`/`instruction` 与生成参数;sync 与 async(轮询)两类 provider;产出落附件存储并回流引用;默认工具卡片展示;provider 密钥经环境变量;缺密钥 / 失败 / 超时的可读错误;声明式承载新工具与 provider 变体的包结构。
- **Out of scope(后置至后续 Wave)**: web-ext `panelRight` 面板;自定义媒体卡片 renderer;面板状态跨进程通道;声明元数据向前端下发;视频生成类工具;本地 ffmpeg 媒体处理工具;安装 / 卸载(pi PackageManager)集成。
- **Adjacent expectations**: 复用既有附件系统(BlobStore 落库、`att_<id>` 引用、属主校验、base64 仅在喂 LLM 出口物化、HMAC 签名分发 URL)与 runner 子进程的工具装配 / 钩子;本特性**不重造**附件存储,**不改** pi 协议(协议无文件引用原语)。

## Requirements

### Requirement 1: 文生图工具(text_to_image)
**Objective:** As an agent 作者/使用者, I want 通过文生图工具由文本提示生成图像, so that 在对话中直接获得可用的图片产出。

#### Acceptance Criteria
1. When agent 启用文生图工具且 LLM 以包含 `prompt` 的参数调用, the 文生图工具 shall 调用所配置的 provider 生成图像并返回成功结果。
2. When LLM 调用参数提供可选项(如 `negative_prompt`、尺寸、数量、变体/模型), the 文生图工具 shall 将这些参数应用于本次生成。
3. Where provider 为同步返回类型, the 文生图工具 shall 在单次请求内取得生成结果。
4. Where provider 为异步任务类型, the 文生图工具 shall 轮询任务状态直至完成或超时后返回结果。
5. When 生成成功, the 文生图工具 shall 产出一张或多张图像并以附件引用形式返回(见 Requirement 3)。
6. If provider 返回错误或超时, then the 文生图工具 shall 返回一条用户可读的失败说明且不中断会话。

### Requirement 2: 图像编辑工具(image_edit)
**Objective:** As an agent 使用者, I want 对已有图像按指令进行编辑, so that 在对话中迭代修改图片而无需离开会话。

#### Acceptance Criteria
1. When LLM 以包含编辑指令(`instruction`)与输入图像引用的参数调用, the 图像编辑工具 shall 解析输入附件并调用 provider 完成编辑。
2. When 调用参数提供可选的遮罩(mask)或参考图像引用, the 图像编辑工具 shall 将其用于本次编辑。
3. While 解析输入图像附件, the 图像编辑工具 shall 校验调用者对该附件的属主权限。
4. If 输入图像引用无效或无权访问, then the 图像编辑工具 shall 返回用户可读的错误且不访问越权资源。
5. When 编辑成功, the 图像编辑工具 shall 产出编辑后的图像并以附件引用形式返回。

### Requirement 3: 产出落库与引用契约
**Objective:** As a 平台运维者, I want 工具产出统一落入附件存储并以引用回流, so that 历史与上下文不被大体积 base64 污染且产物可被签名分发。

#### Acceptance Criteria
1. When 任一生成工具产出图像, the AIGC 工具服务 shall 将产物写入 pi-web 附件存储并获得稳定附件引用(`att_<id>`)。
2. The AIGC 工具服务 shall 在工具结果与对话历史中仅保留附件引用,而非内联 base64。
3. When 前端需要展示产物, the 系统 shall 经签名分发 URL 提供图像访问。
4. While 回放含生成产物的历史, the 系统 shall 以默认工具卡片呈现产物,不向用户暴露引用占位符或 base64。

### Requirement 4: 生成参数与默认变体
**Objective:** As an LLM/使用者, I want 在不显式指定全部参数时也能成功生成, so that 降低调用门槛并保证可预期产出。

#### Acceptance Criteria
1. When LLM 未指定 provider 变体, the AIGC 工具服务 shall 使用该工具的默认变体执行。
2. If LLM 提供的参数超出允许范围或取值非法, then the AIGC 工具服务 shall 返回用户可读的参数错误并说明期望取值。
3. The AIGC 工具服务 shall 将工具参数 schema 暴露给 LLM,使其知晓可用参数与取值约束。

### Requirement 5: Provider 配置与能力降级
**Objective:** As a 平台运维者, I want provider 密钥经环境变量配置且缺失时优雅降级, so that 未配置不致崩溃且诊断清晰。

#### Acceptance Criteria
1. The AIGC 工具服务 shall 从环境变量读取 provider 所需的密钥与配置。
2. If 工具被调用但所需 provider 密钥缺失, then the AIGC 工具服务 shall 返回明确的「能力不可用/缺少配置」说明,而非抛出未处理异常。
3. While 缺少 provider 配置, the agent shall 仍能正常加载与对话(工具注册但调用降级)。

### Requirement 6: 工具集承载与扩展结构
**Objective:** As a pi-web 开发者, I want AIGC 工具承载于一个通用工具套件并以一致方式接入新工具/变体, so that 后续工具与 provider 可低成本扩展且互不影响内核。

#### Acceptance Criteria
1. The 工具套件 shall 以独立、provider-agnostic 的包形式承载 AIGC 工具集,并预留与其它工具集并列的结构。
2. When 新增一个生成工具或 provider 变体, the 工具套件 shall 允许以一致的接入方式纳入,而无需改动既有工具的执行路径。
3. The 工具套件中承载 provider 密钥与请求构造的执行部分 shall 不被前端打包消费。

### Requirement 7: 可验证性与稳健性(非功能)
**Objective:** As a 平台维护者, I want 工具行为有测试与新鲜证据覆盖且失败可控, so that 交付质量可证、运行稳健。

#### Acceptance Criteria
1. The AIGC 工具能力 shall 由单元/集成测试覆盖核心路径(参数映射、落库回流、错误与降级)。
2. The text_to_image 端到端闭环 shall 有 e2e 验证证据(选 agent 源 → prompt → 生成 → 落库 → 卡片展示)。
3. If 单次生成超过设定超时, then the AIGC 工具服务 shall 终止等待并返回超时说明。
4. While 异步任务轮询进行中, the AIGC 工具服务 shall 支持取消(中断)且不遗留挂起任务。
