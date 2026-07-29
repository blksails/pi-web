# Requirements Document

## Introduction

在 pi-web 中新增 **Cloudflare AI Gateway** 作为一等 AIGC 图像 provider（provider id `cloudflare`），使用户能在图像模型选择器中选中 Cloudflare 通路的模型并实际出图，覆盖**文生图**与**图像编辑**两类能力。

pi-web 现有 5 个图像 provider（`openrouter` / `newapi` / `sufy` / `dashscope` / `ai-gateway`）全部是 OpenAI `/images` 协议兼容，实现上均为 `openai-compat.ts` 的薄封装。Cloudflare AI Gateway 的 `/ai/run` 是**不同协议**（请求体嵌套在 `input` 下、响应取图路径不同、需额外 header），且其上同时存在**两类模型**（第三方 Unified 模型与 Workers AI 原生 `@cf/*` 模型）**响应形态互不相同**。因此本特性需要一条独立的 provider 通路，而非复用既有薄封装。

Cloudflare 通路的一个显著优势是**统一计费**：调用第三方模型（如 OpenAI 的 gpt-image-2）只需 Cloudflare 自身凭据，无需再单独持有并下发 OpenAI key。

---

## Project Description (Input)

### 谁有问题

pi-web 的 AIGC 图像工具使用者（以及复用 `@blksails/pi-web-tool-kit` 图像能力的 pi-clouds 云端沙箱用户）。

### 现状

`gpt-image-2` 在 pi-web 中只有两条通路——经 NewAPI（`gpt-image-2`）与经 sufy（`gpt-image-2-sufy`），两条在实践中各有已知问题（NewAPI 上部分模型需走非标准 relay 协议、sufy 属跨境链路）。Cloudflare AI Gateway 提供了另一条可用通路，但 pi-web 目前完全没有对应 provider 实现，用户无法选用。

### 要变成什么

新增 `cloudflare` provider，让用户可选中并实际出图，覆盖文生图与图像编辑，并把 gpt-image-2 之外 CF 网关上其它可用图像模型一并纳入目录。

---

## 已验证事实（真机，2026-07-29）

以下为立项与需求阶段已在真机取得的证据，构成设计的事实基础：

**通路与凭据**
- 端点：`POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run`
- 必需 header：`Authorization: Bearer <CF token>` + `cf-aig-gateway-id: <gatewayId>` + `Content-Type: application/json`
- `gatewayMetadata.keySource: "Unified"` — 走 Cloudflare 统一计费，调用 `openai/*` 模型**不需要 OpenAI key**

**文生图**（2 次真机，19.1s / 20.7s，同步返回非异步轮询）
- 请求体：`{"model":"openai/gpt-image-2","input":{"prompt":…,"size":…,"quality":…,"output_format":…,"n":…}}` — 参数嵌在 `input` 下
- 实测生效：`size` 1024x1024 与 1024x1536、`quality:"low"`、`output_format:"jpeg"`、中文 prompt
- 体积：默认 png 1.50MB；`quality:"low"`+`jpeg` 236KB（−84%）

**图像编辑**（1 次真机，22.2s）
- 入参：`input.images` 为 **base64 字符串数组**（复数 `images`），CF 据此路由到 OpenAI `/v1/images/edits`
- 已验证语义正确：给定「把宇航服改成红色，其余不变」，产出图保持了原图的柴犬、登月舱、地球构图，仅宇航服变红
- ⚠ 单数 `image` 字段会被**静默忽略**并退化为文生图（HTTP 200，产出无关新图），此为易错点

**两类模型响应形态不同**（关键约束）
- Unified 第三方模型（`openai/gpt-image-2`）→ `{"result":{"state":"Completed","result":{"image":"<R2 预签名 URL>"}}}` — 两层嵌套 + URL
- Workers AI 原生模型（`@cf/black-forest-labs/flux-1-schnell`）→ `{"result":{"image":"<裸 base64，无 data: 前缀>"}}` — 一层 + base64
- R2 预签名 URL 有效期 `X-Amz-Expires=86400`（24 小时）

