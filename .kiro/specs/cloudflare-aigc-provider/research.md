# Research Log — cloudflare-aigc-provider

Discovery 类型：**Extension（integration-focused / light discovery）**——在既有 AIGC provider 体系上新增一条通路，不新建子系统。

---

## 1. 外部契约调查（Cloudflare AI Gateway）

### 1.1 真机探针结果

全部结论来自 2026-07-28~29 对账号 `c1cc6314f2222379ec14714b992ba3df` / 网关 `pi-labs` 的实际调用，非文档推断。

| 探针 | 输入 | 结果 | 蕴含 |
|------|------|------|------|
| 基线 chat | `openai/gpt-4.1` | 200 / 2.5s，`keySource:"Unified"` | 通路与凭据形态确认 |
| 文生图① | `openai/gpt-image-2`，1024x1024，默认 png | 200 / 19.1s，1.50MB PNG | 同步返回，无需异步轮询 |
| 文生图② | 1024x1536 + `quality:"low"` + `output_format:"jpeg"` + 中文 prompt | 200 / 20.7s，236KB JPEG | 参数全部透传生效；体积 −84% |
| 错误形态 | `openai/no-such-model-xyz` | **404** + `{"errors":[{"message":"Model not found: …","code":7003}],"success":false,"result":{}}` | detectError 依据 |
| Workers AI | `@cf/black-forest-labs/flux-1-schnell` | 200，`{"result":{"image":"<裸 base64 JPEG>"}}` | **响应形态与 Unified 不同** |
| 编辑（错误形态） | `input.image`（单数）= 非法串 | **200 出图**，产出与参考图无关 | **单数字段被静默忽略并退化为文生图** |
| 编辑（正确形态） | `input.images:[<base64>]` + 「宇航服改成红色，其余不变」 | 200 / 22.2s，产出保持原图柴犬/登月舱/地球构图，仅宇航服变红 | `images` 复数数组是正确入参 |

### 1.2 两类模型的响应形态差异（本设计的核心约束）

```
Unified 第三方（openai/*、google/*、black-forest-labs/*）
  { "result": { "state": "Completed",
                "result": { "image": "<R2 预签名 URL, 24h>" },
                "gatewayMetadata": { "keySource": "Unified" } },
    "success": true, "errors": [] }
                    ↑ 两层嵌套 + 远程 URL

Workers AI 原生（@cf/*）
  { "result": { "image": "<裸 base64，无 data: 前缀>" },
    "success": true, "errors": [] }
                    ↑ 一层 + base64
```

**实现蕴含**：`pickResult` 必须按「先 `result.result.image`，回落 `result.image`」双路探测；且 base64 分支需自行判定 MIME 并拼成 data URI（`/9j/`→jpeg、`iVBOR`→png），否则下游无法渲染。

### 1.3 可选模型池（文档，可用性待逐个真机确认）

- **Unified**：`openai/gpt-image-2`、`openai/gpt-image-1.5`、`google/imagen-4`、`google/nano-banana-2`、`google/nano-banana-pro`、`black-forest-labs/flux-2-pro-preview`、`recraft/recraftv4*` 系列。文档明确「编辑能力见于 OpenAI 系与 Recraft vector 变体」。
- **Workers AI**（`GET /accounts/{acct}/ai/models/search?task=Text-to-Image` 实际返回 11 个）：`@cf/black-forest-labs/flux-1-schnell`、`flux-2-dev`、`flux-2-klein-4b`、`flux-2-klein-9b`、`@cf/leonardo/lucid-origin`、`@cf/leonardo/phoenix-1.0`、`@cf/stabilityai/stable-diffusion-xl-base-1.0`、`@cf/bytedance/stable-diffusion-xl-lightning`、`@cf/lykon/dreamshaper-8-lcm`、`@cf/runwayml/stable-diffusion-v1-5-img2img`、`@cf/runwayml/stable-diffusion-v1-5-inpainting`。

**决策**：Requirement 4.5 要求「仅将真机确认可出图的模型纳入目录」，故模型池的收敛作为一个独立的探针任务执行，不在设计阶段预先写死一份未验证清单。

