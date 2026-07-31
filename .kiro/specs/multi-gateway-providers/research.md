# Research Log — multi-gateway-providers

> 调研方式：4 路并发子代理（目录服务与装配层 / runner 侧注册 / 前端消费面 / 配置存储与迁移先例）+ 主上下文的运行时实测。
> 特性类型判定：**Complex Integration**（跨目录服务、装配层、runner、配置 UI、canvas-ui 五个面）。

## 0. 运行时实测：三个只读端点的真实响应形状

对本机 dev（`localhost:3000`，`.env.local` 已配 CF 网关三件套）实测所得，是设计契约的一手依据：

| 端点 | 顶层键 | 条目字段 | 条目样本 |
|---|---|---|---|
| `/api/config/models` | `models`, `providers`, `protocolVersion` | `provider, id, name, source, channel, availability` | `{"provider":"ai-gateway","id":"anthropic/claude-opus-5","name":"anthropic/claude-opus-5","source":"ai-gateway","channel":"anthropic","availability":"session"}` |
| `/api/aigc/models` | `models`, `protocolVersion` | `provider, model, label, source` | `{"model":"gpt-image-2","label":"GPT Image 2 · NewAPI","provider":"newapi","source":"self"}` |
| `/api/vision/models` | `models`, `protocolVersion` | `provider, value, label` | `{"value":"openrouter/amazon/nova-2-lite-v1","label":"Amazon: Nova 2 Lite","provider":"openrouter"}` |

**三套字段名互不相同**，是端点合一的核心难点：

- 模型标识：`id` / `model` / `value`（且 `value` 是 `provider/modelId` 复合格式，另两者是裸 id）
- 展示名：`name` / `label` / `label`
- 只有 `provider` 三处同名

## 1. 目录服务与装配层

### 1.1 完整调用链

**装配期（进程启动，单例）**

1. `buildSingleton()` — `lib/app/pi-handler.ts:507`
2. `resolveAiGatewayConfig(process.env)` — `pi-handler.ts:513` → `adapters/src/ai-gateway/config.ts:138`，返回**一个** `AiGatewayConfig` 或 `undefined`
3. `new EnvKeyResolver(process.env)` — `pi-handler.ts:514`
4. `new GatewayModelCatalog({...})` — `pi-handler.ts:539-548`，**单实例单快照**
5. `makeModelCatalog = () => createModelCatalogService({...})` — `pi-handler.ts:557-575`，**每请求调用一次**（为让 `PI_WEB_HIDE_PROVIDERS` 请求期求值）

**请求期 · `/api/config/models`**：`hostDeps.listModelOptions`（`pi-handler.ts:1218`）→ `config-routes.ts:125-145` → `service.chatOptions()`（`service.ts:83-105`）→ `mergeModelCatalog`（`model-catalog.ts:223-266`）→ `excludeProviders`（`model-options-filter.ts:33-42`）

**请求期 · `/api/aigc/models`**：`pi-handler.ts:1330-1332` → `aigc-models-routes.ts:27-36` → `service.imageEntries()`（`service.ts:106-119`）

**请求期 · `/api/vision/models`**：`pi-handler.ts:1333-1335` → `vision-models-routes.ts:27-43` → `listVisionModelOptions(config.agentDir)`
★ **完全不经目录服务**，只读 self 的 `models.json` —— 所以今天网关模型根本不在视觉清单里。合并后视觉筛选会**多出**网关的读图模型，属预期内的行为变化，须在迁移说明中标注。

### 1.2 mergeModelCatalog 的 provider 收敛（`model-catalog.ts:223-266`）