**错误形态**
- 未知模型 → HTTP 404 + `{"errors":[{"message":"Model not found: …","code":7003}],"success":false,"result":{}}`

**可选模型池**（CF 文档，具体可用性待真机逐个确认）
- Unified：`openai/gpt-image-2`、`openai/gpt-image-1.5`、`google/imagen-4`、`google/nano-banana-2`、`google/nano-banana-pro`、`black-forest-labs/flux-2-pro-preview` 等；编辑能力明确见于 OpenAI 系
- Workers AI：`@cf/black-forest-labs/flux-1-schnell`、`@cf/black-forest-labs/flux-2-dev`、`@cf/leonardo/lucid-origin` 等 11 个 Text-to-Image 模型

---

## Boundary Context

- **In scope**：`cloudflare` provider 的文生图与图像编辑通路；其模型进入图像模型选择器与 `/settings` 模型开关面板；凭据与网关坐标经环境变量配置；缺配时的降级行为；Unified 与 Workers AI 两类响应形态的正常出图。
- **Out of scope**：
  - 修改图像工具引擎（`EndpointBehavior` / `runEndpoint`）——现有接缝已足够，本特性不改引擎契约
  - 既有 5 个 provider 的任何行为变更
  - 出图结果的持久化与附件落盘——由既有 attachment 链路承担（`dashscope` 同样返回会过期的远程 URL，模式已存在）
  - Cloudflare 账号开通、网关创建、计费额度管理等运维动作
  - 视频 / 音频等非图像模态
- **Adjacent expectations**：
  - 依赖既有 attachment 抓取链路在 R2 预签名 URL 过期（24h）前完成落盘
  - 依赖 `${VAR}` 占位符的 var-resolver 在执行期展开环境变量
  - 本特性**不拥有** pi 子进程的环境变量注入，但对 env 命名提出硬约束（见 Requirement 5）

---

## Requirements

### Requirement 1: Cloudflare 文生图通路

**Objective:** As an AIGC 图像工具使用者, I want 选中 Cloudflare 通路的图像模型并生成图片, so that 我在 NewAPI / sufy 之外多一条可用且统一计费的出图通路

#### Acceptance Criteria

1. When 用户选中 `cloudflare` provider 下的一个文生图模型并提交 prompt, the AIGC 图像工具 shall 返回一张可显示的图片。
2. When 用户在请求中指定 `size`、`quality`、`output_format` 中的任意参数, the AIGC 图像工具 shall 使这些参数对产出图片实际生效（尺寸、体积、封装格式与所选值一致）。
3. When 用户提交中文 prompt, the AIGC 图像工具 shall 正常出图，不因语言而失败。
4. The AIGC 图像工具 shall 以同步单次请求方式完成 Cloudflare 文生图调用，不引入异步轮询等待。
5. Where 所选模型为 Unified 第三方模型（如 `openai/gpt-image-2`）, the AIGC 图像工具 shall 在**不配置该第三方 provider 自身 key**的前提下成功出图。

### Requirement 2: Cloudflare 图像编辑通路

**Objective:** As an AIGC 图像工具使用者, I want 基于一张已有图片经 Cloudflare 通路做编辑, so that 我能在保持原图构图的前提下按指令修改画面

#### Acceptance Criteria

1. When 用户提供一张参考图与编辑指令并选中支持编辑的 Cloudflare 模型, the AIGC 图像工具 shall 返回一张在原图基础上按指令修改的图片。
2. When 参考图以远程 URL 形式给出, the AIGC 图像工具 shall 在发起请求前将其转为该通路可接受的形态，用户无需自行转码。
3. If 参考图未能被正确送达而请求仍返回了图片, the AIGC 图像工具 shall 不将该结果当作编辑成功——即编辑路径不得静默退化为文生图。
4. Where 所选模型不支持图像编辑, the AIGC 图像工具 shall 不在编辑场景中提供该模型。

### Requirement 3: 两类模型的一致可用性

**Objective:** As an AIGC 图像工具使用者, I want 无论选中的是第三方模型还是 Cloudflare 自有模型都能正常出图, so that 我不需要了解 Cloudflare 内部的模型分类差异

