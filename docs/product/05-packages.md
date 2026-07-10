# 05 · 分层包

pi-web 由 **11 个**可独立发布的 `@blksails/*` npm 包组成，依赖方向单向收敛：真正的零依赖叶根是 `@blksails/pi-web-logger`（`deps: {}`），协议契约包 `@blksails/pi-web-protocol` 向它单方向依赖；后端（server）与前端（react/ui）之间不存在反向引用。

> **命名约定**：除 logger 外，发布名一律带 `pi-web` 中缀（如 `@blksails/pi-web-protocol`）。唯一的目录名/发布名错位是 `packages/web-kit/`，其发布名为 **`@blksails/pi-web-kit`**（无 `web`）——见 `packages/web-kit/package.json:2`。本章正文引用发布名，路径引用目录名。

---

## 依赖关系总览

```
@blksails/pi-web-logger      (真正的零依赖叶根,deps:{})
    ▲
    ├── @blksails/pi-web-protocol       (契约根 → logger + zod)
    │       ├── @blksails/pi-web-server        (Node only)
    │       ├── @blksails/pi-web-agent-kit     (agent 作者侧)
    │       │       └── @blksails/pi-web-tool-kit    (声明层 + ./runtime 执行层)
    │       └── @blksails/pi-web-kit           (webext 作者侧 SDK)
    │               └── @blksails/pi-web-react       (headless hooks)
    │
@blksails/pi-web-primitives  (零 @blksails 依赖,shadcn 薄封装底座)
@blksails/pi-web-canvas-kit  (零 @blksails 依赖,Canvas L2 内核)
    │
    └── @blksails/pi-web-canvas-ui      (canvas-kit + web-kit + primitives + react + tool-kit)
            └── @blksails/pi-web-ui          (聚合 8 个 @blksails 包的组件库)
```

各包核心属性如下（均 `version: 0.1.0`，仓库内经 pnpm `workspace:*` 互相消费）：

| 包名 | 目录 | 运行环境 | 职责一句话 |
|---|---|---|---|
| `@blksails/pi-web-logger` | `packages/logger/` | 同构 | 零依赖同构结构化日志库（全依赖树叶根） |
| `@blksails/pi-web-protocol` | `packages/protocol/` | 同构 | 全项目契约根：RPC/SSE/DTO/config/web-ext schema |
| `@blksails/pi-web-server` | `packages/server/` | Node ≥22.19 | 后端引擎：会话/RPC/HTTP/附件/扩展 |
| `@blksails/pi-web-react` | `packages/react/` | 浏览器(SSR 安全) | headless transport + client + hooks |
| `@blksails/pi-web-ui` | `packages/ui/` | 浏览器(SSR 安全) | AI Elements 有样式组件库 + i18n + 配置 UI |
| `@blksails/pi-web-agent-kit` | `packages/agent-kit/` | Node(可选) | `defineAgent()` 及 agent 类型 |
| `@blksails/pi-web-tool-kit` | `packages/tool-kit/` | 主入口同构 / `./runtime` Node only | AIGC/视觉工具执行层、surface、state seam |
| `@blksails/pi-web-kit` | `packages/web-kit/` | 浏览器/构建时 | `defineWebExtension()` + `pi-web build` CLI + SurfaceOp canonical |
| `@blksails/pi-web-primitives` | `packages/primitives/` | 浏览器 | 6 个 shadcn 薄封装 + `cn` |
| `@blksails/pi-web-canvas-kit` | `packages/canvas-kit/` | 浏览器 | Canvas L2 内核（三件套 + 8 内置工具 + kernel 门面） |
| `@blksails/pi-web-canvas-ui` | `packages/canvas-ui/` | 浏览器 | Canvas 领域组件（工作台/画廊/生成动作/vision） |