- self 块：`{...m, source:"self", availability:"session"}`，provider 保持原值（`:228-232`）
- 网关块：先按 `isSessionCapableGatewayModel` 过滤（`:237`，只排 `:batch` 后缀），再硬拍 `provider: AI_GATEWAY_PROVIDER_NAME`（`:241`），丢弃上游归属
- `channel` ← `GatewayModelEntry.ownedBy` ← `/v1/models` 的 `owned_by`（`:100-102`），**仅供 UI 二级分组，不进 providers**
- `availability` ← 常量 `"session"`（原为 `"catalog"`，随会话接入翻转）；`model-select-field.tsx:222` 只看它决定 disabled
- 块排序：`precedence === "gateway" ? [gw, ...self] : [self, ...gw]`（`:250-253`），**只排序不覆盖**
- 去重 key = `` `${provider}/${id}` ``（`:256`），因 provider 收敛，self 与 gateway 永不同 key
- providers 输出：self provider 去重排序 + 网关块非空时 `push("ai-gateway")`（`:264-265`）

### 1.3 TTL 缓存与 fail-soft

- `GatewayModelCatalog`（`model-catalog.ts:110-189`）三件状态：`snapshot` / `lastSuccessAt` / `refreshing`
- `get()` 是 stale-while-revalidate：过期且无在途刷新 → 触发**不等待**的后台 refresh，立即返回旧快照
- fail-soft（`:180-188`）：catch 内不更新快照也不更新时间戳，只 warn；从未成功过 → 空集
- 归属白名单 `filterByOwner`（`:78-85`）在写入快照前生效，并记 `kept/dropped/allowed`
- 另有两层兜底：`config-routes.ts:141` catch → `{providers:[],models:[]}`；`vision-models-routes.ts:38` 降级 200 空清单

★ **关键结论**：`GatewayModelCatalog` 类**本身已可多实例化**（全部状态实例私有、依赖全注入），上层只是恰好只 `new` 了一次。多实例改造不需要重写这个类，只需上层聚合器 + 日志实例标识。

### 1.4 「单实例」假设的 22 处固化点

| # | 位置 | 固化形态 |
|---|---|---|
| 1 | `core/src/model-provider-names.ts:17` | `AI_GATEWAY_PROVIDER_NAME = "ai-gateway"` 全局唯一常量，前端/runner/装配三处共用 |
| 2 | `ai-gateway/model-catalog.ts:241` | merge 时硬拍 provider |
| 3 | `ai-gateway/model-catalog.ts:265` | `providers.push(AI_GATEWAY_PROVIDER_NAME)`，最多一个网关名 |
| 4 | `core/src/model-catalog/types.ts:24` | `GatewayModelEntry.source` 是字面量类型，无实例 id |
| 5 | `core/src/config/model-options.types.ts:20` | `source?: "ai-gateway" \| "self"` 字面量联合 |
| 6-7 | `core/src/model-catalog/service.ts:31/41/45` | `gatewayChat` / `mergeCatalog` / `gatewayImageCatalog` 均为**单值可选字段** |
| 8-9 | `ai-gateway/config.ts:138` 及 `:15/24/27/30/33/36` | 返回单个配置对象；六个 env 常量无实例维度 |
| 10-11 | `pi-handler.ts:513-514, 539-548` | 单变量 `aiGwConfig` / `aiGatewayKeyResolver` / `gatewayModelCatalog` |
| 12 | `ai-gateway/model-catalog.ts:119-122` | 实例私有状态（可多实例，但上层只 new 一次） |
| 13-14 | `ai-gateway/session-model-source.ts:26-30, 180` | runner env 三件套固定名，单 baseUrl / 单 key |
| 15 | `lib/app/ai-gateway-session-assembly.ts:98` | `baseUrl` 单值 |
| 16 | `ai-gateway/routes.ts:37/52` | `ROUTE_PATH = "/ai-gateway/*"` 无实例段；`EXPECTED_SCOPE` 固定 |
| 17 | `server/host-assembly/default-capabilities.ts:91/194` | `HostDeps.aiGateway?` 单值；能力 id `gateway.ai` 属**冻结名册** |
| 18 | `lib/app/ai-gateway-assembly.ts:28/31/34` | 单 scope、单对沙箱 env `PI_AI_GATEWAY_BASE/TOKEN` |
| 19 | `model-catalog.ts:26`、`routes.ts:182` | logger namespace 硬编码，多实例日志无法区分 |
| 20 | `tool-kit/src/aigc/model-catalog.ts:23-31` | `AigcCatalogEntry.provider` 封闭字面量联合 |
| 21 | `core/src/model-catalog/service.ts:57` | `CatalogImageEntry.source?` 封闭联合 |
| 22 | `ai-gateway/key-resolver.ts:42-43` | `EnvKeyResolver` 固定读两个 env 名 |

