# Design Document

## Overview

把 ai-gateway 目录模型接进会话执行链。核心是**复用 `desktop-cloud-login` 已验证的范式**：
在 runner 侧构造 `ModelRegistry.inMemory` 并注册一个指向网关的 provider，使
`registry.find("ai-gateway", <id>)` 可解析；随后把目录条目的 `availability` 翻为 `session`、
把 `ai-gateway` 纳入 `providers` 列表。

本 spec **不发明架构** —— 三处关键件（内存 registry 范式、spawn env 下发链、目录合并纯函数）
均已存在，工作是接线 + 一处必要的重构（两个模型来源共存）。

### Goals

- 选中网关模型能真的对话，而非会话创建即抛「模型未找到」。
- 登录态 egress 与网关注入**共存**，不互相顶掉。
- 网关可被设为默认 Provider（本轮需求的直接触发点）。

### Non-Goals

- 沙箱（e2b）分支接线 —— 无验证条件，不做无法验证的接线。
- 网关目录拉取与白名单收敛（`cloudflare-chat-provider` 已交付）。
- 图像模型侧的网关执行链路。
- per-user key 解析（`PerUserKeyResolver` 仍为 P1 占位）。

## Boundary Commitments

### This Spec Owns

- runner 侧网关 provider 注册（新文件 `ai-gateway/session-model-source.ts`）。
- `option-mapper.ts` 中「多模型来源合成单一 registry」的重构。
- 本地分支的 spawn env 下发（新文件 `lib/app/ai-gateway-session-assembly.ts`）。
- `mergeModelCatalog` 的 `availability` 与 `providers` 两处语义修订。

### Out of Boundary

- `ai-gateway/routes.ts` 转发面（本地分支直连上游，不经此路由）。
- `GatewayModelCatalog` 的拉取/TTL/收敛逻辑（只读用其 `get()`）。
- `egress-model-source` 的对外 API 形状（重构须保持既有导出可用）。

### Allowed Dependencies

仅既有依赖。**禁止**新增 npm 依赖。

### Revalidation Triggers

- pi SDK 改变 `ModelRegistry.registerProvider` / `find` 的签名或 id 解析方式。
- `mergeModelCatalog` 的 `provider` 取值不再是字面量 `"ai-gateway"`（两侧必须同源）。
- `pi-handler.ts` 的本地 spawn env 不再携带 `config.providerKeys`（信任边界前提变化，Req 2.1 需重议）。

## Architecture

```
【主进程】
resolveAiGatewayConfig(env) ──┐
GatewayModelCatalog.get() ────┤  (同步快照,已按白名单收敛)
EnvKeyResolver.resolve() ─────┘
            ↓
computeAiGatewaySessionSpawnEnv()        ← 新，纯函数
            ↓  spawn env 三件套
   PI_WEB_AI_GATEWAY_SESSION_{BASE,KEY,MODELS}
            ↓
【runner 子进程】 option-mapper.ts
resolveAiGatewaySessionSpecFromEnv() ─┐
resolveEgressSpecFromEnv() ───────────┤ ← 重构:先解析，后合成
            ↓                          │
   AuthStorage + ModelRegistry.inMemory (单例)
            ├── registerProvider("pi-cloud",   …)  ← 既有
            └── registerProvider("ai-gateway", …)  ← 新
            ↓
   registry.find("ai-gateway", "anthropic/claude-opus-5")
```

### 决策 D1：本地分支直连上游，凭据经 spawn env

**背景修正**：初稿打算让 registry 指向本部署 `/api/ai-gateway/v1` + scoped token，以避免真实
key 进子进程。调研推翻了该前提 —— `pi-handler.ts:787` 的 `...config.providerKeys` 表明**本地
runner 本就接收真实 provider key**，换钥网关是专为 e2b 建的（`llm-gateway-assembly.ts:27`）。

| 方案 | 评价 |
|---|---|
| **A. 直连上游 `${aiGwConfig.baseUrl}/v1` + 真实 key** | ✅ **采纳**。与既有 `providerKeys` 同边界同形态；无「本部署自身可达 base」这一未解问题 |
| B. 指向自身 `/api/ai-gateway/v1` + scoped token | ❌ 需解析本部署自身监听地址（Next handler 装配期不可得），为一道本地分支并不设防的边界付出真实复杂度 |

`${baseUrl}/v1` 对 CF 即 `…/compat/v1` —— `cloudflare-chat-provider` 已实测 200。

**★env 命名硬约束**：新 env 名**不得**用 `AI_GATEWAY_API_KEY`（`key-resolver.ts:40` 与
pi-clouds 8.2 事故记录：该名会被 pi 子进程继承并被 pi-ai 当作 Vercel AI Gateway 凭据，
劫持**全部**模型调用返回 401）。本 spec 一律用 `PI_WEB_AI_GATEWAY_SESSION_*` 前缀。

