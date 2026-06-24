# Research Log — aigc-generation-tools

## Discovery 范围与类型
- **特性类型**: Extension(在既有 pi-web 架构上新增工具集),integration-focused discovery。
- **范围**: Wave 1 两个工具(text_to_image / image_edit)的执行 → 落库 → 默认卡片闭环;不含面板/卡片/状态桥。
- **来源**: pi-labs aigc 引擎(移植参考)+ pi-web attachment-bridge / runner 装配(集成接缝)。

## 关键发现(已查实)

### F-1 pi-labs 引擎可移植性(参考实现)
- `lib/aigc/types.ts`:`Category` / `Variant`(= `EndpointBehavior` & 元数据) / `EndpointBehavior`(method/url/headers/buildBody/pickResult/detectError/async/requiredVars/proxy/runLocal) / `PickedResult`(image|image-set|video|audio|text|choices|raw) / `UserParamSpec` / `AsyncSpec`(statusUrl/responseUrl/isComplete/isFailed/pollMs默认2000/timeoutMs默认300000) / `EndpointInputSchema`(JSON Schema 子集) —— **零运行时依赖**,可整体移植。
- `endpoint-adapter.ts`:`runEndpoint(behavior, args, opts)` 三路径(runLocal / HTTP 同步 / HTTP 异步轮询);用 `buildBody`/`pickResult`/`detectError`;支持 `AbortSignal`、可中断 sleep。**零依赖(除 undici 代理)**,可移植。
- `var-resolver.ts`:`${VAR}` 解析;pi-labs 走 supabase `getEffectiveKey`(user→company→env)。**pi-web 改为 env-only**(纯 `process.env`)。
- `compile-category.ts`:把 Category 编译成工具;含 supabase/S3 的 `getPanelState`/`insertAssets`/`recordGeneration`/`stabilizePicked`/`uploadMedia`/`syncAssetToMaterials` —— **全是 fire-and-forget 接缝,移植时去除**;面板状态 Wave 1 不要。
- providers(`dashscope`/`openrouter`/`newapi`)声明式 `buildBody`/`pickResult` 完全解耦,可复用。
- text_to_image:`inputSchema{prompt, negative_prompt, image_urls?}`,`required:["prompt"]`;variants 含 DashScope async(`x-dashscope-async`,task_id 轮询)与 sync、OpenRouter(chat/completions + modalities:["image","text"] + inline data URI)、NewAPI;`defaultVariant:"wanx-turbo"`。
- image_edit:`inputSchema{instruction, image_url, mask_url?, reference_image_urls?}`,`required:["instruction","image_url"]`;DashScope mask-aware(content[] 顺序:主图→mask→参考→指令)、OpenRouter/NewAPI 无 mask(`paramOverrides.mask_url.hidden`)。

### F-2 pi-web attachment-bridge 接缝(集成点)
- 作者面契约 `AttachmentToolContext`(`@blksails/agent-kit`):`available` / `resolve(id)→AttachmentToolHandle` / `putOutput({bytes,name,mimeType})→ToolOutputRef{attachmentId,displayUrl,name,mimeType}`。
- `AttachmentToolHandle`:`meta`(Attachment) / `bytes()` / `localPath()` / `url()`。
- **ctx 注入 = globalThis seam**:`attachment-wiring.ts` 在 runner 装配时 `createAttachmentToolContext(store,sessionId)` 挂到 `globalThis["__piWebAttachmentToolContext__"]`(jiti 装载期闭包不可达,故用 seam);env 缺失 → store=undefined → `available:false` 优雅降级。
- 工具作者侧读取范式(见 `examples/attachment-tool-agent/tools/edit-image-tool.ts`):`getAttachmentToolContext()` 从 seam 读,缺失返回 `UNAVAILABLE_CTX`(available:false)。
- 横切闸门已就位:`beforeToolCall` 属主校验、`afterToolCall` 自动剥离内联 base64 为文本引用 —— **生成工具回的 inline image 会被自动剥离**,无需工具自理。

### F-3 装配与打包边界
- `option-mapper.ts buildRuntimeFactory` → `mapSessionFields` 把 `def.customTools` 透传给 `createAgentSessionFromServices`。agent 作者 `defineAgent({ customTools: [...] })` 即启用。
- **打包边界(硬约束)**:含 pi SDK / pi-ai / undici **值导入**的模块**不得**经被 Next 服务端 barrel `export *` 的路径重导出,否则把 SDK 拉进 Next bundle、破坏 webpack externals。`agent index.ts` 经 jiti 在子进程运行,可值导入 SDK,不经 Next bundle。

## Synthesis 决策

### D-1 引擎策略(spike-first 的落地结论)
**采纳「移植 pi-labs 声明式引擎的精简版」**,而非 pi-web 原生手写。理由:core(types/endpoint-adapter)零依赖且已验证;两工具多 variant 声明式远省于手写;契合独立包。**保留 spike**:首个实现任务为「text_to_image 单 category + 最小引擎 + 1 个 provider 跑通」作为引擎策略确认点;若暴露阻塞再回退手写。

### D-2 包与入口分层(守打包边界)
`@blksails/tool-kit` 双入口:
- 主入口 `@blksails/tool-kit`:引擎**类型** + AIGC **category 声明**(纯数据/纯函数,**禁止顶层 import** pi SDK / undici);前端安全、可序列化元数据归此。
- 子入口 `@blksails/tool-kit/runtime`:`compileCategory`(`defineTool` 包装)+ `runEndpoint`(undici 代理)+ env var-resolver + 落库适配;**node-only**,由 agent index.ts / runner 装配导入。

### D-3 落库接缝(替换 pi-labs S3 stabilize)
生成产物(provider 远程 URL)→ **fetch 字节 → `ctx.putOutput`** → `att_<id>` + displayUrl。这是 pi-web 版 stabilize。输入侧(image_edit):`att_id` → `ctx.resolve().bytes()` → **data URI** 喂 provider(不用 `handle.url()`,因 dev 下 displayUrl 为 localhost、provider 服务器不可达)。

### D-4 密钥与降级
provider 密钥经 `process.env`(var-resolver env-only);`requiredVars` 缺失 → 工具 execute 早返回「能力不可用/缺配置」结构化 details,不崩溃。attachment 能力经 seam `available` 同样降级。

### D-5 seam key 常量去重
`@blksails/tool-kit` 不依赖 `@blksails/server`;seam key `"__piWebAttachmentToolContext__"` 在 tool-kit 内自声明同值常量(与 server / 示例工具同一约定),仅 **type-only** 依赖 `@blksails/agent-kit` 的 `AttachmentToolContext`。

## 风险
- **R-1 provider 可达性**: e2e 需真实 provider 密钥(DASHSCOPE_API_KEY 等);CI/裸 dev 无密钥 → 降级路径可测,真实生成路径需 stub 或本地密钥。缓解:单测用 mock fetch 覆盖 runEndpoint;e2e 用一个最廉价 sync variant + 真实密钥(本地),或 stub provider。
- **R-2 async 轮询 e2e 时长**: 文生图 async 可能数十秒。缓解:Wave 1 e2e 优先选 sync variant(qwen-image 类),async 路径用单测覆盖轮询逻辑。
- **R-3 inline data URI 体积**: image_edit 把输入图转 data URI 喂 provider,大图占内存/带宽。缓解:Wave 1 接受;后续可改 provider 直拉签名 URL(需公网可达环境)。
- **R-4 默认 variant 密钥**: pi-labs 默认 `wanx-turbo`(DashScope)。pi-web 默认 variant 选择应保证「最易获得密钥」的 provider,文档化所需 env。
