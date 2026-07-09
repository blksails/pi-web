# Gap Analysis — image-vision-tool

> 生成于 requirements 批准前，用于给 design 阶段提供事实底座。
> 所有结论均由 `node_modules` 内真实 `.d.ts` / `.js` 与本仓源码核实，非推测。

---

## 1. 现状调查（Current State）

### 相关资产

| 资产 | 位置 | 与本特性的关系 |
| --- | --- | --- |
| attachment seam（全局注入） | key `packages/tool-kit/src/attachment/seam.ts:15`；注入 `packages/server/src/runner/attachment-wiring.ts:151` | 工具在子进程内读 `globalThis[SEAM_KEY]` 取 `AttachmentToolContext` |
| attachment 契约 | `packages/agent-kit/src/attachment.ts:86-111` | `resolve(id)` / `listBySession()` / `available` |
| `AttachmentToolHandle` | `packages/agent-kit/src/attachment.ts:48-57` | `meta: Attachment`、`bytes()`、`localPath()`、`url()` |
| `Attachment` 描述符 | `packages/protocol/src/attachment/attachment-dto.ts:24-33` | `id / name / mimeType / size / origin / sessionId / createdAt(ISO)` |
| 取图 → data URI | `packages/tool-kit/src/attachment/persist.ts:136-145` | 现成，但产出 **data URI**（非裸 base64） |
| LLM 子调用先例 | `packages/tool-kit/src/auto-title/auto-title-extension.ts:19,113-128,135` | `completeSimple` + `modelRegistry.find` 回退 `ctx.model` |
| 交互补全先例 | `packages/tool-kit/src/aigc/run-image-tool.ts:156-194` | `ctx.hasUI` 守卫 + `ctx.ui.select/input` |
| fail-soft 先例 | `packages/tool-kit/src/aigc/run-image-tool.ts` | 任何失败返回 `{ok:false}` 不抛 |
| 扩展命令执行拦截 | `packages/ui/src/chat/pi-chat.tsx:972-996` | `source==="extension"` → `armExtControlStream()` + `client.prompt` fire-and-forget |
| 扩展命令可见策略 | `packages/ui/src/controls/pi-command-palette.tsx:9-15,54-59,118` | **默认隐藏全部扩展命令** |
| `webVisible` 回填 | `packages/server/src/plugin/enrich-web-visible.ts` | 依据命令 `sourceInfo` 解析所属**插件包**的 `pi-plugin.json` |
| tool-kit 子入口 | `packages/tool-kit/package.json` `exports` | 已有 `.` / `./runtime` / `./commands` / `./*-entry` |

### 关键约定

- 依赖方向 `protocol ← 所有`；tool-kit 里含 pi SDK **值导入**的模块只经 `./runtime` 子入口暴露。
- 测试落在 `packages/tool-kit/test/<domain>/`（已有 `aigc/`、`attachment/`、`auto-title/`）。
- 每个 spec 硬性要求单元/集成测试 + e2e 新鲜证据（`.kiro/steering/tech.md`）。

---

## 2. 需求 → 资产映射与 gap

| 需求 | 可复用资产 | Gap | 类别 |
| --- | --- | --- | --- |
| **R1** 图像来源解析 | seam / `resolve().bytes()` / `listBySession()` / `Attachment.mimeType`+`createdAt` | 无「取会话内最近一张图」的现成 helper，需按 `mimeType.startsWith("image/")` 过滤 + `createdAt` 降序自实现 | Missing（小） |
| **R2** 可用模型清单 | `ModelRegistry.getAvailable()` = `models.filter(hasConfiguredAuth)`；`Model.input: ("text"\|"image")[]` | 无。`getAvailable()` 的语义**恰好**等于 R2.2「凭据可用」 | — |
| **R3** 交互式选择 | `ctx.hasUI` + `ExtensionUIContext.select(title, options: string[], opts?) → Promise<string \| undefined>` | `select` 返回**选中的字符串本身**而非索引 → 需 label ↔ model 双向映射；取消返回 `undefined` 天然满足 R3.3 | Constraint |
| **R4** 无 UI 降级 | `ctx.hasUI` | M1 不做 config 域 ⇒ R4.3「已配置默认视觉模型」**当前无处可读**，须在 design 中定一个 env 变量作为 M1 的默认模型来源 | Constraint |
| **R5** 执行识别 | `completeSimple(model, context, options)`；`ImageContent{type,data,mimeType}`；`UserMessage.content: (TextContent\|ImageContent)[]` | **见 §3 头号风险**：凭据不会自动解析 | Constraint（高） |
| **R6** 命令入口 | `pi.registerCommand`；pi-chat 执行拦截已就位 | **见 §4**：补全默认隐藏；handler 返回 `void`；`args` 是裸 string | Constraint（高） |
| **R7** 容错零回归 | `run-image-tool` fail-soft 形态；`reduce-snapshot.ts:11` 已说明扩展命令不发 `agent_start` 故不卡 busy | 无 | — |