### 决策 D2：两个模型来源合成单一 registry

`servicesOptions.modelRegistry` 只有一个位置，而 `ModelRegistry.inMemory` 可注册多个 provider。
故把 `egress-model-source` 拆成「解析 spec」与「注册到给定 registry」两层：

```ts
// 既有导出保留(内部改为经新原语实现),避免破坏 API
export function buildEgressModelSource(input): InjectedModelServices | undefined
export function resolveEgressModelSourceFromEnv(agentDir, env): InjectedModelServices | undefined

// 新原语
export function resolveEgressSpecFromEnv(env): EgressSpec | undefined
export function registerEgressProvider(registry: ModelRegistry, spec: EgressSpec): void
```

option-mapper 改为：

```ts
const egressSpec = resolveEgressSpecFromEnv(process.env);
const gatewaySpec = resolveAiGatewaySessionSpecFromEnv(process.env);
if (egressSpec !== undefined || gatewaySpec !== undefined) {
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  if (egressSpec !== undefined) registerEgressProvider(modelRegistry, egressSpec);
  if (gatewaySpec !== undefined) registerAiGatewayProvider(modelRegistry, gatewaySpec);
  servicesOptions.authStorage = authStorage;
  servicesOptions.modelRegistry = modelRegistry;
}
```

两者均缺 → 完全不碰 `servicesOptions`，走 SDK 默认（Req 1.3 逐字节一致）。

### 决策 D3：模型清单以 id 数组下发

`registerProvider` 需要 models 列表。目录快照（470 条）经 `JSON.stringify(ids)` 约 15KB，
在 env 变量单值上限（Linux 约 128KB）内。

只传 id 不传元数据：网关目录本就只有 `id`/`owned_by`/`cost_*`，无 contextWindow 等；
`toProviderModel` 已有的缺省（128k ctx / 8k maxTokens）沿用。

**风险**：目录规模若因白名单放宽而暴涨（不收敛时 2465 条 ≈ 80KB），仍在限内但接近。
实施时须记录实际字节数，超过 64KB 则告警。

### 决策 D4：不可对话变体 —— 条件收敛（Req 4 表态）

前作已实测撞上 `openai/gpt-4-turbo:batch` → 401，且 provider 级白名单收不掉。
本 spec 把它从「点不了」变成「点了就报错」，故必须表态。

**采纳：证据驱动的窄判据。** 实施时先统计目录中含 `:` 的条目形态：

- 若**全部**为 `:batch` 等 API 变体后缀 → 落一条窄规则「排除 id 含 `:` 者」，并记录统计数据。
  这不是「猜哪些能对话」，而是排除一个形态确定的已知子集。
- 若存在含 `:` 的正常对话模型 → **放弃收敛**，回退到「不过滤 + 错误可诊断 + 文档记局限」。

embedding / tts / whisper / moderation 等**明确留待后续**（判定需能力元数据，前作已论证 id
模式匹配脆弱）。Req 4.2 由 D5 的错误可诊断性 + 文档满足。

### 决策 D5：解析失败的错误可诊断

`resolveModel` 现抛 `Model not found in registry: provider="…" modelId="…"`。
当 provider 为 `ai-gateway` 时补充来源提示（目录可能已过期 / 该模型可能非对话模型），
使用户能自助定位，满足 Req 1.4 与 4.2。

## File Structure Plan

### New Files

| 路径 | 职责 |
|---|---|
| `packages/server/src/ai-gateway/session-model-source.ts` | env 常量、`resolveAiGatewaySessionSpecFromEnv`、`registerAiGatewayProvider` |
| `lib/app/ai-gateway-session-assembly.ts` | `computeAiGatewaySessionSpawnEnv`（纯函数） |
| `packages/server/test/ai-gateway/session-model-source.test.ts` | 解析/注册/缺省 |
| `test/ai-gateway-session-assembly.test.ts` | 装配纯函数（启用/未启用/无 key/空目录） |

### Modified Files

| 路径 | 改动 |
|---|---|
| `packages/server/src/auth/egress-model-source.ts` | 拆出 `resolveEgressSpecFromEnv` / `registerEgressProvider`；既有导出保留 |
| `packages/server/src/runner/option-mapper.ts` | 合成单一 registry；`resolveModel` 网关来源错误提示 |
| `packages/server/src/ai-gateway/model-catalog.ts` | `availability: "catalog"` → `"session"`；`providers` 纳入 `ai-gateway` |
| `packages/server/src/ai-gateway/index.ts` | 导出新符号 |
| `lib/app/pi-handler.ts` | spawn env 并入网关三件套 |
| `docs/cloudflare-chat-provider-setup.md` | 补「模型现已可用于会话」与局限 |