**来源**：[REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)、[Supported models](https://developers.cloudflare.com/ai-gateway/supported-models/)、[GPT Image 2](https://developers.cloudflare.com/ai/models/openai/gpt-image-2/)

---

## 2. 既有代码模式调查

### 2.1 provider 分两族，本特性属第二族

| 族 | 成员 | 实现方式 |
|----|------|---------|
| OpenAI `/images` 协议兼容 | `newapi` / `sufy` / `ai-gateway` | `openai-compat.ts` 通用工厂的**薄封装**（各自绑 baseUrl + apiKeyVar + quirks） |
| 自有协议 | `gemini-relay.ts`（NewAPI 的 Gemini 通路）、`dashscope.ts`（异步轮询） | 自带 `buildBody` / `pickResult` / `detectError` |

**结论**：Cloudflare 属第二族，`gemini-relay.ts` 是**最贴近的先例**——同样非 OpenAI 协议、同样文生图+编辑两个工厂、同样需要把参考图从 data URI 转成自己协议的形态（Gemini 转 `inlineData`，CF 转裸 base64 数组）。设计照其结构，可最大化复用既有认知。

### 2.2 关键集成接缝（均已存在，无需新建）

| 接缝 | 位置 | 本特性怎么用 |
|------|------|-------------|
| `EndpointBehavior` | `engine/endpoint-types.ts` | `buildBody`/`pickResult`/`detectError`/`headers`/`requiredVars`/`url` 已足够表达 CF 协议，**不改引擎** |
| `mediaFields` | `image-edit.ts:263` = `["image","mask","reference_images"]` | 编排层已负责把远程 URL 解析成 data URI，CF 工厂只需从 data URI 提取裸 base64（Req 2.2 免费满足） |
| `requiredVars` | `EndpointBehavior` | 缺 env 时工具降级——Req 5.2「不提供而非调用时才失败」的既有机制 |
| `extraRoutes` 条件注册 | `extension.ts:126-135` + `registerImageGeneration(opts.extraRoutes)` | 照 `aiGatewayEnabled` 判定，未配 CF env 时行为逐字节不变（Req 5.5/7.1） |
| `${VAR}` 占位符 | var-resolver 执行期展开 | 满足 Req 5.4「模块加载期不读 env」的双入口纪律 |
| catalog sync 断言 | `test/aigc/model-catalog.test.ts` | 已有两组断言（主目录 + 网关目录），CF 加第三组（Req 7.2 防漂移） |

### 2.3 env 命名的历史教训（直接影响 Req 5.3）

`extension.ts` 已存在 `normalizeGatewayEnvNames()`，其注释记录：`AI_GATEWAY_API_KEY` 是 pi-ai SDK 内建 Vercel AI Gateway 的官方凭据 env（`env-api-keys.ts` 的 envMap），一旦出现在 pi 子进程环境中会劫持**全部**模型调用去 Vercel 导致 401 —— 不只是影响图像工具。BlackSail 自建网关因此被迫从 `AI_GATEWAY_*` 改名 `BLKSAILS_GATEWAY_*`（pi-clouds 8.2 真机事故）。

**决策**：CF 采用 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AIG_GATEWAY_ID` / `CLOUDFLARE_API_TOKEN`——与 wrangler 官方 env 名一致（本地开发可直接复用 `wrangler login` 后的凭据），且与任何 SDK 保留名无交集。

### 2.4 命名冲突面

`ai-gateway` 这一 provider id 在 pi-web 中**已指 BlackSail 自建网关**，且目录中已存在路由键 `gpt-image-2-ai-gateway`。同时主目录已有 `gpt-image-2`（NewAPI）与 `gpt-image-2-sufy`。故 CF 的 gpt-image-2 路由键需第四个互不冲突的值（`gpt-image-2-cf`），provider id 用 `cloudflare`。

---

## 3. 架构决策

| # | 决策 | 理由 | 备选与弃用原因 |
|---|------|------|---------------|
| D1 | 新建 `providers/cloudflare.ts`，不封装 `openai-compat.ts` | CF `/ai/run` 与 OpenAI `/images` 在 body 形态、响应路径、必需 header 三处均不同 | 「给 openai-compat 加 CF 开关」——会把三处分支污染进所有 OpenAI 兼容 provider 的共享路径，增加既有 provider 的回归面 |
| D2 | 单一 `pickResult` 兼容两种响应形态 | Req 3 要求两类模型对用户呈现一致；差异是 CF 内部分类，不应外泄 | 「拆成两个工厂（unified/workers-ai）」——两者 URL、header、错误形态完全相同，仅取图路径不同，拆分收益低于认知成本 |
| D3 | 编辑用 `input.images` 数组，且**无图时判失败** | 探针实证：单数 `image` 或缺图会被 CF 静默忽略并退化为文生图，返回 200 + 无关图片，是最危险的失败模式 | 「照 gemini-relay 静默跳过非 data URI」——在 Gemini 上退化为文生图会被模型自身拒答，在 CF 上却返回成功，故必须显式拦截（Req 2.3） |
| D4 | 条件注册照 `aiGatewayEnabled` 模式，以三个 env 齐备为开关 | 与既有网关套件同构，未配置时逐字节不变 | 「无条件注册 + 调用时报错」——违反 Req 5.2 |
| D5 | 模型池收敛为独立探针任务，不预写清单 | Req 4.5 要求仅纳入真机确认可出图者；文档列出的模型未必在本账号网关上全部开通 | 「照文档全量写入目录」——会让选择器列出实际不可用的模型 |

## 4. Synthesis

- **可泛化点**：`pickResult` 的「裸 base64 → 判 MIME → 拼 data URI」在 `gemini-relay.ts` 已有近似逻辑（`inlineData` 拼 data URI），但那里 MIME 由响应给出，CF 需自行嗅探。差异足够小，**不抽公共工具**，就地实现并加单测；若未来出现第三个需要 MIME 嗅探的 provider 再提取。
- **Build vs adopt**：全部接缝复用既有引擎与编排层，本特性净新增仅一个 provider 文件 + 两组路由 + 一组目录 + 条件注册分支。无新依赖。
- **简化**：原考虑为 CF 单独引入代理/超时配置，经探针确认 19~22s 同步返回落在既有默认超时内，**去掉**该设计分支。

## 5. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| R2 预签名 URL 24h 过期 | 结果图在落盘前失效 | 既有 attachment 抓取链路即时落盘；`dashscope` 已是同款模式，非新增风险 |
| 编辑静默退化为文生图 | 用户以为成功，实际拿到无关图 | D3 显式拦截 + 专门的单测与真机验收（Req 2.3） |
| CF 账号未开通某模型 | 选择器列出不可用模型 | D5 探针任务收敛目录（Req 4.5） |
| 探针用的是 wrangler OAuth token（`cfoat_`，会过期） | 生产不可用 | 生产应配置长期 API Token；env 契约不变，仅取值来源不同 |
