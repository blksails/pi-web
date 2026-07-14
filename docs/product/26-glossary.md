# 26 · 术语表

pi-web 全链路术语速查——每条给出 1–3 句定义并交叉链接到详述章节。技术名词与代码标识符保留原文。

---

## A

### AAS（Agent-Authoritative Surface · 权威表面 · pre-spec 设计词汇）

> **注意：AAS 是设计词汇，不是已交付的 SDK/API。** main 上仅 `packages/ui/src/index.ts:186` 一处注释提及「AAS 实例 UI」，专门的设计稿 `docs/agent-authoritative-surface-design.md` 明标为 pre-spec 草案。它描述一种「agent 进程持有 domain 权威状态、前端只做瘦投影」的通信心智；**真正落地并有代码背书的对应实现叫 Surface 栈**（见 **Surface**），且其单一权威规范是 `docs/surface-app-runtime-contract-v1.md`（该契约已声明收编 AAS 草案）。读到 AAS 时请理解为「Surface 栈背后的设计词汇」，勿当成独立产品面。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### Agent Source（agent 源）

agent 载入的入口描述，可以是**本地目录**（绝对路径）或 **git 源**（解析拉取后落为本地目录）。源解析器完成三件事：解析目录或 git → 本地工作目录；探测入口（`index.[js|ts]`）；结合信任策略生成 `SpawnSpec`（子进程怎么起）。

详见 [02 · 核心概念](./02-core-concepts.md)、[08 · Agent 开发](./08-agent-development.md)。

### AgentDefinition

自定义 agent 的**静态声明结构**，由 agent 的 `index.ts` default export 提供（也可以是返回该结构的工厂函数）。关键字段包括 `model`、`systemPrompt`、`customTools`、`noTools`、`extensions`、`allowExtensions`、`skills`、`scopedModels`、`routes`、`slashCompletions` 等。runner bootstrap 载入后经 `loadAgentDefinition()`（`packages/server/src/runner/agent-loader.ts`）归一化为统一运行时工厂。

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
export default defineAgent({ systemPrompt: "…", noTools: "builtin" });
```

详见 [08 · Agent 开发](./08-agent-development.md)。

### agentHostProvider（规划中 / 未实现）

**规划中的接口隔离点**，意图抽象"如何 spawn agent 子进程"。当前代码中**尚未落地**该工厂——传输接缝由已实现的 `PiRpcChannel`（local 实现 `PiRpcProcess`，本机 `child_process` spawn）承担。它是为 docker / e2b / ssh / device 等远程 host 预留的工厂层。

详见 [03 · 系统架构](./03-architecture.md)、[25 · 路线图](./25-roadmap.md)。

### att\_\<id\>（附件公开 id）

`AttachmentStore.put()` 铸造的全局唯一附件标识，格式为 `att_` + 16 字节 `randomBytes` base64url 编码（`mintAttachmentId()` — `packages/server/src/attachment/id.ts`）。历史记录与 LLM context 中**只存 `att_<id>` 引用**，base64 仅在两个具名出口短暂物化（喂 LLM vision、工具读取）。

详见 [09 · 附件系统](./09-attachment-system.md)。

### Artifact / Artifact iframe（Tier 4）

WebExtension 可在 `.pi/web/dist/` 声明一个独立 HTML 表面（`artifact.entry`），宿主以 `<iframe sandbox="allow-scripts">` 加载——不含 `allow-same-origin`，iframe 获得不透明 origin，无法访问宿主 cookie/DOM/凭证。双向通信经 `postMessage`，消息类型由 `@blksails/pi-web-protocol` 的 `ArtifactMessage` 约束。挂载门控：**必须设置 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`**（该 env 现由服务端在 `GET /api/bootstrap` 运行时读取后下发，见 **bootstrap 下发**），否则 `ArtifactSurface` 不渲染。

> 与下面的 **Surface（权威表面）** 是**两个不同概念**：这里的 artifactSurface 是 Tier 4 的 iframe 隔离表面（挂载机制）；Surface 栈是与五层挂载机制**正交**的领域权威通信约定。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## B

### BlobStore（对象存储端口）

附件系统 **L0 层**的可插拔存储接口（`packages/server/src/attachment/blob-store.ts`），定义 put / get / stream / delete / exists 五个能力 + `BlobNotFoundError`。当前实现为 `LocalFsBlobBackend`（落盘 `$PI_WEB_ATTACHMENT_DIR`），接口为 S3 风格，便于未来切换对象存储后端。

详见 [09 · 附件系统](./09-attachment-system.md)。

### bootstrap runner（bootstrap 启动器）

自定义 agent（custom 模式）的子进程入口脚本：`packages/server/runner-bootstrap.mjs`（纯 ESM，无需 jiti 启动自身）。它创建 jiti 实例，加载 `src/runner/runner.ts`，经 `parseRunnerArgs` 解析参数、`loadAgentDefinition` 归一化 agent、`createAgentSessionRuntime` 构建会话，最终进入 `runRpcMode` 永不返回的 RPC 循环。

详见 [08 · Agent 开发](./08-agent-development.md)。

### bootstrap 下发（GET /api/bootstrap）

SPA 前端的**运行时配置端点**（`server/bootstrap.ts`，挂载于 `server/index.ts:67`）。Vite+SPA 化后，`NEXT_PUBLIC_PI_WEB_*` 系列门控（sessions/source-picker/launcher-rail/canvas 等）**不再是构建期内联常量**——服务端在每次请求 `/api/bootstrap` 时读 `process.env`，把结果作为 JSON 下发，前端经 `setRuntimeFeatures()`（`lib/app/runtime-features.ts`）注入。语义反转的直接后果：**`pi-web --canvas` 这类运行时开关现在才真正生效**，改 env 后只需重启服务端，无需重新构建。