---

## 3. 头号风险（已证伪一个设计假设）

**`completeSimple` 不会从 `models.json` 解析凭据。**

`@earendil-works/pi-ai/dist/compat.js:141-148`：

```js
function withEnvApiKey(model, options) {
  if (hasExplicitApiKey(options?.apiKey)) return options;   // 显式优先
  const apiKey = getEnvApiKey(model.provider, options?.env); // 否则回落环境变量
  if (!apiKey) return options;
  return { ...options, apiKey };
}
```

`streamSimple` → `provider.streamSimple(model, context, withEnvApiKey(model, options))`（`compat.js:174`）。

即：**凭据只来自 `options.apiKey` 或环境变量**。`auto-title` 能跑通是因为它用 `ctx.model`
（主模型，其 provider 的 key 恰在 env 中）。本特性要用 registry 里**另一个 provider** 的模型
（如 `apiservices`，key 只存在于 `~/.pi/agent/models.json`），照抄 auto-title 会直接 401。

**正解**（`ModelRegistry.getApiKeyAndHeaders` 与 `StreamOptions` 恰好对得上）：

```ts
// ResolvedRequestAuth = { ok: true; apiKey?; headers?; env? } | { ok: false; error }
//   —— pi-coding-agent/dist/core/model-registry.d.ts:7,72
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) return fail("model_auth_failed", auth.error);
await completeSimple(model, context, {
  apiKey: auth.apiKey,        // StreamOptions.apiKey
  headers: auth.headers,      // StreamOptions.headers
  env: auth.env,              // StreamOptions.env
  signal,                     // StreamOptions.signal（满足 R5.6 中止）
});
```

`StreamOptions` 确含 `apiKey` / `headers` / `env` / `signal`（`pi-ai/dist/types.d.ts` §StreamOptions）。

> **Design 必须显式写入这一步**，否则实现者会照抄 auto-title 而在真实网关上失败。

---

## 4. 命令入口的三个硬约束