> **发布形态说明**：以上 11 个包均面向公开发布（`private:false` 或未设 `private`，多数带 `publishConfig.access:public`），但**尚未发布到 npm**，仓库内部一律经 `workspace:*` 消费。发布所需 `publishConfig`（`dist` 产物 + `types`/`import` 映射）目前仅 `@blksails/pi-web-logger` 完整配置（`main`/`types`/`exports` 均指向 `./dist/*`）；其余包（含 `@blksails/pi-web-protocol`）多数仅声明了 `publishConfig.access:public`，发布前仍需补齐 `dist` 映射。

---

## 各包详解

### @blksails/pi-web-logger

**职责**：同构（浏览器/Node）结构化日志库，是整棵依赖树唯一 `deps: {}` 的**零运行时依赖叶根**，被 protocol/server/react/agent-kit/tool-kit/web-kit/ui 共同消费。无任何静态 Node-only import，可安全进浏览器 bundle。

**依赖**：无。**exports**：`{ ".": "./src/index.ts" }`。

**主要导出**（`packages/logger/src/index.ts`）：`createLogger`、`configureLogger`/`getRuntimeConfig`/`initConfigFromEnv`、`isLevelEnabled`/`isNamespaceEnabled`、Node sink（`nodeSink`/`serializeLogLine`/`LOG_SENTINEL`）、文件 sink（`createFileSink`）、浏览器 bus（`browserSink`/`subscribeBrowserLogs`/`getBrowserLogs`）、`getDefaultSink`。运行时行为详见 [21 · 日志系统](21-logging.md)。

---

### @blksails/pi-web-protocol

**职责**：全项目契约根。定义 RPC 类型/Schema、SSE 帧、UIMessage data-part、REST DTO、附件描述符、配置表单 IR（`config/`）、agent-web-extension 控制层契约（`web-ext/`）、agent 声明式 routes 三帧（`agent-routes/`）。

**依赖**：`@blksails/pi-web-logger` + `zod`（`packages/protocol/package.json`）。同构，可安全进浏览器 bundle。**exports**：`{ ".": "./src/index.ts" }`。

**导出面**（`packages/protocol/src/index.ts`）：

| 子模块 | 主要导出 |
|---|---|
| `version` | `protocolVersion`, `ProtocolVersion` |
| `rpc/*` | model/command/response/event/extension-ui/session-state |
| `transport/*` | `SpawnSpec`, `UiSpec`, `DataPart`, `UiMessageChunk`, `session-status`, `session-state`, `sse-frame`, REST DTO, completion DTO, `slash-completion` |
| `agent-routes/` | 声明式 route DTO + 三帧契约（`AgentRoutesFrame` 等） |
| `attachment/` | `AttachmentDto` 及上传响应 DTO |
| `config/` | 配置表单 IR + adapter + 配置域契约 |
| `web-ext/` | WebExtension manifest / ui-rpc / descriptor / artifact / surface 契约 |

> 协议变更遵循语义化版本；SSE 帧携带 `protocolVersion` 供运行时兼容性检测。`web-ext/surface.ts` 的 `surfaceStateKey`/`SurfaceCommandPayload`/`SurfaceCommandResult` 是 Surface 通信平面的契约，详见 [04 · Surface 权威表面栈](04-surface-stack.md)。

---

### @blksails/pi-web-server

**职责**：后端引擎。包含 agent 源解析、runner 启动路径解析、RPC 通道、会话注册与翻译、HTTP 路由处理器抽象、附件存储（L0/L1）、附件 tool-bridge（L2）、补全接口、扩展管理等模块。

**依赖**：`@blksails/pi-web-logger`、`@blksails/pi-web-protocol`、`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`（均 ≥0.80.3）、`jiti`、`pg`、`zod`。Node ≥22.19 only。

**exports（4 个子路径）**：

```json
{
  ".":                     "./src/index.ts",
  "./trust":               "./src/trust/index.ts",
  "./model-options":       "./src/config/model-options.ts",
  "./vision-model-options":"./src/vision-settings/vision-model-options.ts"
}
```

主入口（`.`）聚合会话/RPC/HTTP/附件等模块。核心是框架无关的 `createPiWebHandler`（Web Fetch API：接标准 `Request`、返回 `Response`，含 SSE `ReadableStream` body），由 Hono 宿主 `server/index.ts` 的一条 `app.all('/api/*')` 转发承载——详见 [03 · 系统架构](03-architecture.md) 与 [24 · HTTP/SSE API 参考](24-http-api-reference.md)。

