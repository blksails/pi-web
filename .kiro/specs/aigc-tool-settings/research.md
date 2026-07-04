# Research & Design Decisions

## Summary
- **Feature**: `aigc-tool-settings`
- **Discovery Scope**: Extension（在既有 AIGC 图像工具 + webext slot + 会话状态桥 + 路由注入范式上做集成）
- **Key Findings**:
  - AIGC 图像工具的 **LLM 可见 `model` 枚举**在工具注册期由 `optionalModelEnum(ROUTES, DEFAULT)` 烤入 `PARAMETERS`（`image-generation.ts:140` / `image-edit.ts` 同款）；`registerImageGeneration/Edit` 直接用模块级 `ROUTES` + `PARAMETERS`。要过滤模型必须在**注册期**用过滤后的 routes 重建 description + parameters + 传给 `runImageTool`。
  - `publishAigcCatalog`（`extension.ts`）遍历 `IMAGE_GENERATION_ROUTES ∪ IMAGE_EDIT_ROUTES` 下发 `aigc.models/labels/providers`；同一过滤集须同时作用于此，前端 picker 自然收敛。
  - **会话状态桥**是 per-session 内存态（`wireStateBridge` 的 store 不跨会话持久）；故「提示词优化」这类实时开关适合走它，而「关模型」需**跨会话持久 + 装配期读**，必须落**持久文件**。
  - `SlotHost`（`packages/ui/src/web-ext/apply-extension.tsx`）给 slot 组件注入 `state`(WebExtStateAccess) + `baseUrl` + `syncSignal` + 附件上传接入 —— canvas 设置面板天然可用 `baseUrl` 发 REST、用 `state` 读写会话开关。
  - 路由注入范式成熟：`createFavoritesRoutes({ agentDir })` → 单 JSON 文件读写（原子写）→ 经 `pi-handler.ts` 的 `routes:[]` 注入；新顶层 API 段须自带 Next catch-all 转发器 `app/api/aigc/[[...path]]/route.ts`（否则静默 404）。

## Research Log

### 模型过滤的注入点（LLM 枚举 vs 前端清单）
- **Context**: Req 2.1/2.2 要求被禁模型同时从 LLM 枚举与下发清单移除。
- **Sources Consulted**: `packages/tool-kit/src/aigc/tools/image-generation.ts:140-176`、`extension.ts:36-59`、`run-image-tool.ts:76-133`（`buildModelsDescription` / `optionalModelEnum` / `selectRoute`）。
- **Findings**: 枚举烤在注册期；`selectRoute` 只按 routes 查找，若 route 已被过滤掉，未知 model 会**回退默认**（Req 2.4 天然满足）。
- **Implications**: 单一过滤集 `disabledModels` 在装配期算一次，喂给两个注册函数 + `publishAigcCatalog`。注册函数需从「模块级固定 PARAMETERS」改为「按 activeRoutes 现建 parameters」。

### 持久配置载体选型（关模型）
- **Context**: Req 1/3 要求跨会话持久、装配期可读、可被 canvas UI 写。
- **Alternatives**: 见下 Decision「模型持久配置载体」。
- **Findings**: 会话状态桥不持久；`settings.json` per-ext KV 机制门控在 `packages[]`（已安装扩展），而 aigcExtension 是内置 in-process 工厂、不在 `packages[]`，不适配。
- **Implications**: 采用**独立 JSON 文件 + 专用 REST**（复用 favorites-store 范式），非声明式 config-ui 通道（符合非目标）。

### 提示词优化接缝位置
- **Context**: Req 4.3 要求在派发 provider 前读开关并调接缝。
- **Sources Consulted**: `run-image-tool.ts:297-345-379`（`getState()/prefState`、`resolveMediaFields`、`runEndpoint`）。
- **Findings**: `prefState` 在 297-298 已就绪；`resolveMediaFields` 在 345、`runEndpoint` 在 379，二者之间是插入点。
- **Implications**: 读 `prefState.get<boolean>("aigc.enablePromptOptimization")`，为真则 `merged.prompt = await optimizePrompt(merged.prompt)`；`optimizePrompt` 本期为无改写透传占位。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 双载体（选定） | 关模型=持久文件+REST（装配期读）；提示词优化=会话状态+localStorage | 各按本性放置；关模型真移除、优化实时 | 两套读写路径，认知成本略高 | 精确匹配用户「混合」决策 |
| 全走会话状态 | 两开关都走 state 桥 | 单一 UI 机制 | 关模型无法从 LLM 枚举移除（枚举装配期烤死）、且 state 不持久 | 否决：违背 Req 2.1/1 |
| 全走持久文件 | 两开关都走文件+REST，装配期读 | 单一持久机制 | 提示词优化失去实时性、每次改需重载 | 否决：违背 Req 4「实时开关」 |