### 1.5 既有测试覆盖

`packages/adapters/test/ai-gateway/`（config / model-catalog / model-catalog-allowlist / key-resolver / routes / session-model-source.it / e2e-live-gateway 共 7 个）、`packages/server/test/model-catalog/service.test.ts`、`packages/core/test/{aigc-settings/aigc-models-routes,vision-settings/vision-models-routes,config/settings-model-options}.test.ts`、`packages/ui/test/config/model-select-field.test.tsx`、`test/ai-gateway-{assembly,session-assembly}.test.ts`、`test/ai-gateway-route-mount{,-disabled}.integration.test.ts`、`e2e/browser/aigc-tool-settings.e2e.ts`

**覆盖缺口**：`config-routes.ts` 的 `/config/models` 无专属路由测试；`server/src/host-assembly/model-sources.ts` 无测试。

## 2. runner 侧模型 registry 装配

### 2.1 两条构造路径（判定点唯一，`runner/src/runner/option-mapper.ts:104-131`）

`listModelSources()` 逐个 registrar 调 `resolveSpecFromEnv(process.env)`，保留非 `undefined` 者：

- **路径 A（SDK 默认）**：`resolved.length === 0` → 不写 `servicesOptions.authStorage/modelRegistry`。SDK 落到 `agent-session-services.js:57-59`，用 `ModelRegistry.create(authStorage, join(agentDir,"models.json"))` —— **读 models.json**。
- **路径 B（注入）**：`resolved.length > 0` → `getSharedModelServicesFactory()`（缺失 fail-fast）→ `makeShared(agentDir)` → 逐源 `registrar.register(...)`。

触发路径 B 的 env：egress 三件套（`PI_WEB_CLOUD_EGRESS_BASE/_DESKTOP_CREDENTIAL/_MODELS`）**或** ai-gateway 会话三件套（`PI_WEB_AI_GATEWAY_SESSION_BASE/_KEY/_MODELS`）。

### 2.2 ★ 核心缺陷：核实结论 **准确**，且影响面比初判更广

**证据链**：

1. `adapters/src/auth/egress-model-source.ts:146-150` — `createSharedModelServices` = `AuthStorage.create(...)` + `ModelRegistry.inMemory(authStorage)`
2. SDK `model-registry.js:267-269` — `inMemory()` 即 `new ModelRegistry(authStorage, undefined)`，`modelsJsonPath === undefined`
3. SDK `model-registry.js:291-293` — `loadModels()` 中 `this.modelsJsonPath ? loadCustomModels(...) : emptyCustomModelsResult()`
4. 两条路径的差别**只有这一个参数**

**比初判更广的三点**：

- 丢的不止「自定义 provider 的模型」，还包括 models.json 里对**内置** provider 的 `overrides` / `modelOverrides`（自定义 baseUrl、代理、模型参数覆写），见 `model-registry.js:294-297`。
- models.json 形式的**凭据**也一起丢：`models_json_key` / `models_json_command` 两个来源（`model-registry.js:576-588`）在 inMemory 下永不成立。而 `getAvailable()` = `models.filter(hasConfiguredAuth)`（`:491-493`），故「models.json 里有 apiKey、auth.json 里没有」的 provider 会被整体过滤掉。
- ★ **触发条件不限于登录态**：只要**任一**已登记模型源解析成功即走路径 B。**纯本地启用 ai-gateway 套件同样踩中** —— 这正是本仓最初报障「新增 qiniu provider 在会话选择器里看不到」的真因（本机 `BLKSAILS_GATEWAY_BASE_URL` 指向 CF，ai-gateway 已启用）。

