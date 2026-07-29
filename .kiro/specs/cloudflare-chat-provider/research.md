# Research & Design Decisions

## Summary

本 spec 属 **Extension**。核心结论全部来自 2026-07-29 的真机探测（带凭据实调 Cloudflare AI Gateway），而非文档推断：**现有 `ai-gateway` 套件极可能零代码改动即可接入 CF**，本 spec 的重心因此从「写适配层」转为「接线验证 + 目录收敛 + 文档」。

## Research Log

### 一、pi-web 里有三套易混淆的「模型/网关」系统

| 系统 | 位置 | 职责 |
|---|---|---|
| 对话模型清单 | `server/src/config/model-options.ts` | 取自 **pi SDK `ModelRegistry`**（内置 + `<agentDir>/models.json`），只列已配凭证者 |
| **llm-gateway** | `server/src/llm-gateway/` | pi-web **自身即网关**：`/llm-gateway/:provider/*` 换钥转发（spec `sandbox-credentials-v2`，避免真实 key 下发进沙箱） |
| **ai-gateway** | `server/src/ai-gateway/` | 转发到**外部**网关 + 拉其 `GET /v1/models` 目录并 `mergeModelCatalog` |

**蕴含**：仓内**没有**硬编码的对话模型清单，「加两个模型」不是往数组里加两行。

**排除 llm-gateway 作为落点**，两条独立理由：
1. 它只管**转发**，不产出模型清单 —— 加进它的登记表，模型下拉里也不会多出 gpt-5.5。
2. 其 `upstreamBase` 是静态字符串、裸拼接（`gateway-routes.ts:207`），而 CF 的 URL 嵌着 account_id / gateway_id 两个变量，现有 8 个 provider 全无先例。

### 二、Cloudflare AI Gateway 的 OpenAI 兼容面（真机实测）

端点：`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions`
模型命名：`{provider}/{model}`。

**★认证：标准 `Authorization: Bearer <CF_API_TOKEN>` 即可**——这是本 spec 改动量的决定项。

| 请求 | 头 | 结果 |
|---|---|---|
| `/compat/chat/completions` | `cf-aig-authorization` | ✅ 200 |
| `/compat/chat/completions` | **`Authorization`** | ✅ **200** |
| `/compat/models` | **`Authorization`** | ✅ **200，2465 条** |

CF 文档虽列出 `cf-aig-authorization` 与 `apiKey` 两种方式，但实测标准头同样被接受，故 `ai-gateway` 中写死的
`headers.authorization = Bearer ...`（`model-catalog.ts:111`、`routes.ts:243`）**无需改为可配**。

**只需 CF 一把 token**：全程未提供 OpenAI／Anthropic 各自的 key（网关已配 stored keys，统一计费）。

### 三、路径拼接的意外容忍（决定「零改动」成立与否）

`ai-gateway` 拉目录固定为 `${baseUrl}/v1/models`。若 `baseUrl` 取 `…/compat`，拼出的是 `…/compat/v1/models` —— 多了一层 `/v1`。实测：

| URL | 结果 |
|---|---|
| `…/compat/models` | ✅ 200，2465 条 |
| **`…/compat/v1/models`** | ✅ **200，2465 条真目录（含 `openai/gpt-5.5`）** |
| **`…/compat/v1/chat/completions`** | ✅ **200，实回 `'ok'`** |
| `…/{gateway_id}/v1/models`（baseUrl 少一层） | ❌ 400 |

**结论**：CF 容忍多出的 `/v1`，恰好与 `ai-gateway` 的拼接方式吻合。故 `BLKSAILS_GATEWAY_BASE_URL` 取到
**`/compat` 为止**即可，两条链路（目录 + 转发）均通。少一层则 400 —— 这是配置的唯一易错点。

### 四、模型可用性（逐个实调，非查表）

| 用户点名 | CF id | 实测 | 上游真实版本 |
|---|---|---|---|
| GPT 5.5 | `openai/gpt-5.5` | ✅ 实回 `'ok'` | **gpt-5.5-2026-04-23** |
| Claude Opus 5.0 | `anthropic/claude-opus-5` | ✅ | claude-opus-5 |
| Claude Sonnet 5 | `anthropic/claude-sonnet-5` | ✅ 实回 `'Ok'` | claude-sonnet-5 |
| ~~Claude Haiku 5~~ | ~~`anthropic/claude-haiku-5`~~ | ❌ **该型号不存在** | — |
| Claude Haiku 4.5（替代） | `anthropic/claude-haiku-4-5` | ✅ 实回 `'ok'` | claude-haiku-4-5-20251001 |

**★两个误导性报错，排查时务必知道**：
- `claude-haiku-5` 报 **`Invalid Anthropic API Key`** —— 但同一把 key 对 haiku-4-5 / sonnet-5 均正常。
  这是 CF 对**未知 Anthropic 模型**的错误包装，**不是凭据问题**。
- `gpt-5.5` 在 `max_completion_tokens: 1` 时报「输出被截断」，看似失败，实为**模型正常工作**
  —— 它有 reasoning（usage 显示 `reasoning_tokens: 6`），推理 token 先吃掉了额度。

对照组 `definitely-not-real/xyz-999` 返回 CF 层 `code 2008` 非 JSON 错误，形态与上述均不同，证明探测有效。

**★探测方法论留痕**：用 Python `urllib` 并发探测时**全部 403**（含此前 curl 成功者），是 CF 的 WAF 拦截无常规 UA 的请求。改回 curl 串行后正常。**探测外部网关请用 curl，勿用裸 urllib。**

### 五、目录规模与形态

`GET …/compat/v1/models` → 2465 条，形态与 `ai-gateway` 的期待**逐字段吻合**（含 `owned_by`，正是它降级为 `channel` 元数据的那个字段）：