- `./trust`：信任策略 `FsProjectTrustStore`，读写 `<agentDir>/trust.json`，零 pi SDK 值依赖。
- `./model-options`：文本模型枚举工厂（[07 · Provider 与模型](07-providers-and-models.md)）。
- `./vision-model-options`：`GET /vision/models` 用的视觉模型枚举工厂（[11 · AIGC 与视觉工具](11-aigc-and-vision-tools.md)）。

> **barrel 纪律**（`packages/server/src/index.ts:3-8`）：`./runner` 子路径**不**从主入口 barrel 重导出——runner 加载时静态导入整套 pi SDK，若经 barrel `export *` 会把 SDK 打进被 bundle 的产物、破坏 esbuild external 边界。runner 仅由 `runner-bootstrap.mjs` 在子进程内经 `jiti` 加载 `./runner/runner.ts`；App/Handler 从不直接 import runner。

---

### @blksails/pi-web-react

**职责**：headless 客户端层。提供 transport、REST client、SSE 连接管理、React hooks，无样式/无 JSX 组件。

**依赖**：`@blksails/pi-web-logger`、`@blksails/pi-web-protocol`、`@blksails/pi-web-kit`；peer：`react`、`ai`（AI SDK v5）、`@ai-sdk/react`。**exports**：`{ ".": "./src/index.ts" }`。

**主要导出**：

| 类别 | 关键符号 |
|---|---|
| transport | `PiTransport`（AI SDK v5 `ChatTransport` 实现）, `uploadAttachment` |
| client | `createPiClient`, `PiClient`, `PiHttpError`, `PiProtocolVersionError` |
| SSE | `PiSessionConnection`, `ControlStore`, `parseSse`, `decodeUiMessageChunk` |
| provider | `PiProvider`, `usePiContext` |
| hooks | `usePiSession`, `usePiControls`, `useExtensionUI`, `useModels`, `useAttachments`, `useBranches`, `useSuggestions` |
| surface | `useSurface`, `useConversationBridge`（见 [04](04-surface-stack.md)） |
| web-ext | `verifyExtension`, `loadExtension`, `buildImportMap`, `createUiRpcBus` |
| config | 配置表单状态 + 设置面板注册表 + 域 IO |

---

### @blksails/pi-web-ui

**职责**：AI Elements 组件库（有样式）。基于 shadcn/ui + Tailwind CSS，提供 `<PiChat>`、工具部件、推理块、提示输入框、模型/思考/stats 控制面板、权限弹窗，以及 schema-driven 配置 UI（渲染器注册表 + 可搜索下拉）与自研 i18n。

**依赖**：这是全仓依赖面最宽的包——聚合 **8 个 `@blksails` 包**（canvas-kit、canvas-ui、logger、primitives、protocol、react、pi-web-kit、tool-kit）+ `@radix-ui/*`、`cmdk`、`lucide-react`、`streamdown`、`rehype-sanitize`、`clsx`、`tailwind-merge`；peer：`react`、`react-dom`、`ai`、`@ai-sdk/react`。

**exports**：

```json
{ ".": "./src/index.ts", "./styles.css": "./src/styles.css" }
```

> 消费方需同时导入 `@blksails/pi-web-ui/styles.css`（Tailwind 样式入口）。Storybook 开发：`pnpm --filter @blksails/pi-web-ui storybook`（端口 6006）。

#### 自研 i18n 机制

`@blksails/pi-web-ui` 内置一套**轻量自研的国际化运行时**（`packages/ui/src/i18n/`），刻意不引 `react-i18next`/`formatjs`：字典是纯对象、翻译是纯字符串查表，同构且零运行时依赖，随组件库整包 barrel 一同导出。