**SDK 是否支持「读 models.json + 动态注册」叠加：支持。**

- `model-registry.d.ts:279-281`：`create(authStorage, modelsJsonPath?)` / `inMemory(authStorage)` / `registerProvider(name, config)`
- `registerProvider` 与 `create` 正交（`model-registry.js:622-626`），不依赖是否有 modelsJsonPath
- `refresh()` 在重载磁盘后会**重新套用**所有已注册的动态 provider（`:273-284`）—— 证明「磁盘 + 动态注册」是 SDK 的既定支持形态
- ⚠ 语义注意：`registerProvider` 带 `models` 时会**替换该 provider 的全部已有模型**（d.ts:437-440）。只要实例名不与用户 models.json 的 provider 名撞名即安全；撞名则用户定义被顶掉

**最小修法**：`createSharedModelServices` 改用 `ModelRegistry.create(authStorage, join(agentDir, "models.json"))`，其余不动。注入路径与 SDK 默认路径就此对齐，`registerProvider` 在其上叠加。仍是**只读** models.json、不写盘，不破「不改 agentDir」的约束。

### 2.3 ModelSourceRegistrar 机制

- 契约（`model-source-registrar.ts:44-56`）：`providerName` + `resolveSpecFromEnv(env)` + `register(registry, spec, log)`
- 表：`registrars[]`（按 `providerName` 去重覆盖，`:62-66`）+ 单例 `sharedServicesFactory`（`:68-77`，「谁自建 registry 谁就顶掉别人」）
- 谁登记：`server/host-assembly/model-sources.ts:42-67` 的 `registerBuiltinModelSources()`
- 何时登记：`runner/src/runner/runner.ts:365-374` 的 `composeModelSources()`，由 `main()` **首行** await 调用（`:380-381`）。**动态 import**，失败仅 warn 不阻断（退化为「两源皆未配置」）。跨包边显式登记在 `core/test/tiering/module-roster.ts:132`
- 事实源：`core/src/model-provider-names.ts:17,20`（`"ai-gateway"` / `"pi-cloud"`），adapters 两侧 re-export；第三处消费者 `runner/src/runner/session-options.ts:84`（失败文案分化）

### 2.4 多实例对 registrar 契约的冲击

**现有接口部分能承载，但语义会错**：

- `register()` 本身不受限，理论上可循环 `registerProvider("gw1", ...)` / `("gw2", ...)`，`TSpec` 也可是数组
- **但** `providerName` 会退化成撒谎字段：去重键（`:63`）会把同一 registrar 的多次登记当覆盖；`:47-49` 要求它与注册进 registry 的名字逐字一致，多实例下该不变式直接失效，任何按 providerName 反查来源的逻辑（如 `session-options.ts:84`）会漏判
- env 契约也是单实例形状（三个平坦键），需改为索引化键或单键装 JSON 数组

**契约改动方向（设计取舍）**：`providerName: string` → `providerNames: readonly string[]`（简单），或 `sourceId`（registrar 身份）+ `providerNamesOf(spec)`（实例身份，注册后可枚举）。后者才能表达「实例数依 env 而定」。去重键改用 `sourceId`，并新增「已注册 provider 名集合」回读能力，供文案分化与前端目录校验共用同一事实源。

### 2.5 `GET /sessions/:id/models` 回包

`200 { models: Model[] }`，按 `PI_WEB_HIDE_PROVIDERS` 剔除（`query-routes.ts:122,126`）。

