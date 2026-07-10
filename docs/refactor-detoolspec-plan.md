# 重构计划:去 ToolSpec · 统一内置工具为 pi extension

> 分支 `refactor/unify-builtin-tools`
> 方向:删声明式 ToolSpec 引擎,AIGC 改写为 `pi.registerTool`(in-process `ExtensionFactory`),
> 附件 seam 降为共享 util。本文件为 kiro spec 的输入参考(权威以 .kiro/specs/ 下产物为准)。

## 0. 动机与一个被澄清的前提

目标:内置工具不再有"声明式工具框架"(ToolSpec + `compileTool`)这层抽象;所有内置能力统一为
**普通 pi extension**(`pi.registerTool` / `registerCommand`),与 `extension-manager` / `auto-title` 形态一致。

**被澄清的前提**:`compileTool` 底层用的是 `defineTool`(`@earendil-works/pi-coding-agent`),
其产出的 `ToolDefinition` 走 `customTools`,而 `execute` 第 5 参就是 `ExtensionContext`(含 `ctx.ui`)
(`compile-tool.ts:517-523`)。即:**交互补全在 `customTools` 形态下本就能拿到 `ctx.ui`,转 extension
不是技术必需**。本次转 extension 是为了"统一形态"这一既定目标,而非能力缺口。

关键可行性:`AgentDefinition.extensions?: Array<string | ExtensionFactory>`(`agent-kit/src/types.ts:79`)
支持**进程内 factory 函数**,且 runner 已透传(`option-mapper.ts:121-123`)。因此 AIGC 可写成
in-process `ExtensionFactory`,经 `extensions: [aigcExtension]` 挂载——无需磁盘路径、无需 `pi install`、
无需平台强制注入。

## 1. 去留判定(engine/)

| 文件 | 判定 | 依据 |
|---|---|---|
| `engine/compile-tool.ts` | **删** | ToolSpec → ToolDefinition 通用编译器;其 `runExecute` 编排抽取为 helper(见 §3) |
| `engine/types.ts` | **拆分** | 删声明层 `ToolSpec`/`ModelRoute`/`InteractionSpec`/`EndpointInputSchema`/`JsonSchemaProp`/`MediaKind`/`Pricing`;保留执行层 `EndpointBehavior`/`AsyncSpec`/`PickedResult`/`RunStage`/`ToolProgress`/`BuildBodyContext`/`LocalExecuteHook` → 移入 `engine/endpoint-types.ts` |
| `engine/endpoint-adapter.ts` | **留** | `runEndpoint` 通用 HTTP 执行层 |
| `engine/var-resolver.ts` | **留** | `${VAR}` 解析 + `checkRequiredVars` |
| `engine/normalize-image.ts` | **留** | iPhone 多图 JPEG 规范化 |
| `engine/proxy-fetch.ts` | **留** | 代理 fetch |

## 2. provider 工厂(aigc/providers/)

`createDashscopeSyncT2I` / `createDashscopeImageEdit` / `createDashscopeAsyncT2I` / `createNewApiImage` /
`createNewApiImageEdit` / `createOpenRouterImage` / `createOpenRouterImageEdit` 的核心逻辑
(`buildBody` / `pickResult` / `detectError` / `async` 轮询 + 端点常量 + `IMAGE_EDIT_MAX_IMAGES` +
`DASHSCOPE_MODELS`)**全部保留**。仅去掉 `ModelRoute` 的路由元数据包装(`model`/`label` 作为 LLM enum
路由键);工厂改返回 `EndpointBehavior`(+ 轻量 id/label),路由改由手写 `parameters.model` + helper
的 routes 表表达。

## 3. 编排 helper(决策 A1 — 已采纳)

从 `compile-tool.ts` 的 `runExecute`(`:372-495`)抽取**运行时编排 helper** `runImageTool(opts)`,
封装:必选项补全 → model 路由 → `checkRequiredVars` → attachment ctx 检查 → 媒体字段解析 →
`runEndpoint` → 乐观预览 `onUpdate` → `persistPicked` → 结果组装。它**不是** ToolSpec(无声明式框架),
只是运行时函数。两工具各写 `parameters`(手写 `Type.Object`)+ `routes` + `defaultModel` +
`requiredParams` + `mediaFields` 后调它。