## Design Decisions

### Decision: 模型持久配置载体 = 独立 JSON 文件 + 专用 REST
- **Context**: 关模型需持久 + 装配期读 + 浏览器可写。
- **Alternatives**: ① settings.json per-ext KV（门控在 packages[]，内置工厂不适配）② 声明式 config-ui schema（非目标排除）③ 独立 JSON 文件 + 专用 REST。
- **Selected Approach**: `<agentDir>/aigc-tool-settings.json`，形态 `{ "disabledModels": string[] }`；`createAigcSettingsRoutes({ agentDir })` 提供 `GET/PUT /aigc/settings`；aigcExtension 装配期 `fs.readFileSync` 直读同文件。
- **Rationale**: 复用 favorites-store 成熟范式；持久且服务端权威（非 per-browser）；不碰声明式通道与协议 union。
- **Trade-offs**: 新增一个顶层 API 段（须 Next catch-all 转发器 + 重启 dev）。
- **Follow-up**: 全局 vs 项目级作用域本期取全局（`<agentDir>`）；项目级覆盖留后续。

### Decision: 关模型生效时机 = 告知 + 下次会话/重载生效（不自动触发重载）
- **Context**: Req 3 —— 装配期读取意味着当前会话不追溯。
- **Selected Approach**: 保存成功后 UI 显示「将在下一次会话/重载后生效」提示；不接 `SessionReloader` 自动重载（避免额外耦合）。
- **Rationale**: 满足 Req 3.3 的「告知」分支；范围最小。
- **Trade-offs**: 用户需自行开新会话；可作为后续增强接入一键重载。

### Decision(R2 修订 2026-07-04):设置表面从 canvas 弹层改为 /settings 配置域
- **Context**: 用户反馈「设置做错了,应做到 /settings 页面中」。原「canvas 内齿轮弹层 + 会话状态实时开关」表面判定错误。
- **Selected Approach**: 两项设置(关模型 + 提示词优化)**都**做成 /settings 页面的标准 **config 域** `aigc`——新增 protocol domain schema(`aigcConfigSchema`/`aigcFormSchema`)+ server `DOMAIN_SCHEMAS.aigc` → `/api/config/aigc` GET/PUT 自动落 `~/.pi/agent/aigc.json`(形态 `{disabledModels:string[], enablePromptOptimization:boolean}`);`disabledModels` 用自定义 widget `AigcModelTogglesField`(勾选清单 + label + provider 徽章),`enablePromptOptimization` 用默认 boolean 控件。**移除 canvas 齿轮弹层**。
- **两项均为持久配置、装配期读、下次会话生效**(提示词优化不再是实时会话开关,统一化)。aigcExtension 装配期读 aigc.json:filterRoutes 过滤(不变)+ `state.set("aigc.enablePromptOptimization", 持久值)` 使 run-image-tool 仍读会话状态(接缝不变)。
- **模型清单目录**:/settings 无会话态,故新增**纯数据端点** `GET /api/aigc/models`(server 导入 tool-kit 主入口的纯 `AIGC_MODEL_CATALOG`,零 pi SDK,不进 bundle 崩 dev);widget 自 fetch(仿 ModelSelectField 打 /api/config/models 的模块级缓存范式)。纯 catalog 由 sync 单测断言与 ROUTES 一致防漂移。
- **复用**:filterRoutes/optimize-prompt/工具注册 disabledModels/run-image-tool 接缝/provider 徽章元数据全保留。**废弃**:原 `packages/server/src/aigc-settings/*`(store+bespoke routes)、canvas `AigcSettingsPanel`、web.config promptToolbar 改动、ExtSlotRegion/pi-chat 的 baseUrl 透传(仅当时弹层 REST 需要)。
- **Rationale**: /settings 是配置的标准归宿;config 域一次声明即得持久+校验+外壳零改;与既有 auth/logging 面板一致。
- **Trade-offs**: 提示词优化失去实时性(改需下次会话);但表面统一、更符合用户预期。

### Decision: 提示词优化本期只做开关 + 无改写占位
- **Context**: Req 4.4 明确本期不做真实改写。
- **Selected Approach**: `optimizePrompt(prompt): Promise<string>` 原样返回；开关经 `aigc.enablePromptOptimization` 会话键 + localStorage 记忆。
- **Rationale**: 打通链路、留干净接缝，真实 LLM 改写留后续 spec。
- **Follow-up**: 后续 spec 在 `optimizePrompt` 内实现二次改写（选模型、失败兜底、不翻译原语）。