`Model` 字段（`protocol/src/rpc/model.ts:166-187`）：`id`, `name`, `api`, `provider`, `baseUrl`, `reasoning`, `thinkingLevelMap?`, **`input`（`("text"|"image")[]`）**, `cost{...}`, `contextWindow`, `maxTokens`, `headers?`, `compat?`。
★ **有 `input` 无 `output`** —— 与 requirements 决策「对话模型 output 缺省补 `["text"]`」一致。

写侧 `POST /sessions/:id/model` → `command-routes.ts:221-233`，body `{provider, modelId}`。

### 2.6 测试缺口

★ **`model-source-registrar.ts` 无专属单测**（`resetModelSourcesForTest` 目前零调用点）—— 契约改造前这是个测试空洞，必须先补。

## 3. 前端消费面（8 个，比初判多 2 个）

| # | 界面 | 组件 | 取数 | 数据形状 |
|---|---|---|---|---|
| ① | settings 默认 Provider | `ui/config/fields/model-select-field.tsx:71`（widget `providerSelect`） | `GET /api/config/models`，模块级 Promise 缓存 | 只用 `providers: string[]` |
| ② | settings 默认模型 | 同文件（widget `modelSelect`，`:115-130`） | 同一份缓存 | `provider,id,name,source?,availability?,channel?`；`availability==="catalog"`→disabled；★`channel` 取到但**不渲染** |
| ③ | settings AIGC 图像模型开关 | `ui/config/fields/aigc-model-toggles-field.tsx:47` | `GET /api/aigc/models`，独立缓存 | `model,label,provider,source?`；值语义**反向**（存 `disabledModels` 黑名单） |
| ④ | settings 视觉模型 | `ui/config/fields/vision-model-select-field.tsx:49` | `GET /api/vision/models`，独立缓存 | `value(=provider/modelId),label,provider`；硬截断 `MAX_VISIBLE=50` |
| ⑤ | Canvas 解读弹层 | `canvas-ui/vision-op.ts:98`、`canvas-launcher.tsx:73` | `GET {baseUrl}/vision/models`，★**相对 baseUrl 非 `/api/` 前缀**，每次 mount 拉取、**无缓存** | 同 ④ |
| ⑥ | 聊天提示词栏模型选择器 | `ui/elements/model-selector.tsx` ← `pi-chat.tsx:807,1493` | **RPC** `getAvailableModels(sessionId)` | `provider,id,name`；无 source/availability 概念 |
| ⑦ | 提示词栏 AIGC 快捷设置 | `canvas-ui/aigc-quick-settings.tsx:254` | **state-bridge KV，零 HTTP** | `aigc.models: string[]` + `modelLabels`/`modelProviders` 映射 |
| ⑧ | settings 凭证 | `protocol/config/domains/auth.ts:40` | `GET/PUT /api/config/auth` | `Record<provider,{apiKey(secret),baseURL?}>`；`KNOWN_PROVIDERS`(`:12-19`) 是**写死的建议列表**，与 ① 的动态 providers 无关联 |

★ ①②共享缓存、③④各一份、⑤无缓存 → 一次进 settings + Canvas 打 **4 次独立请求**，且 ④⑤ 重复请求同一端点。

### 3.1 ★ provider 管理界面的可行性：能做，但不能挂通用 `/config/:domain`

**UI/IR 层完全够用，零扩展**：`FieldKind` 已有 10 种（`protocol/config/form-schema.ts:9-19`），含 `objectList`（可增删，`ui/config/fields/object-list-field.tsx:42-49`）、`object.variants`（判别式多态，`:70-83`，★切换判别键即整项重置）、`record.itemKind:"secret"`（动态键值掩码）。`mcpFormSchema`（`domains/mcp.ts:186-231`）已用这三者拼出「可增删条目 + 每条含密钥 + 按类型切字段集」的完整形态，与 provider 管理同构。