## Requirements Traceability

| 需求 | 承载 |
|---|---|
| 1.1 / 1.2 | D1 + D2（runner 注册 + 端到端验证任务） |
| 1.3 | 两 spec 均缺时不碰 `servicesOptions`；装配层未启用即空 env |
| 1.4 | D5 |
| 2.1 | D1（同 `providerKeys` 边界） |
| 2.2 | Out of Scope（e2b 不接线） |
| 2.3 | 日志只记 provider 名与条目数 |
| 2.4 | `ModelRegistry.inMemory` 零落盘 |
| 2.5 | 装配层 key/base 任一缺失 → 空 env |
| 3.1 / 3.4 | D2 单 registry 双注册 |
| 3.2 | provider 名字面量 `"ai-gateway"`，与 `mergeModelCatalog` 同源 |
| 3.3 | 实施任务显式核对 auth.json 撞名 |
| 4.1 / 4.2 / 4.3 | D4 + D5 + 文档 |
| 5.1 / 5.2 / 5.3 / 5.4 | `model-catalog.ts` 翻标记；UI 判据不动 |
| 6.1 / 6.2 / 6.3 / 6.4 | `mergeModelCatalog` 的 `providers` 修订 + 记账 |
| 7.1 | 注册时一条 info 日志 |
| 7.2 / 7.3 | 端到端验证任务（真实服务实例建会话） |

## Components and Interfaces

```ts
/** runner 侧读取的 env(跨进程契约,Revalidation Trigger)。 */
export const RUNNER_AI_GATEWAY_BASE_ENV = "PI_WEB_AI_GATEWAY_SESSION_BASE";
export const RUNNER_AI_GATEWAY_KEY_ENV = "PI_WEB_AI_GATEWAY_SESSION_KEY";
export const RUNNER_AI_GATEWAY_MODELS_ENV = "PI_WEB_AI_GATEWAY_SESSION_MODELS";

/** provider 命名空间 —— 必须与 mergeModelCatalog 产出的 provider 字段逐字一致。 */
export const AI_GATEWAY_PROVIDER_NAME = "ai-gateway";

export interface AiGatewaySessionSpec {
  readonly baseUrl: string;      // 已含 /v1
  readonly apiKey: string;
  readonly modelIds: readonly string[];
}

export function resolveAiGatewaySessionSpecFromEnv(
  env: NodeJS.ProcessEnv,
): AiGatewaySessionSpec | undefined;

export function registerAiGatewayProvider(
  registry: ModelRegistry,
  spec: AiGatewaySessionSpec,
): void;
```

**契约**：三个 env 任一缺失/非法 → `undefined`（不抛，不打断本地路径，与 egress 同惯例）；
`modelIds` 为空数组 → `undefined`（无模型的 provider 无意义）。

## Error Handling

| 情形 | 处理 |
|---|---|
| env 缺失/JSON 非法 | 返回 `undefined`，runner 走 SDK 默认，不抛 |
| 目录为空（拉取从未成功） | 装配层产出空 env，不注册 |
| 模型不在 registry | `resolveModel` 抛错，网关来源附来源提示（D5） |
| 上游 401（选中不可对话变体） | 原样透传上游文案；文档记局限 |
| `ai-gateway` 与 auth.json 撞名 | 实施期显式核对（Req 3.3）；撞名会静默覆盖 apiKey → 401 |

## Testing Strategy

### 单元测试

- `session-model-source.test.ts`：三 env 齐全 → spec；任一缺失 → undefined；JSON 非法 → undefined；空数组 → undefined；`registerAiGatewayProvider` 后 `find` 可解析（**含带斜杠 id**，钉住 research §五的唯一未实证点）。
- `ai-gateway-session-assembly.test.ts`：未启用 → `{}`；无 key → `{}`；空目录 → `{}`；齐全 → 三件套且 key 不出现在日志。
- 既有 `model-catalog` 相关测试：`availability` 与 `providers` 断言须**更新期望**（有意修订，Req 6.4），不得放宽为宽松匹配。

### 端到端验证（Req 7.2，不可替代）

1. 真实服务实例（网关已配）中打开设置页，确认「默认 Provider」下拉出现网关项；
2. 模型选择器中网关条目**可选中**；
3. 选中一个网关模型**新建会话并发送一条消息**，得到实际回复；
4. 记录所用模型标识、耗时、回复内容作为新鲜证据。

**★不得**以单测通过或「直接请求转发端点成功」替代（Req 7.3；
pi-clouds `cloud-builtin-agent-normalization` 的教训：单测与 tsc 全绿掩盖不了运行时架构不兼容）。

### 验证命令

```
pnpm --filter @blksails/pi-web-server test
pnpm --filter @blksails/pi-web-ui test
npx tsc --noEmit
```