- **字典结构**：`Locale` 为 `"zh"`/`"en"`，各是一张 `Record<string, string>`（`packages/ui/src/i18n/messages.ts`）；key 用 `域.子项` 点分命名，两表按同一组 key 平行维护。
- **`t()` 契约**（`packages/ui/src/i18n/context.tsx` 的 `translate`）：**绝不抛错**；**缺失回退**顺序为「当前 locale → `zh` → 原样返回 key」；**参数替换**对 `{name}` 占位符插值，缺参保留原文，不支持 ICU 复数/日期。
- **无 Provider 默认 zh**：`useI18n()` 不强制外层 Provider——`I18nContext` 的 `defaultContext` 直接绑定 `translate("zh", …)`。挂 `I18nProvider` 后才有语言切换：客户端挂载后从 `localStorage` 的 `pi-web.locale` 键读回偏好，`setLocale` 写回持久化。
- **切换 UI 属宿主 app 层**：组件库只导出 `I18nProvider`/`useI18n`/`useLocale` 三个原语，`LocaleToggleButton` 等切换控件由集成方自行组装。

**给组件作者的用法要点**：当文案有对应**可覆盖 prop** 时，不要把 `t("…")` 写成解构参数默认值（会在 `t` 不可用时被固化、不随 locale 变化）。约定是把 prop 接收为 `undefined`（如 `xxxProp`），再在函数体内用 `??` 回退到 `t()`：

```tsx
// packages/ui/src/chat/pi-chat.tsx（约定示例）
function PiChat({ emptyTitle: emptyTitleProp /* … */ }: PiChatProps) {
  const t = useI18n();
  const emptyTitle = emptyTitleProp ?? t("chat.empty.title"); // 下沉到函数体
  // …
}
```

纯内部、无对应 prop 的文案则直接 `t("…")` 即可。

---

### @blksails/pi-web-primitives

**职责**：下沉的 shadcn 薄封装底座——`Button`/`Card`/`Input`/`Popover`/`Select`/`Textarea` 六个组件与 `cn` className 合并工具，是 ui / canvas-ui 的公共 UI 原语层。语义与迁移前 `packages/ui/src/ui/*` 逐一致；主题量一律经 design tokens（CSS 变量）表达，本包不引独立主题体系。

**依赖**：**零 `@blksails` 依赖**（`@radix-ui/react-popover`/`react-select`、`class-variance-authority`、`clsx`、`lucide-react`、`tailwind-merge`；peer `react`）。**exports**：`{ ".": "./src/index.ts" }`。

**导出**（`packages/primitives/src/index.ts`，显式清单、禁 `export *`）：`Button`/`buttonVariants`、`Card`、`Input`、`Popover`（含 `PopoverAnchor`/`PopoverContent`/`PopoverTrigger`）、`Select`（含 `SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`/`SelectGroup`）、`Textarea`、`cn`。

---

### @blksails/pi-web-canvas-kit

**职责**：Canvas 的 **L2 开发者面内核**——插件三件套契约、per-instance 注册表、8 个内置绘制工具、交互内核装配门面。`kernel/` L1 内部件（stage/pointer/history/layers/tool-runtime）**刻意不出口**，L1 可自由重构不构成破坏性变更。面向插件作者的用法见 [17 · Canvas 插件开发](17-canvas-plugins.md)。

**依赖**：**零 `@blksails` 依赖**（`lucide-react`；peer `react`）——依赖方向是 ui/canvas-ui 消费 canvas-kit，反向禁止。**exports**：`{ ".": "./src/index.ts" }`。

**导出面**（`packages/canvas-kit/src/index.ts`）：

| 类别 | 关键符号 |
|---|---|
| 动作 | `defineCanvasAction`, `resolveAction`（评分制决策器） |
| 图层 | `defineCanvasLayer`, `registerPluginBundles`（命名空间前缀 + requires 拓扑校验） |
| 工具 | `defineCanvasTool`, `createCanvasRegistry` |
| 内置工具 | `registerBuiltinTools`（arrow/draw/erase/expand/line/mask/move/text 八件，单个工具不出口） |
| 内核门面 | `createCanvasKernel`（收口 stage/history/layers/pointer/renderOverlay 装配） |
| 位图 | `bitmap-io.js`（`export *`） |