#### Acceptance Criteria

1. When 用户选中 Unified 第三方模型, the AIGC 图像工具 shall 正常返回可显示图片。
2. When 用户选中 Workers AI 原生模型（`@cf/*`）, the AIGC 图像工具 shall 同样正常返回可显示图片。
3. The AIGC 图像工具 shall 对上述两类模型呈现一致的用户体验，不因内部响应形态差异而出现其一无法显示。

### Requirement 4: 模型目录与选择器可见性

**Objective:** As an AIGC 图像工具使用者, I want 在模型选择器与设置面板中看到并管理 Cloudflare 模型, so that 我能发现这条通路并按需启用或禁用

#### Acceptance Criteria

1. When 用户打开图像模型选择器, the AIGC 图像工具 shall 列出已纳入目录的 Cloudflare 模型，并标示其归属 provider 为 `cloudflare`。
2. When 用户打开 `/settings` 的模型开关面板, the 设置面板 shall 列出同一批 Cloudflare 模型并允许逐个禁用。
3. When 某个 Cloudflare 模型被用户禁用, the AIGC 图像工具 shall 不再在模型选择器中提供该模型。
4. The AIGC 图像工具 shall 使每个 Cloudflare 模型的标识在全部 provider 范围内唯一，与既有 `gpt-image-2`、`gpt-image-2-sufy`、`gpt-image-2-ai-gateway` 等标识互不冲突。
5. The AIGC 图像工具 shall 仅将已在真机确认可成功出图的模型纳入目录。

### Requirement 5: 凭据与网关坐标配置

**Objective:** As an 运维人员, I want 经环境变量配置 Cloudflare 账号与网关坐标, so that 我能在不改代码的前提下切换账号、网关与凭据

#### Acceptance Criteria

1. The AIGC 图像工具 shall 支持经环境变量配置 Cloudflare 账号标识、网关标识与访问凭据三项。
2. If 上述任一必需配置缺失或为空, the AIGC 图像工具 shall 不向用户提供 Cloudflare 模型，而非在调用时才失败。
3. The AIGC 图像工具 shall 不使用 `AI_GATEWAY_API_KEY` 作为本通路的凭据环境变量名——该名为 pi SDK 内建 Vercel AI Gateway 保留名，一旦出现在 pi 子进程环境中会劫持**全部**模型调用导致 401（pi-clouds 8.2 真机事故）。
4. The AIGC 图像工具 shall 在模块加载期不读取环境变量，使该模块可安全进入前端产物而不触发运行时错误。
5. Where 运维人员未配置 Cloudflare 相关环境变量, the AIGC 图像工具 shall 保持既有 5 个 provider 的行为完全不变。

### Requirement 6: 失败可诊断

**Objective:** As an AIGC 图像工具使用者, I want 调用失败时看到可理解的原因, so that 我能判断是选错模型、配置缺失还是服务端问题

#### Acceptance Criteria

1. If Cloudflare 返回业务错误（如模型不存在）, the AIGC 图像工具 shall 向用户呈现该错误的可读描述，而非静默失败或抛出原始响应结构。
2. If 凭据无效或权限不足, the AIGC 图像工具 shall 呈现可区分于「模型不存在」的错误描述。
3. If 响应中不含可用图片, the AIGC 图像工具 shall 判定为失败而非返回空结果给用户。

### Requirement 7: 不回归既有通路

**Objective:** As a pi-web 维护者, I want 新增 provider 不影响任何既有能力, so that 这次改动可以安全合入

#### Acceptance Criteria

1. When Cloudflare provider 加入后, the AIGC 图像工具 shall 保持既有 `openrouter` / `newapi` / `sufy` / `dashscope` / `ai-gateway` 全部模型的行为不变。
2. The AIGC 图像工具 shall 保持模型展示目录与实际可调用路由之间的一致性，二者不得出现漂移。
3. The AIGC 图像工具 shall 不改变图像工具执行引擎对既有 provider 的调用契约。