**决定性障碍 —— 服务端 secret 遍历不支持数组**：通用 `maskSecrets`（`core/config/secret-merge.ts:144`）只认两种形态：top-level-record 与 flat object + 一层 nested record（`:74-115`，仅 `kind === "record"` 才下钻）。**完全不遍历数组** → `objectList` 里的 secret 子字段**不会被掩码，明文直接回读到浏览器**。MCP 正因此另写了 `core/config/mcp-secrets.ts`（约 130 行）。

**其他约束**：
- `zodToFormSchema` 不支持 `ZodDiscriminatedUnion`、不产 `objectList`（`:88-95` 只把 `ZodArray` 映到 `stringList`/`multiEnum`）→ **zod 与 FormSchema 必须两侧手写并同步演进**（`mcp.ts:11-16` 的既定判例）
- widget 注册需改 4 处：域 schema 的 `describe` → 组件文件 → barrel 导出 → `register-panels.ts` 的 `registerFieldRendererByKey`。★ `fieldKey` 与 `widget` 共用一张 `byKey` 表（`field-registry.ts:66-67`），widget 名不能与任何字段 key 撞名

### 3.2 ★ auth 域与新 provider 域的关系必须先定

`auth.ts:40` 的 `z.record(authProviderSchema)` 是**现存的 provider→凭证事实源**（`~/.pi/agent/auth.json`，pi SDK 也读它）。新 provider 域若也存凭据，会产生**双写入口**。此项必须在设计中明确取舍。

### 3.3 KV 链路（⑦）不随端点合一自动覆盖

`tool-kit/aigc/extension.ts:75-80` 在**会话装配期发布一次**：`aigc.models` / `aigc.modelLabels` / `aigc.modelProviders`，源自 `deriveActiveModels(disabledModels, extraRoutes)`。发布带重试（50ms×40≈2s）后 fail-soft。**无主动刷新** —— 改 `disabledModels` 后须新建会话才生效。⚠ 已知坑：`core/session/pi-session.ts:269` 重启后新 runner 重推的 `aigc.models` 会被 control-store 的陈旧丢弃逻辑忽略。

## 4. 配置存储机制与迁移先例

### 4.1 通用域链路

声明（zod + `.describe(JSON.stringify(UIMeta))`）→ `zodToFormSchema` 或手写 IR → `CONFIG_FORM_SCHEMAS`（`protocol/config/index.ts:45-52`）+ `DOMAIN_SCHEMAS`（`core/http/routes/config-routes.ts:32-44`）→ GET 走 `codec.load` + `maskSecrets` → PUT 走 `mergeSecrets` + zod 校验 + `codec.save(merge:false)`。

- **文件名由域 id 直接决定**：`` `${domain}.json` ``（`config-codec.ts:73,100`），根目录 `PI_WEB_AGENT_DIR` 或 `~/.pi/agent`
- **权限与原子性由 `LocalWorkspace` 承担**：`DIR_MODE=0o700`（`local-workspace.ts:57`）、`FILE_MODE=0o600`（`:59`）、同目录 temp + rename 原子写（`:266-280`）
- 损坏降级：`code === "corrupt"` → `{}` + warn，其余 IO 错误 rethrow
- 多租户接缝：`ConfigCodec` 可注入 `WorkspaceNamespace`，云端走 `TenantWorkspace.user`

**新增通用域改 3 处**（+1 处同族导出）：域文件 → `protocol/config/index.ts`（`export *` + `ConfigDomainId` 联合 + `CONFIG_FORM_SCHEMAS`）→ `config-routes.ts:32-44` 的 `DOMAIN_SCHEMAS` → `register-panels.ts` 一次 `registerSettingsPanel`。

### 4.2 ★ 独立路由（mcp 模式）的隐藏代价

`core/http/routes/mcp-config-routes.ts` 直接 `fs.readFile/writeFile`（`:55, :131-132`），**没有 0700/0600 mode、没有原子写、不走 ConfigCodec**。对一个存 apiKey 的文件，这是实打实的安全降级。选独立路由必须自行补回这些保障。