---

### @blksails/pi-web-canvas-ui

**职责**：Canvas 领域组件 canonical 家——二创工作台编辑器、画廊、六内置生成动作、vision「解读」入口。是承载 Surface 通信平面前端参考实现的包（`CanvasWorkbench` 用 `useConversationBridge`/`buildSurfaceOp`/`renderSurfaceOp`）。面向用户/集成方的完整说明见 [16 · Canvas 工作台](16-canvas-workbench.md)。

**依赖**（构成一整层依赖链）：`@blksails/pi-web-canvas-kit`、`@blksails/pi-web-kit`、`@blksails/pi-web-primitives`、`@blksails/pi-web-react`、`@blksails/pi-web-tool-kit` + `lucide-react`；peer `react`。**exports**：`{ ".": "./src/index.ts", "./styles.css": "./src/styles.css" }`。

**导出面**（`packages/canvas-ui/src/index.ts`，显式清单）：

| 类别 | 关键符号 |
|---|---|
| 工作台 | `CanvasWorkbench`, `decideGenerate`, `buildSurfaceOp`, `buildToolPrompt`, `composeInpaintBack` |
| 门控/装配 | `CanvasLauncher`, `CanvasPanel`, `isCanvasEnabled`（读 `NEXT_PUBLIC_PI_WEB_CANVAS`，默认关，见 [06](06-configuration.md)） |
| 画廊 | `CanvasGallery`（`domain="canvas"` 的 Surface 投影，见 [04](04-surface-stack.md)） |
| 生成动作 | `BUILTIN_GENERATE_ACTIONS`, `registerBuiltinGenerateActions`（outpaint/inpaint/reference/variants/reframe/edit 六动作） |
| 快捷设置 | `AigcQuickSettings`（`promptToolbar` 槽挂载） |
| provider 元数据 | `PROVIDER_META`, `displayNameOf`, `ProviderBadge` |

---

### @blksails/pi-web-agent-kit

**职责**：给自定义 agent 作者用的轻量帮助包。`defineAgent()` 是纯 identity 函数，仅提供编译期类型检查，零运行时副作用——即使不用本包，定义的 `AgentDefinition` 结构也与 runner 要求完全兼容。

**依赖**：`@blksails/pi-web-logger`、`@blksails/pi-web-protocol`；peer：`@earendil-works/pi-coding-agent`（仅类型）。**exports**：`{ ".": "./src/index.ts" }`。

**主要导出**：`defineAgent`；类型 `AgentDefinition`/`AgentContext`/`AgentModel`/`ToolDefinition`/`SystemPromptValue`/`ThinkingLevel` 等（含 `routes?`、`slashCompletions?` 两个扩展面字段）；便利 `defineMinimalAgent`/`minimalAgentPreset`、`emitUi`；附件 tool 上下文类型 `AttachmentToolContext` 等（运行期构造在 server）。作者面详细用法见 [08 · 自定义 Agent 开发](08-agent-development.md)。

---

### @blksails/pi-web-tool-kit

**职责**：通用工具套件，分两层——**主入口**（前端安全声明层）与 **`./runtime`**（Node only 执行层，凡含 pi SDK 值导入的逻辑一律落此，守 esbuild/vite external 边界）。

**依赖**：`@blksails/pi-web-agent-kit`、`@blksails/pi-web-logger`、`undici`、`zod`；peer：`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`。

**exports（6 个子路径）**：

```json
{
  ".":                    "./src/index.ts",   // 声明层,前端安全
  "./runtime":            "./src/runtime.ts", // 执行层,Node only
  "./aigc-canvas-schema": "./src/aigc/canvas/schema.ts",
  "./commands":           "./src/commands/index.ts",
  "./extension-entry":    "./src/extension-tools/entry-path.ts",
  "./auto-title-entry":   "./src/auto-title/entry-path.ts"
}
```