1. **补全默认隐藏扩展命令。**
   `pi-command-palette.tsx:9-15` —— 平台默认隐藏所有 `source==="extension"` 命令（防 busy 卡死的安全网）。
   放行有两条：
   - `webVisible:true`（`pi-command-palette.tsx:118`）—— 但它由 server 端 `enrich-web-visible.ts`
     依据命令 `sourceInfo` 去解析**所属插件包的 `pi-plugin.json` 的 `web.commands`` 回填。
     本特性是进程内注入的 extension、**没有 pi-plugin.json**，因此**拿不到这个标记**。
   - 宿主传 `extensionCommands={{ allowlist: ["img_vision"] }}`（prop 已存在：
     `pi-chat.tsx:146,318,1306` → `pi-command-palette.tsx:72`）。

   ⇒ **推翻「前端零改动」的初始判断**：要让用户在 `/` 补全里看见 `img_vision`，
   app 层必须传一次 allowlist。这是一处 prop 级改动，非结构性改动。
   （执行路径不受影响：`pi-chat.tsx:972-996` 的拦截依据是 `controls.commands` 全量，
   与补全显示策略无关 —— 即便隐藏，用户手敲 `/img_vision` 仍能执行。）

2. **`handler` 返回 `Promise<void>`。**
   `RegisteredCommand.handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>`
   （`pi-coding-agent/dist/core/extensions/types.d.ts`）。
   ⇒ 结论**只能**经 `ctx.ui.notify(message, type?)` 呈现（R6.3/R6.4 由类型强制，不是经验之谈）。

3. **`args` 是裸 string**，无结构化参数。`/img_vision 这张图里有几个人` 需自行解析
   （约定：整个 args 即 question；图像走「最近一张图」缺省规则）。

补充：`RpcSlashCommand.source: "extension" | "prompt" | "skill"`（`modes/rpc/rpc-types.d.ts`）
证实 `registerCommand` 的命令 source 即 `"extension"`。

---

## 5. 实现方案选项

### Option A — 扩展既有 aigc 模块
把 vision 塞进 `tool-kit/src/aigc/`。
- ✅ 无新目录
- ❌ 语义错位（aigc 是**产图**，vision 是**读图**）；aigc 已含 provider/endpoint-adapter 体系，
  vision 走完全不同的调用层（modelRegistry），混在一起会诱导后人误用 `endpoint-adapter`
- ❌ `run-image-tool.ts` 已 450+ 行，继续膨胀

### Option B — 新建 `tool-kit/src/vision/`（推荐）
独立目录、独立 extension，仅复用 attachment seam 与 fail-soft 形态。
- ✅ 职责清晰：读图 vs 产图分离
- ✅ 可独立单测（seam 与 modelRegistry 都易 mock）
- ✅ 与 `auto-title/` 同构（同为「借一个模型做一件小事」的 extension）
- ❌ 多一个目录 + 一次装配接线

### Option C — 混合
新建 `vision/`，但把「att_id → 裸 base64」这一步抽成 attachment 层共享工具
（现有 `resolveInputToDataUri` 产 data URI，vision 需裸 base64）。
- ✅ 避免两处各写一遍 base64 前缀处理
- ❌ 触碰既有 `persist.ts`，扩大回归面

**推荐：Option B**，并在 vision 目录内自持一个 `toImageContent()`（不改 `persist.ts`）。
data URI ↔ 裸 base64 的转换只有一行，跨模块抽象的收益不抵回归风险。

---

## 6. 工作量与风险

| 维度 | 评级 | 理由 |
| --- | --- | --- |
| **Effort** | **S–M（3–5 天）** | 无新协议、无新 provider、无前端结构改动；主要工作是一个内核 + 两个入口 + 测试。命令入口的可见性接线与 e2e 占掉一半时间。 |
| **Risk** | **Medium** | 单点高风险已被本次分析消除（凭据解析）。剩余中风险：`/img_vision` 的 e2e 需要真实控制流与 `ctx.ui` 往返；无 UI 降级链在 headless 下的行为需专门测试。 |

风险明细：

- 🔴 **已消除**：`completeSimple` 凭据 —— 由 §3 给出确定解法。
- 🟡 命令 e2e：扩展命令不进消息历史、反馈只经 `ctx.ui`，断言点是 notify/控制流而非消息气泡。
- 🟡 `PI_WEB_VISION_MODEL`（或等价 env）作为 M1 默认模型来源需在 design 定名，避免 M2 引入
  config 域时改名造成破坏。
- 🟢 附件 seam 不可用（`available:false`）时的降级：已有 `UNAVAILABLE_CTX` 形态可循。

---

## 7. 带入 design 阶段的决策与研究项

**必须在 design 中确定：**

1. `getApiKeyAndHeaders` → `completeSimple(model, ctx, { apiKey, headers, env, signal })` 的确切调用形态（§3）。
2. M1 默认视觉模型的 env 变量名（建议 `PI_WEB_VISION_MODEL`，格式 `provider/modelId`，与
   auto-title 的 `resolveTitleModel` 解析形态一致）。
3. `ui.select` 的 label 格式与 label→model 的反查（`select` 返回字符串本身）。
4. 失败原因枚举：`no_image` / `no_vision_model` / `unknown_model` / `cancelled` / `aborted` /
   `model_auth_failed` / `call_failed` / `attachment_unavailable`（对齐 R7.2）。
5. `img_vision` 在补全中的可见性落点：app 层 `extensionCommands.allowlist`（并在 design 中
   记为对 R6.1 的显式交付项，不能遗漏）。
6. 是否新增 tool-kit 子入口：`visionExtension` 含 pi SDK 值导入，挂到既有 `./runtime` 即可，
   **无需**新子入口（从而绕开 root `tsconfig.json` paths 同步这个坑）。需在 design 确认
   `runtime.ts` 的现有导出形态。

**Research Needed（design 阶段核实）：**

- `runtime.ts` 当前导出了什么，`aigcExtension` 经哪条路径被 agent 装载
  （`forcedExtensionPaths` vs `AgentDefinition.extensions`），vision 复用哪条。
- e2e 策略：`PI_WEB_STUB_AGENT` stub 能否覆盖 `registerCommand` 往返；若不能，
  是否需要像 `agent-slash-completion` 那样起真实子进程。
- `ExtensionCommandContext` 与工具 `execute` 的 `ExtensionContext` 在 `signal` 上的差异
  （命令 handler 无 `signal` 形参，需从 `ctx.signal` 取）。

---

# Design 阶段追加 — Discovery（light）与 Synthesis

## 待核实项的结论（承接 §7）

| 项 | 结论 |
| --- | --- |
| `runtime.ts` 导出形态 | 已导出 `aigcExtension` 等（`tool-kit/src/runtime.ts:73`）。`visionExtension` 挂同一入口，**无需新子入口** ⇒ 绕开 root `tsconfig.json` paths 同步坑。 |
| extension 装载路径 | `AgentDefinition.extensions?: Array<string \| ExtensionFactory>`（`agent-kit/src/types.ts:133`）。范例：`examples/aigc-agent/index.ts:48` `extensions: [aigcExtension]`。vision 复用此路径。 |
| e2e 策略 | `e2e/node/extension-ui-select.e2e.test.ts` 已示范「`PI_WEB_STUB_AGENT=1` + 真实 HTTP handler + SSE」驱动 `extension_ui_request(select)` 往返。vision e2e 照此形态，`complete` 经 deps 注入 fake ⇒ 零 LLM 成本。 |
| `signal` 差异 | 工具 `execute` 第 3 参给 `signal`；命令 `handler(args, ctx)` 无该形参 ⇒ 命令入口取 `ctx.signal`（`ExtensionContext.signal: AbortSignal \| undefined`）。 |

## Synthesis 决策

1. **Build vs Adopt — 模型调用层**：Adopt pi 的 `ModelRegistry` + `completeSimple`；
   拒绝复用 AIGC `endpoint-adapter`（服务图像生成 API，语义不同，混用会诱导误接）。
   净效果：零新 provider、零新 API key、零新 env 占位。

2. **Generalization — 拒绝过早抽象**：`resolveInputToDataUri`（产 data URI）与 vision 所需的
   裸 base64 只差一行前缀处理。**不**把它抽成 attachment 层共享工具（Option C），
   在 `vision/resolve-image.ts` 内自持，避免触碰 `persist.ts` 扩大回归面。

3. **Simplification — 依赖注入替代 mock 框架**：沿用 `auto-title` 的
   `createAutoTitleHandler({ complete, resolveModel })` 形态，把 `complete` /
   `getAttachmentCtx` 收进 `VisionRunnerDeps`。核心逻辑因此可纯函数单测，e2e 亦零成本。

4. **命令的 args 简化**：`RegisteredCommand.handler` 的 `args` 是裸 string，无结构化参数。
   决定：整段 args 即 question，图像固定走「最近一张图」缺省规则，**命令不接受 att_id**
   （避免用户手抄 `att_<nanoid>`）。需要指定图时用工具，不用命令。

## Boundary 决策与理由

- vision 只读消费 attachment seam（`available` / `resolve` / `listBySession`），
  **明令禁止** `putOutput` / `setMeta` —— 本特性不产出附件，写入权不属于它。
- 不修改 `pi-chat.tsx` 的扩展命令执行拦截；只在 app 层追加一次 `extensionCommands.allowlist`。
  执行与可见性是两条正交的路，前者已就位，后者是本 spec 的显式交付项。
- **不打开** `extensionCommands.enabled = true`：那会放行全部扩展命令（多数在 web 端会卡死），
  安全网必须保留，只白名单单个 `img_vision`。

## 风险复核

- 🔴→🟢 `completeSimple` 凭据：已由「关键决策 1」锁定解法，并以单测 6 作为回归锁。
- 🟡 `/img_vision` 可见性遗漏 ⇒ 6.1 静默不达标（命令仍可手敲执行，易被误判为「已完成」）。
  缓解：design 与 tasks 中均列为显式交付项；e2e 3 断言命令闭环。
- 🟡 `PI_WEB_VISION_MODEL` 命名在 M2 引入 config 域时需保持兼容（届时作为 env 覆盖层保留）。