### 4.3 secret 契约

单一事实源 `protocol/config/secret.ts`：读 `SecretMask = {__secret:true, set:boolean, hint?}`（明文绝不回传，`:5`）；写 `SecretWrite` 三态 `keep|clear|set{value}`。通用实现 `core/config/secret-merge.ts`（`buildMask` 取末 4 位做 hint）；MCP 专用 `mcp-secrets.ts:37/86`（其 mask **不带 hint**）。前端 `SecretField` 产出 `SecretWrite`；含 secret 的域用 `secretAwareValidator`（`register-panels.ts:96-97`）。

### 4.4 迁移先例：只有一例，且刻意「无版本号」

`protocol/config/domains/mcp-codec.ts` —— 旧格式 `mcpServers` 对象 → 权威 `servers` 数组：

- **读时归一**（`normalizeMcpConfig:119-159`），`migratedFromObjectMap` 标志经 GET 回吐给前端提示
- **不擅自丢弃**：未识别条目整条保留为 `UnrecognizedMcpServer{name,reason,raw}`，未识别顶层键进 `extraKeys`
- **不擅自猜测**：只有 `url` 而无 type 时**不**在 SSE / streamable-http 间二选一，标 unknown-transport 交用户显式选
- ★ **没有 schemaVersion、没有一次性重写脚本、没有备份**；迁移发生在每次读，直到用户保存才落盘为新形态

全仓 config 域范围内 `grep -i "migrat|legacy|backward compat"` 只命中此处与 `secret-merge.ts:194`。其余向后兼容全靠 zod `.passthrough()` + ConfigCodec 深合并保留未知字段。另一处正式版本化迁移在会话存储（`core/session-store/codec.ts:145-176`，v1→v2→v3），同样坚持「不回写存储原始字节」。

### 4.5 存量存储形状

```jsonc
// settings.json  (domains/settings.ts:17-94, .passthrough())
{ "defaultProvider": "anthropic", "defaultModel": "anthropic/claude-sonnet-4.6", ... }
// aigc.json  (domains/aigc.ts:22-63)  ★ disabledModels 是黑名单语义
{ "disabledModels": ["provider/model-id"], "visionModel": "", "enablePromptOptimization": false }
// auth.json  (domains/auth.ts:22-41)  ★ pi SDK 也读它
{ "<providerKey>": { "apiKey": "sk-...", "baseURL": "https://..." } }
// cloud.json
{ "egressBase": "https://..." }
```

★ `aigc.json` 的 `visionModel` 是**双向**字段：工具侧 `tool-kit/vision/model-preference.ts` 也会写回。

### 4.6 自定义 provider 存储的三个候选

| 方案 | 收益 | 代价 |
|---|---|---|
| **A. 扩展 auth 域** | 改动最小（0 新增域），record+secret 走现成 `mergeTopLevelRecord` | 污染 pi SDK 共读的 `auth.json`；record 形态**无法表达有序列表与 variants**；`cloud.ts:16-23` 已有「为不污染 auth 而单独开域」的判例 |
| **B. 新开通用域 `providers`** | 改 3 处；文件名/0600/原子写/租户隔离全部白拿；前端控件 100% 复用 | **必须自写 objectList 感知的 mask/merge 遍历器**（通用实现到不了数组内层）；从 auth.json 搬存量需读时归一器 |
| **C. 新开独立路由** | 换来 `/probe`、`/status` 这类附加端点空间 | 代价最高：路由工厂 + 能力 id + 路由顺序坑 + **丢掉 0600/原子写**（见 4.2）+ 自行处理租户注入 |

**存量迁移可行做法**（无版本号先例可循）：照 mcp-codec 模式做**读时归一 + 保留未识别** —— 读 providers.json 时若为空则从 auth.json 合成条目，保留 `extraKeys` 与无法识别项，用户保存时才写成新形态；不做一次性重写脚本、不加 schemaVersion。