**主入口（声明层，`packages/tool-kit/src/index.ts`）** 仅导出前端安全的纯数据/类型：`BUILTIN_COMMANDS`（内置斜杠命令声明）、`getSessionState`/`SESSION_STATE_SEAM_KEY`（状态注入桥作者接入点，见 [04](04-surface-stack.md)）、`aigcSlashCompletions`、`AIGC_MODEL_CATALOG`。

> **注意**：旧文档写的 `export * from "./engine/types.js"` 与 `AIGC_TOOLS`/`imageGeneration`/`imageEdit` 已从主入口移除（detoolspec-unify-builtin-tools）——照抄会解析失败。

**`./runtime`（执行层，`packages/tool-kit/src/runtime.ts`）**：

| 类别 | 关键符号 |
|---|---|
| 引擎 | `runEndpoint`, `resolveVars`/`resolveVarsOptional`/`checkRequiredVars`, `proxyFetch`, `normalizeImageDataUri` |
| 附件 | `getAttachmentToolContext`/`SEAM_KEY`, `persistPicked`, `resolveInputToDataUri` |
| Surface | `createSurface`, `getSurfaceRegistry`, `SURFACE_REGISTRY_SEAM_KEY`（[04](04-surface-stack.md)） |
| AIGC extension | `aigcExtension`, `registerImageGeneration`, `registerImageEdit`（[11](11-aigc-and-vision-tools.md)） |
| Canvas surface | `canvasSurfaceExtension`, `createCanvasCommands`, `rebuildGalleryFromAttachments`, `CANVAS_DOMAIN` |
| vision | `visionExtension`, `createVisionRunner`, `listVisionModels`, `VISION_MODEL_ENV` |
| image-tool 编排 | `runImageTool`, `buildModelsDescription`, `optionalModelEnum` |

> 旧文档 runtime 表列的 `compileTool`/`buildAigcTools` 均已删除，不存在。

---

### @blksails/pi-web-kit（目录 `packages/web-kit/`）

**职责**：agent source `.pi/web` 的作者侧 SDK（webext 控制层），与 agent-kit 对称——`defineAgent()` ↔ `defineWebExtension()`。作者写 `.pi/web` 入口默认导出 `WebExtension`；随包发布的 `pi-web build` CLI 预构建为 ESM bundle + manifest。本包也是 `renderSurfaceOp`/`SurfaceOp` 的 canonical 家（surface-runtime-facade，见 [04](04-surface-stack.md)）。

**依赖**：`@blksails/pi-web-logger`、`@blksails/pi-web-protocol`、`esbuild`；peer：`react`、`ai`。

**exports**：`{ ".": "./src/index.ts", "./build": "./build/index.ts" }`。**bin**：`pi-web` → `./build/cli.ts`。

**主要导出**：`defineWebExtension`；类型 `WebExtension`/`SlotContribution`/`ContributionPoints`/`RendererContributions`/`UiRpcClient`/`WebExtHostContext`；`SLOTS` 插槽常量表（`packages/web-kit/src/slots.ts`）；`renderSurfaceOp`/`SurfaceOp`/`SubmitOpResult`；protocol re-export（`SlotKey`/`WebExtConfig`/`ArtifactDeclaration`/`UiRpcPoint` 等）。用法与可用插槽全集见 [12 · Web UI 扩展](12-web-ui-extension.md)，可运行范例见 `examples/webext-slots-agent/.pi/web/web.config.tsx`。

> **bin 撞名提示**：本包 bin `pi-web`（webext 构建 CLI）与仓库根 bin `pi-web`（`bin/pi-web.mjs`，自包含实例启动器，见 [18 · CLI](18-cli.md)）同名但语义不同；全局装两者可能撞名。

---

## 一个可运行的最小消费范例

自定义 agent 的最小消费面只用到 `@blksails/pi-web-agent-kit`。仓库内 `examples/hello-agent/index.ts` 是完整可跑的范例：

