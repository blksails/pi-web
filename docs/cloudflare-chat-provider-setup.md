# 接入 Cloudflare AI Gateway 作为对话模型来源

把 Cloudflare AI Gateway 接为 pi-web 的**对话**模型来源：其上模型自动出现在模型选择器中，
且**只需一把 Cloudflare token**，无需分别持有 OpenAI / Anthropic 等各厂商的密钥。

> 本文只涉及**对话**。Cloudflare 的**图像**能力走另一条路径（`/ai/run` 端点，
> 见 `packages/tool-kit/src/aigc/providers/cloudflare.ts`），两者互不影响。

## 一、配置

```bash
# 网关地址 —— ★必须取到 /compat 为止，见下节
BLKSAILS_GATEWAY_BASE_URL=https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/compat

# Cloudflare API Token
BLKSAILS_GATEWAY_API_KEY=<CF_API_TOKEN>

# 可选：上游归属白名单（逗号分隔，忽略大小写）
# 未配置时用内置默认：anthropic,openai,google-ai-studio
PI_WEB_AI_GATEWAY_PROVIDER_ALLOWLIST=anthropic,openai,google-ai-studio
```

> ⚠️ **切勿使用 `AI_GATEWAY_API_KEY`**。那是 pi-ai SDK 内建 Vercel AI Gateway 的官方凭据 env，
> 一旦出现在同进程环境中，会劫持**全部**模型调用去 Vercel 并返回 401 —— 而不只是影响本特性。
> 请一律用 `BLKSAILS_` 前缀的两个变量。

前提：Cloudflare 网关侧需已配置 stored keys（BYOK），否则调用会由上游返回「未提供 API key」。

## 二、★地址层级：最常见的配置错误

`ai-gateway` 拉取目录时固定请求 `${BLKSAILS_GATEWAY_BASE_URL}/v1/models`。Cloudflare 容忍
由此多出的一层 `/v1`，所以 base URL **取到 `/compat` 为止**即可，目录与对话两条链路都通。

| base URL 取值 | 实际请求 | 结果 |
|---|---|---|
| `…/<GATEWAY_ID>/compat` ✅ | `…/compat/v1/models` | **200，正常** |
| `…/<GATEWAY_ID>` ❌ | `…/<GATEWAY_ID>/v1/models` | **400** |

**层级配错的表现是「模型清单里没有网关模型」，而不是启动失败** —— 目录拉取遵循 fail-soft，
不阻断服务、也不影响自配模型展示。此时请查服务端日志：

```
[server:ai-gateway] gateway catalog refresh failed { url: "…/v1/models", error: "… status 400" }
```

日志中的 `url` 即实际请求地址，凭据不会被记录。

## 三、目录收敛

Cloudflare 目录规模很大（2026-07-29 实测 **2465 条**），其中 openrouter 一家就 1067 条，
且与 openai / anthropic 等直连厂商大量重复覆盖。原样下发会让模型选择器不可用。

因此按**上游归属**（目录条目的 `owned_by`）白名单过滤，默认保留三家主流直连厂商。
实测收敛效果：`{kept: 470, dropped: 1995}`。

每次目录刷新都会记录收敛结果，便于判断白名单是否过窄：

```
[server:ai-gateway] gateway catalog filtered { kept: 470, dropped: 1995, allowed: [...] }
```

若 `kept` 为 0，说明白名单与实际归属名不匹配。

**按归属而非模型 id 过滤**，好处是白名单内厂商发布新型号时**无需改代码**即自动可见。

配置要点：
- 值为逗号分隔，逐项忽略大小写与首尾空白；
- **空白值回落默认**，不解释为「全部滤除」—— 后者几乎总是误配，且会产出一个让人无从下手的空清单。

## 四、已验证可用的模型

模型命名格式为 `{provider}/{model}`。以下均于 2026-07-29 实调确认：

| 模型 id | 上游真实版本 |
|---|---|
| `openai/gpt-5.5` | gpt-5.5-2026-04-23 |
| `anthropic/claude-opus-5` | claude-opus-5 |
| `anthropic/claude-sonnet-5` | claude-sonnet-5 |
| `anthropic/claude-haiku-4-5` | claude-haiku-4-5-20251001 |

> **不存在 `claude-haiku-5`**。Anthropic 目前最新的 Haiku 为 4.5。

## 五、★两个具有误导性的报错

排查时若遇到以下两种情形，**不要**被字面意思带偏：

### 1. 「凭据无效」其实是模型不存在

请求一个不存在的 Anthropic 模型时，网关返回：

```
Invalid Anthropic API Key
```

**这不表示凭据有问题**。可用同一把 token 请求一个已知存在的模型（如
`anthropic/claude-haiku-4-5`）来验证 —— 若后者正常，则问题出在模型名而非凭据。

复现：

```bash
curl -s "$BASE/chat/completions" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"model":"anthropic/claude-haiku-5","messages":[{"role":"user","content":"hi"}]}'
# → Invalid Anthropic API Key   （实为该型号不存在）
```

### 2. 「输出被截断」其实是模型正常工作

具备推理能力的模型（如 `openai/gpt-5.5`）会先消耗 reasoning token。若输出上限设得过小：

```
Could not finish the message because max_tokens or model output limit was reached
```

**这不表示模型不可用**，而是推理 token 已吃光额度。复现与验证：

```bash
# max_completion_tokens: 1 → 报「被截断」
# max_completion_tokens: 2000 → 正常返回，usage 中可见 reasoning_tokens
```

给这类模型设置默认输出上限时，需为推理留出余量。

## 六、已知局限

**收敛后的目录仍含不可对话的变体。** 白名单是 provider 级的，收不掉同一厂商下的
`:batch`（批处理 API，需另一套凭据）、embedding / tts / whisper / moderation 等条目 ——
它们的 `owned_by` 与对话模型相同。用户若在选择器中选中这类条目，调用会失败。

暂不处理的原因：判定「哪些模型可对话」需要模型能力元数据，而 Cloudflare 目录仅提供
`id` / `owned_by` / `cost_*`，靠 id 模式匹配属脆弱的启发式，容易误伤合法模型。

## 七、相关

- 规格：`.kiro/specs/cloudflare-chat-provider/`（含全部真机探测记录）
- 实现：`packages/server/src/ai-gateway/{config,model-catalog}.ts`
- 上游文档：https://developers.cloudflare.com/ai-gateway/usage/chat-completion/
  （注意：CF 称 `/compat/chat/completions` 有弃用倾向，推荐迁往
  `api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions`；但实测该新端点的
  `/models` 返回 405，尚不能替代，故本期仍用 `/compat`）
