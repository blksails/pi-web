# Research & Design Decisions

## Summary

`cloudflare-chat-provider` 交付后，CF 的 470 条模型**能被看见但不能被使用**：`mergeModelCatalog`
给全部网关条目打 `availability: "catalog"`，`ModelSelectField` 据此渲染为 `disabled`。

这不是缺陷，是 `model-catalog` spec **刻意冻结的语义**（任务 4.1 与 5.2 e2e 都在钉这条），
并在代码里留了明确的续作标记：

```tsx
// packages/ui/src/config/fields/model-select-field.tsx:222
// 判据只看 availability(非 source):P2 网关接入会话后翻转标记即可。
const isCatalogOnly = o.availability === "catalog";
```

本 spec 即那个 **P2**。核心结论：**执行侧接缝已经存在且有现成范式**，本 spec 不需要发明架构。

## Research Log

### 一、缺口的准确位置：不在目录，在「选中之后」

对话最终由 pi SDK 的 `ModelRegistry` 执行。`option-mapper.ts:232`：

```ts
const found = registry.find(model.provider, model.modelId);
if (found === undefined) throw new Error(`Model not found in registry: ...`);
```

网关模型（`provider: "ai-gateway"`）**不在** SDK 默认 registry（内置 + `<agentDir>/models.json`）里。
所以即便把 `availability` 翻成 `session`、让用户选中，会话创建时也会直接抛错。

**故本 spec 的实质工作在执行侧，不在目录侧。** 翻标记只是最后一步。

### 二、★现成范式：`buildEgressModelSource`

`desktop-cloud-login` 已经解过一模一样的题 —— 把一个「不在 SDK 默认清单里的远端 OpenAI 兼容出口」
接进会话（`packages/server/src/auth/egress-model-source.ts`）：

```ts
const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
const modelRegistry = ModelRegistry.inMemory(authStorage);
modelRegistry.registerProvider("pi-cloud", {
  baseUrl: base, apiKey: credential, api: "openai-completions",
  authHeader: true,                       // → Authorization: Bearer <credential>
  models: input.models.map(toProviderModel),
});
```

注入点在 `option-mapper.ts:320`：

```ts
const egressServices = resolveEgressModelSourceFromEnv(agentDir, process.env);
if (egressServices !== undefined) {
  servicesOptions.authStorage = egressServices.authStorage;
  servicesOptions.modelRegistry = egressServices.modelRegistry;
}
```

**关键性质**：`ModelRegistry.inMemory` **纯内存零落盘** —— 不写 `models.json`、不改 agentDir。
这正是本 spec 需要的（网关目录是 TTL 刷新的动态数据，落盘只会产生漂移）。

CF 的兼容面是 OpenAI 兼容 + `Authorization: Bearer`（`cloudflare-chat-provider` 已实调确认），
与 `EGRESS_API = "openai-completions"` / `authHeader: true` **逐项吻合**。

### 三、凭据不该下放：转发面也已经现成

`ai-gateway/routes.ts` 已实现挂在 `/ai-gateway/*` 的**换钥转发**：scoped token 校验 →
`KeyResolver.resolve()` 取真实 key → 覆写 `authorization` 转发上游。白名单里已含
`v1/chat/completions`（`routes.ts:44`）。

因此 registry 的 `baseUrl` 应指向**本部署自身**的 `/api/ai-gateway/v1`，`apiKey` 用一枚
`scope="ai-gateway"` 的短期 scoped token —— **真实网关凭据永不进入 agent 子进程环境**。

这与 `llm-gateway`（sandbox-credentials-v2）的既定安全立场一致，也复用了 `routes.ts`
既有的限额标注、超时、SSE 流式直通。

**对照（不采纳）**：把 `BLKSAILS_GATEWAY_API_KEY` 直接下发给 runner。改动更小，但把真实
凭据铺进子进程环境，与本仓两个既有 gateway spec 的立场相悖。

### 四、e2b 分支已铺了一半，且注释写明了缺口

`lib/app/ai-gateway-assembly.ts` 已在 e2b 会话注入 `PI_AI_GATEWAY_BASE` / `PI_AI_GATEWAY_TOKEN`，
形态**正是**第三节所需的 base + token。但该文件开头两处注释坦白了缺口：

> 供沙箱内 agent（经烘焙镜像/models.json 自定义 provider，**超出本仓范围**）按需选用……