```typescript
// examples/hello-agent/index.ts（节选）
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({ text: Type.String({ description: "Text to echo back." }) }),
  async execute(_toolCallId, params) {
    return { content: [{ type: "text", text: params.text }], details: undefined };
  },
});

export default defineAgent({
  // model 省略 → 继承 ~/.pi/agent/settings.json 的默认 provider/model,开箱即用。
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  noTools: "builtin",
});
```

用仓库内的开发服务器加载它：

```bash
# 1) 装依赖(pnpm workspace 会把 11 个包按 workspace:* 链接好)
pnpm install

# 2) 启动 dev（dev-all.mjs 并发起 API :3000 + Vite :5173）
pnpm dev

# 3) 浏览器打开 http://localhost:5173,在选源页填 examples/hello-agent
#    发一条消息,应看到流式回复;输入让它 echo 的内容会触发 echo 工具
```

**预期结果**：Vite 前端在 5173 渲染聊天 UI，`/api` 请求由 Vite 代理到 3000 的 Hono 宿主；每个会话 spawn 一个独立子进程加载该 agent。若只想验证包链接是否就位，可跑 `pnpm -r list --depth -1` 列出全部 11 个 `@blksails/*` 工作区包。

---

## 依赖方向速查

```
@blksails/pi-web-logger      ←──────── 所有 @blksails 包（真正的零依赖叶根）
@blksails/pi-web-protocol    ──依赖──→ logger + zod
@blksails/pi-web-primitives  ──依赖──→ (零 @blksails;radix/clsx/cva/lucide)
@blksails/pi-web-canvas-kit  ──依赖──→ (零 @blksails;lucide-react)
@blksails/pi-web-server      ──依赖──→ logger + protocol
@blksails/pi-web-agent-kit   ──依赖──→ logger + protocol
@blksails/pi-web-tool-kit    ──依赖──→ agent-kit + logger
@blksails/pi-web-kit         ──依赖──→ logger + protocol
@blksails/pi-web-react       ──依赖──→ logger + protocol + pi-web-kit
@blksails/pi-web-canvas-ui   ──依赖──→ canvas-kit + pi-web-kit + primitives + react + tool-kit
@blksails/pi-web-ui          ──依赖──→ 8 个 @blksails 包(canvas-kit/canvas-ui/logger/
                                        primitives/protocol/react/pi-web-kit/tool-kit)

禁止：server ↔ react/ui（后端与前端不互相依赖）
禁止：logger / protocol 反向依赖任何 @blksails 包
禁止：ui/canvas-ui → canvas-kit/primitives 反向（内核/原语不得依赖上层）
```

---

## 规划中的包

| 包名 | 规划 spec | 说明 |
|---|---|---|
| `@blksails/embed` | `embed-integrations` | Web Component `<pi-web-chat>` + iframe widget，支持非 React 项目嵌入（**规划中/未实现**，`packages/` 下尚无此目录） |

---

## 相关链接

- [03 · 系统架构](03-architecture.md) — 各包在运行时的进程边界与 Hono/esbuild 拓扑
- [04 · Surface 权威表面栈](04-surface-stack.md) — `createSurface`/`useSurface`/`renderSurfaceOp`/状态注入桥
- [06 · 配置参考](06-configuration.md) — env 与 `NEXT_PUBLIC_PI_WEB_CANVAS` 门控
- [08 · 自定义 Agent 开发](08-agent-development.md) — `@blksails/pi-web-agent-kit` 与 `defineAgent()`
- [11 · AIGC 与视觉工具](11-aigc-and-vision-tools.md) — `@blksails/pi-web-tool-kit/runtime` 的 AIGC/vision extension
- [12 · Web UI 扩展](12-web-ui-extension.md) — `@blksails/pi-web-kit` 与 `defineWebExtension()`
- [16 · Canvas 工作台](16-canvas-workbench.md) / [17 · Canvas 插件开发](17-canvas-plugins.md) — canvas-ui / canvas-kit 的面向用户与插件作者视角
- [21 · 日志系统](21-logging.md) — `@blksails/pi-web-logger` 的运行时行为
- [24 · HTTP/SSE API 参考](24-http-api-reference.md) — `@blksails/pi-web-server` HTTP 模块的路由约定