```jsonc
{"id":"openai/gpt-5.5","object":"model","owned_by":"openai",
 "cost_in":5e-06,"cost_out":2.5e-05,"created_at":1784924211}
```

provider 分布（前 10）：openrouter 1067、openai 215、aws-bedrock 163、azure-openai 141、
google-ai-studio 133、anthropic 122、mistral 92、google-vertex-ai 88、workers-ai 68、grok 62。

**蕴含**：2465 条**不可**原样进模型下拉 —— 仅 openrouter 一家就 1067 条，且与其他 provider 大量重复覆盖。
需要收敛策略，这是本 spec 唯一有实质设计含量的部分。

`cost_in` / `cost_out` 是现成的定价元数据，当前 `ModelOption` 未使用；属未来做用量成本展示时的白捡收益，本期不纳入。

## Architecture Pattern Evaluation

| 方案 | 改动量 | 是否产出模型清单 | 结论 |
|---|---|---|---|
| A. 纯文档，教用户配 `models.json` | 零 | 否（用户手配） | ❌ 每部署手配，清单不受仓库控制 |
| B. llm-gateway 加 cloudflare 条目 | 中（需引入变量 URL 解析，动公共表结构） | **否** | ❌ 不解决核心诉求 |
| **C. 复用 ai-gateway 接 CF** | **接近零** | ✅ 自动获得全部目录 | ✅ **采纳** |

**采纳 C**。决定性依据是第二、三节的实测：认证头与路径拼接**均已天然吻合**，无需适配层。

## Design Decisions

### Decision: 复用 ai-gateway，不新建 provider 适配层

**理由**：CF 的 OpenAI 兼容面在认证与路径两处都与 `ai-gateway` 现有实现吻合（实测三条 URL 全 200）。
新建适配层将复制既有的换钥转发、目录 TTL、stale-while-revalidate、fail-soft 等全部逻辑，纯属重复。

### Decision: `BLKSAILS_GATEWAY_BASE_URL` 取到 `/compat` 为止

**理由**：`ai-gateway` 固定拼 `/v1/...`。取到 `/compat` 时两条链路皆 200；少一层则 400。属配置约定而非代码约束，须在文档与错误提示中写明。

### Decision: 目录需收敛，不原样下发 2465 条

**理由**：模型下拉不可用性问题（openrouter 一家 1067 条）。具体策略（白名单 / provider 过滤 / 二级分组）留 design 阶段决策 —— 这是本 spec 的主要设计工作。

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| **2465 条目录压垮模型选择器** | 高 —— 直接影响可用性 | 必须收敛；策略待 design |
| `/compat` 层级配错（少一层 → 400） | 中 —— 静默失败为空目录 | 文档写明；错误提示含实际 URL |
| CF 文档称 `/compat/chat/completions` 有**弃用倾向**（推荐迁 `api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions`） | 中 —— 未来需迁移 | 记为 Revalidation Trigger；实测新端点 `…/ai/v1/models` 返回 405，尚不能替代 |
| CF WAF 拦截非常规 UA | 低 —— 仅影响排查手法 | 已留痕：探测用 curl |
| 「零改动」结论未经端到端验证 | **中 —— 目前仅验证了三条裸 URL** | 必须在 impl 阶段以真实 `ai-gateway` 装配跑通，不得据裸 curl 直接宣称完成 |
| 据单次观测下普遍结论 | 中 —— 同仓 `upload-image-compression` 已踩过一次 | 涉及外部服务的结论跨时段复测；模型可用性以实调为准 |

## References

- 真机探测记录：本文档各表（2026-07-29）
- CF 文档：https://developers.cloudflare.com/ai-gateway/usage/chat-completion/
- 既有实现：`packages/server/src/ai-gateway/{config,key-resolver,model-catalog,routes}.ts`
- 对照（不采纳）：`packages/server/src/llm-gateway/{provider-registry,gateway-routes}.ts`
- 同网关图像侧先例：`packages/tool-kit/src/aigc/providers/cloudflare.ts`（spec `cloudflare-aigc-provider`）


## 端到端验证结果（2026-07-29，任务 3.1）

以**真实组件**（`resolveAiGatewayConfig` → `GatewayModelCatalog` 真实拉取 → `mergeModelCatalog`）
跑通，且发起对话所用的 model id **取自合并结果**而非手敲常量：

```
① baseUrl 解析 + 白名单 anthropic,openai,google-ai-studio
② 真实拉取 CF → filtered {kept:470, dropped:1995}
③ 合并 471 条（470 网关 + 1 自配；自配未被吞并）
④ [anthropic] anthropic/claude-opus-5 → HTTP 200  1.9s  回复 "ok"
④ [openai]    openai/gpt-5.5          → HTTP 200  1.5s  回复 "ok"
```

**「零代码适配层」结论成立** —— 未对 `ai-gateway` 的认证、路径、转发做任何改动即跑通，
本 spec 的代码改动仅为目录收敛与可诊断性。

### ⚠ 端到端暴露的产品局限：目录含不可对话的变体

首次运行时挑中了 `openai/gpt-4-turbo:batch`，返回 401「未提供 API key」——
那是**批处理 API 的变体**，需另一套凭据，不能直接对话。

**provider 级白名单收不掉这类变体**（它们的 `owned_by` 同为 `openai`）。470 条中仍混有
`:batch` 后缀以及 embedding / tts / whisper / moderation 等非对话模型，用户在选择器中
选中即失败。

**本期不处理**，理由：判定「哪些模型可对话」需要模型能力元数据，而 CF 目录只给
`id`/`owned_by`/`cost_*`，靠 id 模式匹配（如排除含 `:` 者）是脆弱的启发式，
容易误伤合法模型。留作后续 spec 的候选改进，已记入 Risks。