> **本地（非 e2b）分支不调用本函数** —— 本地 agent 进程与 pi-web server 同机，是否需要类似
> 注入留待后续切片按实际 agent-side 消费方式接线（design.md §6 交付边界）。

**即：token 已经发出去了，但本仓内没有任何消费方。** 本 spec 补的就是这个消费方
（runner 侧 registry 注册），以及本地分支的对等注入。

### 五、模型 id 含斜杠 —— 经查不构成问题

CF 模型 id 形如 `anthropic/claude-opus-5`，本身含斜杠。曾担心 `provider/model` 拼接歧义，实查：

- 线格式是**结构化字段**而非拼接串：`rest-dto.ts:99` / `command.ts:45` 均为独立 `modelId: z.string()`；
- `mergeModelCatalog` 输出 `{ provider: "ai-gateway", id: g.model }` 两字段分立；
- `resolveModel` 调 `registry.find(provider, modelId)`，两参分立。

**结论：斜杠只在 `modelId` 内部，不跨字段。** 仍需在实施时以 `registry.find("ai-gateway",
"anthropic/claude-opus-5")` 实测确认 pi SDK 侧不对 id 做二次切分 —— 这是**唯一未经实证的环节**。

### 六、★provider 命名的一个已知雷

`egress-model-source.ts:13-15` 留下的警告：

> ⚠ provider 名固定 `pi-cloud` 命名空间：不得与 `auth.json` 已有 provider 撞名，否则 auth.json 的
> key **覆盖**本 provider 的 apiKey（pi SDK `getApiKeyAndHeaders` 顺序）。

本 spec 用 `ai-gateway` 作 provider 名（与 `mergeModelCatalog` 已产出的 `provider` 值必须一致）。
需确认 `auth.json` 中不存在同名条目，否则 scoped token 会被静默覆盖 → 401。

### 七、与 egress 注入的共存

两者都要占 `servicesOptions.modelRegistry` 这一个位置。`ModelRegistry.inMemory` 可注册多个
provider，故技术上可合成为一个 registry 注册两个 provider（`pi-cloud` + `ai-gateway`）。
但优先级与「登录态 + 网关同时启用」的语义需在 design 阶段明确决策。

## Architecture Pattern Evaluation

| 方案 | 凭据暴露面 | 改动量 | 结论 |
|---|---|---|---|
| A. 真实 key 下发 runner，registry 直连上游网关 | ❌ 真实 key 进子进程 env | 最小 | ❌ 与既有两个 gateway spec 立场相悖 |
| **B. scoped token + baseUrl 指向本部署 `/ai-gateway/v1`** | ✅ 仅短期 token | 小（复用两处现成件） | ✅ **倾向采纳** |
| C. 落盘 `models.json` 让 SDK 默认发现 | ❌ 且产生漂移 | 中 | ❌ 动态目录不该落盘 |

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| pi SDK 对含斜杠的 modelId 做二次切分 | **高 —— 是「B 方案成立」的唯一未实证前提** | 实施第一步即以真实 registry 实测；不成立则需在 design 回退到 id 编码方案 |
| `ai-gateway` 与 auth.json 条目撞名 → 401 | 中 | 实施时显式核对；参照 `pi-cloud` 的既有告诫 |
| 470 条全部可选 → 含 `:batch`/embedding 等不可对话变体，选中即失败 | **中 —— 且本 spec 会把它从「点不了」变成「点了就报错」** | 本 spec 必须表态：收敛策略纳入还是留待后续（见 requirements Story 4） |
| 与 egress 注入抢占 `modelRegistry` | 中 | design 阶段明确合成/优先级 |
| 本地分支注入需要本部署自身可达 base | 低 | 本地同机，可用监听地址；但需处理 basePath |
| 据既有注释推断而非实证 | 中 | 本文档结论均已给出文件行号；执行链结论须在 impl 以真实会话验证，不得以单测替代 |

## References

- 前作：`.kiro/specs/model-catalog/`（冻结了 catalog 不可选语义）
- 前作：`.kiro/specs/cloudflare-chat-provider/`（目录侧已通，470 条实测）
- 范式：`packages/server/src/auth/egress-model-source.ts`
- 注入点：`packages/server/src/runner/option-mapper.ts:316-333`
- 转发面：`packages/server/src/ai-gateway/routes.ts`
- 半成品：`lib/app/ai-gateway-assembly.ts`
- UI 判据：`packages/ui/src/config/fields/model-select-field.tsx:216-250`