```ts
runImageTool(params, ext, {
  routes: Record<string, EndpointBehavior>,
  defaultModel: string,
  requiredParams: Array<{ param; via; title; placeholder?; options?; fallback? }>,
  mediaFields: string[],          // ["image","mask","reference_images"] — 取代 mediaKind 遍历
  signal, onUpdate,
}): Promise<AgentToolResult>
```

## 4. AIGC 改写为 extension

- `aigc/tools/image-generation.ts` / `image-edit.ts`:导出注册函数 `registerImageGeneration(pi)` /
  `registerImageEdit(pi)`,内部 `pi.registerTool({ name, label, description, parameters: Type.Object(手写),
  execute })`,`execute` 调 `runImageTool`。`Type` 来自 `@earendil-works/pi-ai`;execute 签名对齐
  `extension-manager.ts:199`。
- 新建 `aigc/extension.ts`:`aigcExtension: ExtensionFactory = (pi) => { registerImageGeneration(pi);
  registerImageEdit(pi); }`。
- 媒体处理:execute 内显式对 `mediaFields` 调 `resolveInputToDataUri` + `normalizeImageDataUri`。
- 附件:`getAttachmentToolContext()` + `persistPicked`,与现状一致。

## 5. 装配与导出面

- `examples/aigc-agent/index.ts`:`customTools: buildAigcTools()` → `extensions: [aigcExtension]`;
  保留 `noTools: "builtin"`(extension tools 不受影响,`agent-kit/src/types.ts:70`)。
- `src/runtime.ts`:删 `compileTool`/`CompileDeps`/`ToolExecuteDetails`/`buildAigcTools`/`AIGC_TOOLS`;
  新增 `aigcExtension`;保留 `runEndpoint`/`persistPicked`/`resolveInputToDataUri`/
  `getAttachmentToolContext`/`SEAM_KEY`/`resolveVars*`/`checkRequiredVars`/`proxyFetch`/`normalizeImageDataUri`。
- `src/index.ts`(主入口,前端安全):删 `export * from engine/types`/`AIGC_TOOLS`/`imageGeneration`/
  `imageEdit`;保留 `BUILTIN_COMMANDS`。
- `package.json` exports 不变。

## 6. 零外溢保证(必须验证)

- 工具 name(`image_generation`/`image_edit`)、`content` 形态(markdown 图 + `details.assets`)不变
  → 前端 aigc renderer / webext **不改**。
- attachment-bridge 闸门(`attachment-wiring.ts`)按 args 的 `att_` 引用工作,与工具来源无关 → 不受影响。
- `onUpdate` 乐观预览:`defineTool` 与 `registerTool` 的 execute 签名一致 → 行为应一致。

## 7. 测试

| 测试 | 处置 |
|---|---|
| `engine/compile-tool*.test.ts`(3) | 删 |
| `engine/{endpoint-adapter,var-resolver,normalize-image,proxy-fetch,async-submit-error}.test.ts` | 留 |
| `attachment/{persist,seam}.test.ts` | 留 |
| `aigc/{image-generation.integration,image-edit,image-edit-ownership,agent-assembly}.test.ts` | 改写为测 extension 注册 + execute(mock provider + mock ctx + mock `ext.ui`) |
| `aigc/providers/{newapi,openrouter}.test.ts` | 改写为工厂单元 |
| 新增 | `runImageTool` helper 单元;`aigcExtension` 注册 + execute 集成 |
| vitest alias | 同步 tool-kit 子路径 alias(历史坑) |

## 8. e2e 与文档

- e2e:`examples/aigc-agent` 经 `extensions: [aigcExtension]` 加载后,node/browser e2e 仍能调
  `image_generation`(stub provider)。**铁律:每 spec 需 e2e + fresh 证据**。
- 文档:`docs/product/11-aigc-and-vision-tools.md` 接入改 `extensions`;删/改"声明式引擎结构"章节;`09` 章补边界说明。

## 9. 实施阶段

P1 引擎瘦身 · P2 provider 去包装 · P3 编排 helper · P4 AIGC extension · P5 装配/导出 ·
P6 测试 · P7 e2e+文档 · P8 验证(typecheck / tool-kit 测试 / test:app / e2e fresh 证据)。

## 10. 风险

- in-process `ExtensionFactory` 的 tool 注册时机须在工具表构建前——验证。
- `pi.registerTool` 的 execute `ctx` 与 `defineTool` 一致(AIGC 依赖 `ctx.ui.select/input` + `onUpdate`)——回归验证。
- `noTools:"builtin"` 不影响 extension 注册的 tool(`types.ts:70`)——验证。