### 4.7 存量键格式实测（决定迁移策略）

本机 `~/.pi/agent/aigc.json`：

```json
{ "disabledModels": [], "enablePromptOptimization": false, "visionModel": "apiservices/gpt-5.4" }
```

- `disabledModels` 存**裸 model id**（目录 `model` 字段值，如 `gpt-image-2`）
- `visionModel` 存**复合键** `provider/modelId`，与 vision 端点的 `value` 同格式，且是**双向字段**（工具侧也写回）

★ 结论：目录条目字段**改名**（`model`→`id`、`label`→`name`）**不影响** `disabledModels` 存的值（值本身是裸 id）。而 `visionModel` 的复合键只要让 vision 消费面**自行拼 `${provider}/${id}`**（正是它今天的 `value` 格式），存量值同样不受影响。**两处存量键均可零迁移**。

## 5. 设计综合（Synthesis）

### 5.1 泛化（Generalization）

- **Req 1（多网关实例）/ Req 7（自定义 provider）/ Req 8（云端下发）是同一个问题的三个变体**：「一个 provider 定义从某个来源进入目录」。应设计单一的 **ProviderSource** 抽象，三者是它的三个实现。这样 Req 8 的「预留接口」不再是占位符，而是抽象的自然结果——不实现云端拉取，只是少注册一个实现。
- **Req 3（端点合一）+ Req 4（类型维度）**：「chat / image 命名空间」是「按 `output` 类型筛选」的特例。命名空间不是被删除，而是**退化为查询条件**。
- **Req 5（隐藏名单）+ Req 7.5（停用 provider）**：都是「让某个 provider 不生效」，统一为 provider 的 `enabled` 判定，只是判据来源不同（部署 env 名单 vs 用户配置开关）。

### 5.2 建 vs 用（Build vs Adopt）

| 关注点 | 决策 | 依据 |
|---|---|---|
| 可增删的 provider 列表 UI | **adopt** `objectList` + `variants` + `itemKind:secret` | MCP 已用同一组能力做出同构界面，零 IR 扩展（§3.1） |
| 配置落盘（权限/原子写/租户） | **adopt** `ConfigCodec` + `LocalWorkspace` | 0600/0700 + temp+rename 白拿；独立路由会丢掉（§4.2） |
| 数组内 secret 的掩码/合并 | **build**（专用遍历器） | 通用 `secret-merge` 到不了数组内层；泛化通用实现会外溢到 6 个既有域，不划算（§3.1） |
| registry 磁盘+动态注册叠加 | **adopt** SDK 既定形态 | `refresh()` 会重新套用已注册 provider，是 SDK 明示支持（§2.2） |
| 网关目录多实例 | **adopt** 现有 `GatewayModelCatalog` 类 + 新增聚合器 | 类本身状态全实例私有，只需上层 new 多次（§1.3） |
| 存量配置迁移 | **adopt** mcp-codec 的读时归一模式 | 全仓唯一先例：无版本号、不重写文件、保留未识别（§4.4） |

### 5.3 简化（Simplification）

- **不实现云端拉取**：ProviderSource 抽象里不为它预留任何具体结构，只是「将来多一个实现」。
- **不泛化通用 secret-merge**：风险外溢到 6 个既有域。
- **不新增 FieldKind、不新增 widget**：provider 管理界面用现有 `objectList`。
- **不新增 provider 名前缀命名空间**：实例 id 即 provider 名（裸名，如 `cloudflare` / `blksails-ai`），冲突由启动期校验挡住而非靠前缀回避。理由：前缀会让 UI 显示成 `ai-gateway:cloudflare`，与「必须区分」的诉求背道而驰。
- **不引入 schemaVersion**：延续本仓 config 域的既定做法。
- **消除重复取数**：④⑤ 两处视觉清单今天各拉一次同一端点；合一后共用一个带参数键的缓存。