详见 [14 · 会话列表](./14-sessions-list.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

---

## C

### canvas-kit（@blksails/pi-web-canvas-kit）

独立发布的 **Canvas L2 开发者面内核**包，公开面导出四大契约：动作 `defineCanvasAction`/`resolveAction`、图层 `defineCanvasLayer`/`registerPluginBundles`、工具 `defineCanvasTool`/`createCanvasRegistry`、交互内核装配门面 `createCanvasKernel`；`kernel/` L1 内部件（stage/pointer/history/layers/tool-runtime）刻意不出口。内置 8 个绘制工具（arrow/draw/erase/expand/line/mask/move/text）。零 `@blksails` 依赖。

详见 [05 · 分层包](./05-packages.md)、[17 · Canvas 插件开发](./17-canvas-plugins.md)。

### canvas-ui（@blksails/pi-web-canvas-ui）

独立发布的 **Canvas 领域组件 canonical 家**，承载 `CanvasWorkbench` 二创画布编辑器、6 个内置生成动作（outpaint/inpaint/reference/variants/reframe/edit）、`CanvasGallery` 画廊、vision「解读」按钮。依赖 canvas-kit + web-kit + primitives + react + tool-kit，构成一整层 canvas 依赖链。

详见 [05 · 分层包](./05-packages.md)、[16 · Canvas 工作台](./16-canvas-workbench.md)。

### Canvas 工作台（CanvasWorkbench）

canvas-ui 提供的二创画布编辑器组件（`packages/canvas-ui/src/canvas-workbench.tsx`）：舞台缩放/平移 + 工具轨 + overlay 掩码/标注 + 提示词栏 + 版本条。面板显示**由 agent source 声明驱动**——source 在 `.pi/web` 把 `CanvasLauncher`/`CanvasPanel` 挂到 `launcherRail`/`panelRight` 具名槽即出现（`enabled` 默认 `true`），普通 source 不声明这两个槽则自然缺席。历史环境变量门控 `NEXT_PUBLIC_PI_WEB_CANVAS`（经 **bootstrap 下发** 为 runtime feature `canvas`，默认关）与组件级 `isCanvasEnabled()` 读取路径均已 **`@deprecated`**（`packages/canvas-ui/src/canvas-launcher.tsx:29-37`），仅作向后兼容 / 强制覆盖保留。其架构建立在 **Surface 栈**之上（`domain="canvas"` 的 CQRS 单写者）。

详见 [16 · Canvas 工作台](./16-canvas-workbench.md)。

### CompletionProvider（补全提供者）

触发符驱动的**补全注册框架**。以 `@` 为例，`AttachmentCompletionProvider`（`packages/server/src/completion/providers/attachment-provider.ts`）返回本会话已有附件列表；token 形态 `@attachment:<id>`，提交时解析为规范引用标记。开发者可注册自定义 provider 接入同一补全端点。

详见 [09 · 附件系统](./09-attachment-system.md)、[10 · 扩展与 Skills](./10-extensions-and-skills.md)。

### CQRS 单写者（Command-Query 分离 / single-writer）

**Surface 栈**采用的通信原则：领域权威状态只有一个写者（agent 子进程内的 surface），前端**读**走状态下行镜像、**写**走命令上行（`{point:command, action:execute, payload:{domain,action,args}}`），二者分离。命令不经 LLM，由 `wireSurfaceBridge` 按 domain 直接派发。这是 pi-web「两条正交通信平面」中 surface 平面的核心约定，端到端驱动 Canvas。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### createPiWebHandler

`@blksails/pi-web-server` 导出的**框架无关 HTTP 处理函数工厂**（`packages/server/src/http/create-handler.ts`），`createPiWebHandler(opts)` 返回类型为 `PiWebHandler = (req: Request) => Promise<Response>`（Web Fetch API）。**Hono 宿主**用一条 `app.all("/api/*")` 把标准 `Request`（`c.req.raw`）无损转发给它的单例，原样返回含 SSE `ReadableStream` body 的 `Response`，不重写 status/headers/body、不缓冲；handler 内部路由为 `/sessions/**`、`/config/**`（经 `sse.basePath:"/api"` 去前缀）。这使得后端引擎可挂到任何支持 Web Fetch 的运行时。

详见 [03 · 系统架构](./03-architecture.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

### createSurface（agent 侧权威表面门面）

**Surface 栈**的 agent 侧入口（`packages/tool-kit/src/surface/create-surface.ts`）。按 domain 建立权威 surface，`write` 快照走会话共享状态 `set(surface:<domain>)`，命令归一化为 `SurfaceCommandResult`，注册探针命令 `surface:<domain>`，写进程内注册表 `__piWebSurfaces__`。以 `ExtensionFactory` 形态装载（runtime-only）。作为 agent 作者可声明的能力，见 08 章的指路。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)、[08 · Agent 开发](./08-agent-development.md)。

### 贡献点（ContributionPoints）

WebExtension Tier 3 能力，声明于 `defineWebExtension({ contributions: { slash, mention, keybindings, … } })`。行为由扩展代码实现，经 **UI↔Agent RPC 总线**（`POST /api/sessions/:id/ui-rpc`）回调 agent 进程取结果。需扩展声明 `capabilities: ["contributions"]`，且宿主在会话空闲时自动开启 `openControlOnlyStream`。其中 `keybindings` 的运行时行为是：会话作用域 `document keydown` 匹配 combo 后把 `/${commandId} ` **填入输入框**（可见效果），而非直接执行命令。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## D

### defineAgent

`@blksails/pi-web-agent-kit` 导出的**恒等辅助函数**，运行时原样返回入参，仅为编译期类型推断服务。不使用此包写出的等价 `AgentDefinition` 对象同样能被 runner 载入。

详见 [08 · Agent 开发](./08-agent-development.md)、[05 · 分层包](./05-packages.md)。

### defineCanvasLayer / defineCanvasTool / defineCanvasAction（Canvas 插件三件套）

canvas-kit 导出的 Canvas 插件开发契约：图层、工具、动作三种声明。经 `registerPluginBundles` 施加命名空间前缀 + `requires` 拓扑校验后接入；前端插件捆与 agent 侧命令通道构成双端接线（canonical 范例 `examples/canvas-plugin-stickers`）。`registerLayer` 是注册表内部方法（经 `registerPluginBundles` 调用），非顶层导出。

详见 [17 · Canvas 插件开发](./17-canvas-plugins.md)。

### dev-all（双进程开发编排）

`pnpm dev` 实际执行 `node scripts/dev-all.mjs`——**并发**拉起两个进程：API server（Hono，`127.0.0.1:3000`）与 Vite dev server（`http://localhost:5173`，`/api` 反向代理到 3000）。**开发期浏览器打开的是 5173**（SPA + HMR），3000 是被代理的 API 宿主。任一进程退出/Ctrl-C 时同时收尾。这不是 `next dev`（Next.js 已从 main 删除）。

```bash
pnpm dev            # dev-all：前端 http://localhost:5173（/api 代理到 3000）
```

详见 [01 · 快速开始](./01-quickstart.md)、[22 · 开发规范与测试](./22-development-and-testing.md)。

### 双模式载入（Dual-mode）

pi-web 载入 agent source 的两种模式，但**对外使用同一套 RPC 协议**：

| 模式 | 触发条件 | spawn 目标 |
|------|----------|------------|
| **custom** | 源目录有 `index.[js\|ts]` | `runner-bootstrap.mjs` → jiti → `runRpcMode` |
| **cli** | 源目录无入口 | `pi --mode rpc` |

两种模式底层 RPC 实现完全相同，前后端桥接完全复用，仅 spawn 目标不同。详见 [02 · 核心概念](./02-core-concepts.md)。

---

## E

### esbuild 单文件服务端（dist/server.mjs）

服务端由 esbuild 打成**单文件** `dist/server.mjs`（bundle + esm + node22，`scripts/build-server.mjs`）；pi SDK 两包（`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`）、`jiti`、`pg` 保持 external，并注入 `createRequire` banner shim。**入口必须在产物根**——因 `import.meta.url` 被内联失效后回退 `process.cwd()`，放错目录会解析不到运行时资源。这是取代 Next.js `standalone` 产物的当前形态（见 **standalone** 条）。

详见 [19 · 部署与运维](./19-deployment.md)、[18 · CLI](./18-cli.md)。

### 事件 → UIMessage 翻译层

后端将 agent 子进程发出的 RPC 事件（文本增量、思考块、工具调用、工具结果……）转换为 AI SDK v5 的 `UIMessage` data-part，再经 SSE 推给浏览器 `useChat` 的**前后端枢纽**。后端 RPC 桥用对真实子进程的集成测试保障；前端翻译层是纯函数，用单元测试覆盖。这是 pi-web「两条正交通信平面」中的**聊天流**平面（另一条是 **Surface** 平面）。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

### extension UI 子协议

agent 子进程在执行过程中可经 RPC 发起 `extension_ui_request`（confirm / select / input / editor），这条 `RPC frame → PiSession.ControlStore.extensionUiQueue → SSE control 帧 → 前端 useExtensionUI → PiInteraction 内联卡片 → ui-response → 后端出队` 的完整链路即为扩展 UI 子协议。pi SDK 自带的 `RpcClient` 不暴露此子协议，这是 pi-web 自写 `PiRpcProcess` 的核心原因之一。

详见 [10 · 扩展与 Skills](./10-extensions-and-skills.md)、[02 · 核心概念](./02-core-concepts.md)。

---

## F

### formSchema / 表单 IR（Form IR）

配置 UI 的归一化中间表示，由 `FormSchema` + `FieldDescriptor[]` 构成（`packages/protocol/src/config/form-schema.ts`）。任何来源（zod schema、JSON Schema、手写）都先经适配器转为 `FormSchema`，渲染层 `<SchemaForm>` 只认此 IR。`FieldDescriptor.widget` 字段允许指定自定义渲染器（如 `"providerSelect"`、`"aigcModelToggles"`），通过 `FieldRegistry` 注册表分派。

```ts
// GET /api/config/:domain 返回:
{ formSchema: FormSchema, values: Record<string, unknown>, protocolVersion: string }
```

详见 [13 · 配置 UI](./13-config-ui.md)。

---

## G

### getSessionState（子进程状态桥 seam）

tool-kit 导出的 agent 作者面入口（`packages/tool-kit/src/index.ts:22`，seam key `SESSION_STATE_SEAM_KEY = "__piWebSessionState__"`）。agent 工具内可读写**会话级共享 KV**，供人机共读写。权威在 agent 子进程；下行经 SSE `control:"state"` 镜像帧（带 `rev` 单调号/`deleted`），前端可经 `POST /api/sessions/:id/state` 写回。这是 Surface/Canvas 之下的基础设施，即**状态注入桥**。

详见 [08 · Agent 开发](./08-agent-development.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

---

## H

### Hono 宿主

服务端 HTTP 宿主框架（`server/index.ts`，`hono` ^4.12.28 + `@hono/node-server` 仅作 fetch↔Node 适配器，不引重框架抽象）。整个 `/api/*` 面收敛为**一条** `app.all("/api/*")` 转发到 `createPiWebHandler` 单例（webext/bootstrap 端点须**早于**该通用转发注册）。它取代了 Next.js 时代 `app/api/**` 下的 11 个 Route Handler 转发器文件。生产环境下经 Hono 中间件注入硬化 CSP（见 **productionCsp**）。

详见 [03 · 系统架构](./03-architecture.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

---

## I

### image_vision / /img_vision（视觉识别工具）

`visionExtension` 注册的**图像理解**能力：`image_vision` 工具供 LLM 自主调用（看会话内已有图/最近一张图并回答问题），`/img_vision` 命令供用户主动发起。走 pi 的 `ctx.modelRegistry` 选视觉模型（默认读环境变量 `PI_WEB_VISION_MODEL`，格式 `provider/modelId`），结论以文本 `details` 承载 `VisionResult`。`/img_vision` handler 无返回值，经 `ctx.ui.notify` 呈现；前端对 `source=extension` 命令走 fire-and-forget（不进历史、不卡 busy）。

详见 [11 · AIGC 与视觉工具](./11-aigc-and-vision-tools.md)。

---

## J

### jiti

运行时 TypeScript/ESM 加载器。bootstrap runner 通过 `createJiti()` 创建实例，直接在子进程内 import 用户 `index.ts`，无需预编译。jiti 根锚定在 `@blksails/pi-web-server` 包目录，保证 pi SDK 等依赖从正确位置解析；在 esbuild 打包中保持 external。

详见 [08 · Agent 开发](./08-agent-development.md)、[03 · 系统架构](./03-architecture.md)。

### JSONL framing（JSONL 帧协议）

`PiRpcProcess` 与 agent 子进程之间的进程间通信格式：每条消息为 JSON 对象序列化后以 `\n` 结尾的一行。严格按 `\n` 切割并剥除 `\r`，**禁用 Node `readline`**——因为 readline 会将 `U+2028`（LS）和 `U+2029`（PS）当行分隔符，破坏 JSON 内嵌的这两个字符。消息分三类：`response`、`event`、`extension_ui_request`。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

---

## K

### Kiro（steering / spec）

Kiro 是 pi-web 项目采用的**规格驱动开发（Spec-Driven Development）框架**。

- **Steering**（`.kiro/steering/`）：项目级 AI 引导文件（`product.md`、`tech.md`、`structure.md` 等），在所有会话中作为持久上下文加载。
- **Spec**（`.kiro/specs/<feature>/`）：单个特性的正式规格，含 `requirements.md`、`design.md`、`tasks.md`、`evidence/`。开发遵循需求 → 设计 → 任务三阶段审批流。

详见 [CLAUDE.md](../../CLAUDE.md)。

---

## L

### L0 / L1 / L2 / L3（附件分层）

附件系统的四层架构：

| 层 | 名称 | 核心职责 |
|----|------|----------|
| L0 | 对象存储 | `BlobStore`（`LocalFsBlobBackend` / S3-ready）字节落盘/读取 |
| L1 | 描述符与公开 id | `AttachmentStore` 门面铸造 `att_<id>`，`AttachmentRegistry` 持久化描述符 |
| L2 | resolve 投影 | `resolveAttachment()` → `AttachmentHandle`（`bytes/stream/localPath/url`） |
| L3 | context 闸门 | `beforeToolCall` 属主校验 + `afterToolCall` base64 剥离；由 `wireAttachmentBridge()` 组合进 pi `agent.beforeToolCall`/`afterToolCall` |

详见 [09 · 附件系统](./09-attachment-system.md)。

---

## N

### Node sidecar（随包 Node 运行时）

桌面版（Tauri）随包分发的独立 Node 二进制（`externalBin=binaries/node`，版本钉死 **v22.22.0**）。四平台（darwin arm64/x64、linux x64、win x64）各带 sha256 信任锚点（`desktop/node-sidecar.lock.json`），由 `scripts/fetch-node-sidecar.mjs` 按需下载校验；二进制本身 gitignore。桌面壳向后端子进程注入其绝对路径为 `PI_WEB_NODE_BIN`，供 pi runner 孙进程复用。

详见 [20 · 桌面版（Tauri）](./20-desktop-tauri.md)。

---

## O

### opChannel（对话桥三态降级）

`useConversationBridge`（surface-runtime-facade 门面，`packages/react/src/hooks/use-conversation-bridge.ts:56`）暴露的**通道探测结果**，取值 `"prompt" | "command" | "unavailable"`，渲染时同步求值。`submitOp(op)` 按 opChannel 分道提交：`prompt` 态经纯函数 `renderSurfaceOp` 渲染为用户消息文本、`command` 态走 surface 命令上行、`unavailable` 态降级。这是 Surface 栈把领域操作接入对话流的降级次序（契约 C3-4）。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### openControlOnlyStream

当 WebExtension 需要 `ui-rpc` 回调（`needsIdleControl = hasContributions || hasArtifactRpc`）且会话**处于空闲状态**（`!isBusy`）时，宿主自动开启的专用 SSE 下行连接，用于接收 control 帧。per-prompt 消息流发出期间此连接关闭（由消息流接管），避免并发冲突。源见 `packages/ui/src/chat/pi-chat.tsx`。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## P

### payload / 共享运行时（首启解包）

CLI/桌面版的**随包压缩载荷**机制：`dist/` 不随包裸分发，改由 `scripts/pack-payload.mjs` 压成 `payload/dist.tar.zst`（zstd 级别 19，实测约 9.4MB）+ `payload/payload.json`；解包器 `payload/unpack.mjs` 由 `scripts/build-unpacker.mjs` 用 esbuild 内联 tar 打成约 115KB 零依赖单文件。首次启动解包到**共享运行时目录** `~/.pi/web/runtime/<version>-<digest>/`（`PI_WEB_RUNTIME_ROOT` 可覆盖），含并发锁/心跳、GC 保留最近 N 个旧运行时、判别式错误码（`payload-missing`/`payload-corrupt`/`zstd-unsupported`/`runtime-root-unwritable`/`disk-full`/`lock-timeout`/`extract-failed`）。

详见 [18 · CLI](./18-cli.md)、[20 · 桌面版（Tauri）](./20-desktop-tauri.md)、[23 · 故障排查](./23-troubleshooting-faq.md)。

### PiRpcChannel

**传输无关的 RPC 通道接口**（`packages/server/src/rpc-channel/`），三个方法：

```ts
interface PiRpcChannel {
  send(line: string): void;
  onLine(cb: (line: string) => void): void;
  close(): void;
}
```

当前 local 实现为 `PiRpcProcess`（基于 `child_process` spawn）；接口设计为 e2b / ssh / device 等远程 host 预留替换空间。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

### PiRpcProcess

`PiRpcChannel` 的 **local 实现**，包装 Node `child_process.spawn`，经 JSONL framing 处理三类消息。pi-web 自写此类而非使用 SDK 内置 `RpcClient`，原因是 SDK 版本写死 spawn `pi` 且不暴露扩展 UI 子协议。

详见 [03 · 系统架构](./03-architecture.md)。

### productionCsp（生产 CSP 硬化）

`server/static.ts` 的 `productionCsp()` 生成的内容安全策略，**仅生产环境**经 Hono 中间件注入（`server/index.ts`）。相较旧宿主收紧两处：**禁 `unsafe-eval`**、**去掉 script-src 的 `unsafe-inline`**（改为对内联 import map 做 sha256 hash 放行，hash 为空即吵闹告警而非静默降级）。硬化副作用：运行时 `new Function`/`eval` 被拦（webext 声明式安装须规避）。

详见 [19 · 部署与运维](./19-deployment.md)、[23 · 故障排查](./23-troubleshooting-faq.md)。

### protocolVersion

`@blksails/pi-web-protocol` 包导出的**语义化版本字符串**，随每条 SSE 帧携带。客户端可据此检测版本兼容性（`PiProtocolVersionError`）。协议类型/schema 的任何改动都需遵循语义化版本管理。

详见 [05 · 分层包](./05-packages.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

---

## R

### renderer / 渲染器（Tier 2）

WebExtension 在 `defineWebExtension({ renderers: { tools: {…}, dataParts: {…} } })` 中注册的**自定义卡片渲染组件**，按 per-session 命名空间隔离。宿主收到匹配的 `tool-*` 或 `data-*` part 时调用对应渲染器。真实 dev 环境需 LLM 实际调用工具才触发；可用 `PI_WEB_STUB_AGENT=1` 离线验证。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

### renderSurfaceOp

`@blksails/pi-web-kit` 导出的**纯函数**（`packages/web-kit/src/surface-op.ts:57`），把通道无关的 `SurfaceOp`（标题/工具/有序参数）在 `prompt` 态渲染为用户消息文本（契约 C3-1）。是 opChannel 降级中 `prompt` 分道的组装器。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### resolve 投影（L2）

`resolveAttachment(store, id)` 返回 `AttachmentHandle`，提供四种访问方式：

```ts
handle.bytes()      // 整块字节（小文件）
handle.stream()     // ReadableStream（大文件）
handle.localPath()  // 本地路径（LocalFs 后端，零拷贝）
handle.url()        // HMAC 签名分发 URL（跨进程安全）
```

子进程内经 `createChildAttachmentStore(process.env)` 实例化同一后端，不回调主进程。

详见 [09 · 附件系统](./09-attachment-system.md)。

### runRpcMode

pi SDK（`@earendil-works/pi-coding-agent`）导出的函数，在 agent 子进程内启动**永不返回的 RPC 循环**：监听 stdin JSONL 帧、路由 `command` / `run` / `get_commands` 等请求、将流式事件写到 stdout。custom 模式和 cli 模式均复用同一 `runRpcMode` 实现。

详见 [08 · Agent 开发](./08-agent-development.md)、[02 · 核心概念](./02-core-concepts.md)。

### 运行模式三态（packaged / dev / unpackaged）

桌面版（Tauri）的启动判定（`desktop/src-tauri/src/runtime_mode.rs`）：**packaged**（打包态 → 从随包资源解包后拉起后端）、**dev**（未打包且 `PI_WEB_DESKTOP_DEV_URL` 非空 → 加载该 URL、不拉后端）、**unpackaged**（未打包无 dev url → 直跑构建产物，e2e 路径）。打包态即便设了 dev url 也强制走 packaged（防分发出去连开发服务器）。

详见 [20 · 桌面版（Tauri）](./20-desktop-tauri.md)。

---

## S

### Session（会话）

一个会话 = **一个常驻 agent 子进程 + 一条 SSE 长连接**。`POST /api/sessions` 建会话，返回 `sessionId`；`PiSession` 负责事件广播、生命周期管理与扩展 UI 挂起表。会话状态绑定在某台进程驻留的实例上，这是 pi-web **不能 Serverless/Edge** 且横向扩容需 sticky routing 的根本原因。

详见 [02 · 核心概念](./02-core-concepts.md)、[03 · 系统架构](./03-architecture.md)。

### SessionLifecycleState / 会话就绪握手

会话生命周期状态模型（`packages/protocol/src/transport/session-status.ts`）：`initializing` / `ready` / `error` / `ended`。就绪握手以只读探针 `channel.getCommands()` 首条响应为真实就绪锚点，经粘性 `control:"session-status"` 帧广播，新订阅者回放当前态。它回答「会话何时可发消息」；dev 新旧不一致会导致会话卡「正在连接 agent…」，需重启 dev。

详见 [02 · 核心概念](./02-core-concepts.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

### SessionStore

活动会话注册表接口（`packages/server/src/session/session-store.ts`），默认实现 `InMemorySessionStore`——以 `sessionId` 为键的 `Map`，挂在 `globalThis` 以抗 dev 热重载。

> 注意：这与会话历史**持久化**层 `SessionEntryStore`（`fs` / `sqlite` / `postgres` 三后端，由 `SESSION_STORE` 环境变量选择，默认 `fs`）是两个不同抽象，勿混淆。

详见 [03 · 系统架构](./03-architecture.md)、[14 · 会话列表](./14-sessions-list.md)。

### 插槽（Slots）

WebExtension Tier 1 能力，通过 `defineWebExtension({ slots: { [SlotKey]: ReactNode } })` 向宿主具名区域注入内容。`SlotKeySchema` 现枚举 **21 个**槽（`packages/protocol/src/web-ext/descriptor.ts`，含 `background`、`headerLeft/Center/Right`、`panelRight`、`empty`、`toolbar`、`statusBar`、`logs`、`launcherRail`、`promptToolbar` 等）。插槽以**追加方式**挂载，不替换宿主内核表面；宿主未声明对应插槽时静默忽略。`promptToolbar`（输入框工具排内联槽）是 AIGC 快捷设置控件的挂载点。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

### SSE 帧（Server-Sent Events frame）

前后端通过 `text/event-stream` 协议推送流式数据的单位。每帧携带 `protocolVersion`。除 `ui-message-chunk`（消息流）外，`control` 帧现为多类判别联合，含 `ui-rpc`、`error`、`session-status`（就绪握手粘性帧）、`session-state`（会话权威快照粘性帧）、`state`（状态注入桥镜像帧）、`logs` 等。浏览器侧 `PiSessionConnection`（`@blksails/pi-web-react`）解析帧并路由到 `ControlStore` 或 `useChat`。

详见 [24 · HTTP API 参考](./24-http-api-reference.md)。

### standalone（自包含单文件产物 · dist/server.mjs）

pi-web 的**自包含服务端产物**。**Next.js 已从 main 删除**——旧文档所称 `output:"standalone"` / `pack-standalone.mjs` / `outputFileTracingIncludes` / `.next-cli` 均不复存在。当前产物是 esbuild 打的单文件 `dist/server.mjs`（**必须在产物根**，见 **esbuild 单文件服务端**），构建链为 `pnpm build:dist`（`build:client`（vite build）+ `build:server`（`scripts/build-server.mjs`）+ `pack-dist.mjs` + `build:unpacker` + `build:payload` 五步）。CLI 首启经 `payload/unpack.mjs` 解包到共享运行时；`bin/pi-web.mjs` 里旧的 `standaloneServerJs` 已降级为 `@deprecated` 别名，指向 `distServerJs`（`dist/server.mjs`）。

详见 [18 · CLI](./18-cli.md)、[19 · 部署与运维](./19-deployment.md)。

### steering（引导文件）

见 **Kiro**。

### sticky routing（会话亲和路由）

横向扩容时，**同一 `sessionId` 的所有请求必须路由到同一实例**（该实例驻留对应子进程）的路由策略。nginx 以 `ip_hash` 或 `$cookie_SESSION` 实现，K8s 以 `Service.sessionAffinity=ClientIP` 或 Ingress annotation 实现。未配置时后续请求被路由到无此子进程的实例，导致 404 或静默断连。

详见 [03 · 系统架构](./03-architecture.md)、[19 · 部署与运维](./19-deployment.md)。

### Surface（权威表面）

pi-web「两条正交通信平面」中的**第二条**（与聊天流平面正交，也与 WebExtension 五层挂载机制正交）。以 **CQRS 单写者** 约定跨进程通信：agent 子进程内的 surface 持有某 `domain` 的权威状态，前端读走状态下行镜像、写走命令上行。整栈由 `createSurface`（agent 门面）、`wireSurfaceBridge`（runner 桥）、`useSurface`（前端 hook）、`__piWebSurfaces__`（进程内注册表）、`protocol surface.ts`（`surfaceStateKey`/`SurfaceCommandPayload`/`SurfaceCommandResult` 契约）组成，已实现并有真实子进程集成测试背书，端到端驱动 Canvas。**注意别与 Tier 4 的 artifactSurface（iframe 隔离表面）混淆**；也别把设计词汇 **AAS** 当成本栈的已交付 API。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### SurfaceOp

`@blksails/pi-web-kit` 导出的**通道无关操作类型**（`packages/web-kit/src/surface-op.ts:17`）：把一次领域操作组装成标题 / 工具 / 有序参数的结构，由门面按 **opChannel** 分道提交（`prompt` 态经 `renderSurfaceOp` 渲染为用户消息文本）。Canvas 的六生成动作与 vision「解读」按钮都组装成 SurfaceOp 发进对话流。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)、[16 · Canvas 工作台](./16-canvas-workbench.md)。

### 状态注入桥（state injection bridge）

见 **getSessionState**。会话级双向共享 KV：权威在 agent 子进程（seam `__piWebSessionState__`），写回端点 `POST /api/sessions/:id/state`，下行经 SSE `control:"state"` 镜像帧（带 `rev` 单调号/`deleted`）。是 Surface/Canvas 之下的基础设施，也被消息队列 UI 复用。

详见 [08 · Agent 开发](./08-agent-development.md)、[24 · HTTP API 参考](./24-http-api-reference.md)。

---

## T

### Tauri 桌面壳（Tauri v2）

pi-web 的**第二种交付形态**（`desktop/src-tauri`，Rust crate，Tauri 2.x）。安装包三形态：`dmg`（macOS）、`nsis`（Windows）、`appimage`（Linux）。随 **Node sidecar** v22.22.0 + **共享运行时 payload** 首启解包，运行模式三态（packaged/dev/unpackaged）。壳 spawn 的后端入口是同一个 `dist/server.mjs`，注入 `PORT`/`HOSTNAME`/`PI_WEB_AUTOSTART=1`/`PI_WEB_NODE_BIN`，**刻意不注入** `PI_WEB_AGENT_DIR`（使会话默认落 `~/.pi/agent`、与 CLI 共享）。

详见 [20 · 桌面版（Tauri）](./20-desktop-tauri.md)。

### trustPolicy（信任策略）

决定一个 agent source 或项目 `.pi/` 目录下资源（skills/extensions/prompts）能否被载入的**可替换策略插件点**。取值 `"always"` 放行、`"ask"`（默认）或 `"never"` 拒绝。cli 模式经 `--approve` / `defaultProjectTrust:"always"` 放行；custom 模式经 `PI_WEB_TRUST_PROJECT` 环境变量传递信任信号。持久化实现 `FsProjectTrustStore`，读写 `<agentDir>/trust.json`。

详见 [10 · 扩展与 Skills](./10-extensions-and-skills.md)、[03 · 系统架构](./03-architecture.md)。

---

## U

### useConversationBridge

surface-runtime-facade 的**对话桥门面 hook**（`packages/react/src/hooks/use-conversation-bridge.ts`）：暴露 `opChannel`（三态降级）+ `submitOp` + `bringToConversation` + `onTurnEnd`，收口 conversation / onSubmitPrompt / surface / syncSignal 四个裸注入项。Canvas 工作台经它把生成动作接入对话流。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### useSurface

Surface 栈的**前端 hook**（`packages/react/src/hooks/use-surface.ts`），返回 `{ state, run, available, rev }`：下行镜像 `ControlStore.states` 的 `surface:<domain>` 切片；上行经 `createUiRpcBus` 发 `{point:command, action:execute, payload:{domain,action,args}}`（无顶层 `name` → 逃逸 host 拦截）；`available` 经 `getCommands` 探针判定。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

---

## V

### Vite SPA（前端形态）

pi-web 前端现为 **Vite 驱动的单页应用**：根 `index.html` 为静态入口（内联单例 import map），`src/main.tsx` 为模块入口，`@vitejs/plugin-react` 构建，产物出到 `dist/client`。`vite.config.ts` 的 alias 表须逐字复刻 `tsconfig` paths，`target` 必须 `esnext`、`modulePreload.polyfill` 必须 `false`（否则注入 unsafe-eval/内联脚本破坏 webext 动态 import）。这取代了被删除的 Next.js App Router/RSC。

详见 [03 · 系统架构](./03-architecture.md)、[22 · 开发规范与测试](./22-development-and-testing.md)。

---

## W

### WebExtension

每个 agent source 可在 `.pi/web/` 目录携带的 **UI 控制层**，宿主在该 source 的会话激活时动态加载。入口文件 `web.config.tsx` default export 为 `defineWebExtension(…)` 的返回值，经 `pi-web build` 产出 `web-extension.mjs` + `manifest.json`（含 SRI）。宿主校验 SRI + 签名白名单 + 版本兼容后方才加载。分五层能力（Tier 1–5）：插槽、渲染器、贡献点、Artifact iframe、纯声明配置。

> `pi-web` 作为构建 CLI 由 `@blksails/pi-web-kit`（目录 `web-kit`）的 `bin` 提供，与仓库根 `bin/pi-web.mjs`（standalone 启动器）**同名**，全局安装可能撞名。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

### wireSurfaceBridge

Surface 栈的 **server runner 侧桥**（`packages/server/src/runner/surface-wiring.ts`）：第二个 stdin JSONL 读取器，截 `ui_rpc` 行 → 按 domain 派发 → `writeSync(1)` 直写 fd1 回流 `ui_rpc_response`；非 surface 行放行、无注册惰性 no-op。接线进 runner `startRunner`（在 `runRpcMode` 之前、`wireStateBridge` 之后）。

详见 [04 · Surface 权威表面栈](./04-surface-stack.md)。

### 声明式布局（Declarative Config，Tier 5）

WebExtension 无需携带任何 JS bundle，仅在 `manifest.json` 的 `config` 字段声明 `layout`（宿主 `LayoutPreset` 取 `"centered"` / `"wide"` / `"full"` / `"split"`）、`theme`、`documentTitle`、`empty` 等配置，宿主读取后直接应用。零代码 UI 定制的最轻量路径。

详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## 速查索引

| 术语 | 详述章节 |
|------|---------|
| AAS（pre-spec 设计词汇） | [04](./04-surface-stack.md) |
| Agent Source | [02](./02-core-concepts.md)、[08](./08-agent-development.md) |
| AgentDefinition / defineAgent | [08](./08-agent-development.md)、[05](./05-packages.md) |
| agentHostProvider（规划中） | [03](./03-architecture.md)、[25](./25-roadmap.md) |
| att\_\<id\> | [09](./09-attachment-system.md) |
| Artifact iframe | [12](./12-web-ui-extension.md) |
| BlobStore / L0–L3 | [09](./09-attachment-system.md) |
| bootstrap runner | [08](./08-agent-development.md) |
| bootstrap 下发（/api/bootstrap） | [14](./14-sessions-list.md)、[24](./24-http-api-reference.md) |
| canvas-kit / canvas-ui | [05](./05-packages.md)、[16](./16-canvas-workbench.md)、[17](./17-canvas-plugins.md) |
| Canvas 工作台 | [16](./16-canvas-workbench.md) |
| CompletionProvider | [09](./09-attachment-system.md)、[10](./10-extensions-and-skills.md) |
| CQRS 单写者 | [04](./04-surface-stack.md) |
| createPiWebHandler | [03](./03-architecture.md)、[24](./24-http-api-reference.md) |
| createSurface | [04](./04-surface-stack.md)、[08](./08-agent-development.md) |
| 贡献点 / keybindings | [12](./12-web-ui-extension.md) |
| defineCanvasLayer/Tool/Action | [17](./17-canvas-plugins.md) |
| dev-all（双进程） | [01](./01-quickstart.md)、[22](./22-development-and-testing.md) |
| 双模式载入 | [02](./02-core-concepts.md) |
| esbuild dist/server.mjs | [19](./19-deployment.md)、[18](./18-cli.md) |
| extension UI 子协议 | [10](./10-extensions-and-skills.md)、[02](./02-core-concepts.md) |
| formSchema / 表单 IR | [13](./13-config-ui.md) |
| getSessionState / 状态注入桥 | [08](./08-agent-development.md)、[24](./24-http-api-reference.md) |
| Hono 宿主 | [03](./03-architecture.md)、[24](./24-http-api-reference.md) |
| image_vision / /img_vision | [11](./11-aigc-and-vision-tools.md) |
| JSONL framing | [02](./02-core-concepts.md)、[03](./03-architecture.md) |
| Kiro steering / spec | [CLAUDE.md](../../CLAUDE.md) |
| Node sidecar | [20](./20-desktop-tauri.md) |
| opChannel | [04](./04-surface-stack.md) |
| openControlOnlyStream | [12](./12-web-ui-extension.md) |
| payload / 共享运行时 | [18](./18-cli.md)、[20](./20-desktop-tauri.md)、[23](./23-troubleshooting-faq.md) |
| PiRpcChannel / PiRpcProcess | [02](./02-core-concepts.md)、[03](./03-architecture.md) |
| productionCsp | [19](./19-deployment.md)、[23](./23-troubleshooting-faq.md) |
| protocolVersion | [05](./05-packages.md)、[24](./24-http-api-reference.md) |
| renderer（渲染器） | [12](./12-web-ui-extension.md) |
| renderSurfaceOp | [04](./04-surface-stack.md) |
| resolve 投影 | [09](./09-attachment-system.md) |
| runRpcMode | [08](./08-agent-development.md)、[02](./02-core-concepts.md) |
| 运行模式三态 | [20](./20-desktop-tauri.md) |
| Session | [02](./02-core-concepts.md)、[03](./03-architecture.md) |
| SessionLifecycleState / 就绪握手 | [02](./02-core-concepts.md)、[24](./24-http-api-reference.md) |
| SessionStore | [03](./03-architecture.md)、[14](./14-sessions-list.md) |
| 插槽（Slots · 21 槽） | [12](./12-web-ui-extension.md) |
| SSE 帧 | [24](./24-http-api-reference.md) |
| standalone（dist/server.mjs） | [18](./18-cli.md)、[19](./19-deployment.md) |
| sticky routing | [03](./03-architecture.md)、[19](./19-deployment.md) |
| Surface（权威表面） | [04](./04-surface-stack.md) |
| SurfaceOp | [04](./04-surface-stack.md)、[16](./16-canvas-workbench.md) |
| Tauri 桌面壳 | [20](./20-desktop-tauri.md) |
| trustPolicy | [10](./10-extensions-and-skills.md)、[03](./03-architecture.md) |
| useConversationBridge / useSurface | [04](./04-surface-stack.md) |
| Vite SPA | [03](./03-architecture.md)、[22](./22-development-and-testing.md) |
| WebExtension | [12](./12-web-ui-extension.md) |
| wireSurfaceBridge | [04](./04-surface-stack.md) |
| 声明式布局 | [12](./12-web-ui-extension.md) |

---

## 下一步 / 相关

- 理解整体运行模型请从 [02 · 核心概念](./02-core-concepts.md) 入手。
- 查看进程边界与依赖约束：[03 · 系统架构](./03-architecture.md)。
- 深入第二条通信平面：[04 · Surface 权威表面栈](./04-surface-stack.md)。
- 开始开发自定义 agent：[08 · Agent 开发](./08-agent-development.md)。
- 开始编写 WebExtension：[12 · Web UI 扩展](./12-web-ui-extension.md)。
- 上手画布编辑器：[16 · Canvas 工作台](./16-canvas-workbench.md)。
