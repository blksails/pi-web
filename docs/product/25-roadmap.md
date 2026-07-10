# 25 · 路线图

pi-web 的演进路径：从单机 Web UI，到二创画布 + 桌面分发的完整交付形态，再到规划中的云原生多 agent 协作平台。

本章只回答两个问题：**已经交付了什么**，以及**明确规划、尚未实现的是什么**。凡标注「已交付」的条目都在 `main` 上有 git-tracked 代码背书；凡标注「规划中／未实现」的只锁定接缝、不阻塞当前可用能力。两者之间还有一条**开发中（分支未合入 main）**的隔离带，见文末，读者切勿把它当已可用能力使用。

---

## 一、已交付能力矩阵

### 1.1 核心波次（MVP → 扩展完整）

以下 spec 均已 `phase: implemented` 并通过 e2e 验证，构成 pi-web 的骨架。

| 波次 | Spec | 关键交付物 |
|------|------|-----------|
| 协议根 | `protocol-contract` | `@blksails/pi-web-protocol`：RPC 类型、SSE 帧、UIMessage data-part schema、zod 校验 |
| 传输层 | `rpc-channel` | `PiRpcChannel` 接口 + `PiRpcProcess`（JSONL over stdio） |
| 源解析 | `agent-source-resolver` | 目录/git 入口探测、custom/cli 双模式判定、spawnSpec |
| 运行时 | `agent-runner` | bootstrap runner（jiti 载入 `index.ts` → `runRpcMode`）+ `@blksails/pi-web-agent-kit` |
| 会话引擎 | `session-engine` | `PiSession` 广播/生命周期/扩展 UI 挂起 + `SessionStore` 接口 |
| HTTP 层 | `http-api` | REST + SSE + `createPiWebHandler`（Web Fetch handler，宿主见 1.2） |
| 前端 | `react-client` | `PiTransport`（AI SDK v5 `ChatTransport`）+ `usePiSession`/`usePiControls`/`useExtensionUI` |
| 扩展管理 | `extension-management` | 安装/列出/卸载 + 信任策略 + `get_commands` 命令面板 |
| UI 组件 | `ui-components` | `@blksails/pi-web-ui`：`<PiChat>`/Tool/Reasoning/PromptInput + 渲染器注册表 |
| 整站闭环 | `app-shell` | Vite SPA 前端 + Hono 服务端全链路 e2e（选源 → prompt → 浏览器流式回复） |

> 注：早期文档把整站闭环写成「Next.js 全链路」。这已不成立——见 1.2 的架构迁移波次。

### 1.2 架构迁移波次 · 脱 Next → Vite + SPA + Hono + esbuild（`vite-spa-migration`，`phase: implemented`）

这是 MVP 之后最大的一次架构切换，早期 roadmap 完全没有登记，实际已合入 `main`：

- **前端**改为 Vite 驱动的 SPA：根 `index.html` 静态入口（内联单例 import map）+ `src/main.tsx` 模块入口，产物出 `dist/client`（`vite.config.ts:22-23,68`）。
- **服务端宿主**改为 Hono + `@hono/node-server`，整个 `/api/*` 面收敛为一条 `app.all('/api/*')` 转发到单例 `createPiWebHandler`（`server/index.ts:33,75-91`）。
- **服务端打包**由 esbuild 打成单文件 `dist/server.mjs`（bundle + esm + node22，pi SDK 两包/jiti/pg 保持 external，入口必须在产物根，`scripts/build-server.mjs:27,73-80`）。
- **开发命令** `pnpm dev` = `node scripts/dev-all.mjs`，并发拉起 API server（`:3000`）与 vite dev（`:5173`，`/api` 代理到 `:3000`）；开发期浏览器打开的是 `:5173`（`scripts/dev-all.mjs:32-36`、`vite.config.ts:72-81`）。
- **生产 CSP 硬化**：`productionCsp()` 禁 `unsafe-eval`、去 `script-src` 的 `unsafe-inline`（改对内联 import map 做 sha256 hash 放行），仅 `NODE_ENV=production` 时经 Hono 中间件注入（`server/static.ts:124-192`）。
- **运行时配置端点**：`NEXT_PUBLIC_*` 门控变量名保留，但语义反转——不再是构建期内联，而是由 `GET /api/bootstrap` 在服务端运行时读 env 后下发为 runtime feature（`server/bootstrap.ts:91-100`），前端经 `setRuntimeFeatures()` 注入。因此这类 env 门控（如 `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER`）现在改 env 后重启服务端即生效，无需重新构建。

架构细节见 [03 · 系统架构](./03-architecture.md)；构建与部署形态见 [19 · 部署与运维](./19-deployment.md)；CLI 首启解包见 [18 · CLI](./18-cli.md)。

### 1.3 Canvas 工作台栈（已交付，默认关）

面向用户/集成方的二创画布编辑器，独立发布为两个包，代码已合 `main`，**默认不出现**——是否显示由 agent source 是否把 `CanvasLauncher`/`CanvasPanel` 挂到具名槽（`launcherRail`/`panelRight`）决定，而非全局开关（历史 env 门控 `NEXT_PUBLIC_PI_WEB_CANVAS` 现仅作向后兼容，详见 [16](./16-canvas-workbench.md)）：

| 波次 | Spec | 交付物 |
|------|------|--------|
| L1/L2 内核 | `canvas-kit-m1` | `@blksails/pi-web-canvas-kit`：`createCanvasKernel` + 8 内置绘制工具 |
| 动作评分制 | `canvas-actions-m2` | `defineCanvasAction` + 6 内置生成动作（outpaint/inpaint/reference/variants/reframe/edit） |
| 插件三件套 | `canvas-plugins-m3` | `defineCanvasLayer/Tool/Action` + `registerPluginBundles` 命名空间/拓扑校验 |
| vision 解读 | `canvas-vision-readout` | 提示词栏「解读」按钮：把工作图组装成 `tool:image_vision` 的 SurfaceOp 发进对话流 |

`CanvasWorkbench`（舞台缩放平移/工具轨/掩码标注 overlay/版本条/画廊 `CanvasGallery`）建立在 Surface 栈之上（`domain=canvas` 的 CQRS）。canonical 范例：`examples/aigc-canvas-agent`、`examples/canvas-plugin-stickers`。

面向用户见 [16 · Canvas 工作台](./16-canvas-workbench.md)，面向插件作者见 [17 · Canvas 插件开发](./17-canvas-plugins.md)。

### 1.4 Surface 权威表面栈（已交付）

与 RPC/SSE 聊天流正交的**第二条跨进程通信平面**：agent 侧建 domain 权威状态、命令上行 + 状态下行的 CQRS 单写者约定。已实现且有真实子进程集成测试背书，端到端驱动 Canvas：

- `createSurface`（agent 门面，`packages/tool-kit/src/surface/create-surface.ts`）
- `wireSurfaceBridge`（runner 桥，`packages/server/src/runner/surface-wiring.ts`）
- `useSurface` / `useConversationBridge`（前端 hook，`packages/react/src/hooks/`）
- protocol 契约根 `packages/protocol/src/web-ext/surface.ts`

> 术语纪律：`agent-authoritative-surface-design.md` 中的 **AAS**（Agent-Authoritative Surface）在 `main` 上仍是明确标注的 **pre-spec 设计草案词汇**；框架层单一权威是已收编该草案的 `docs/surface-app-runtime-contract-v1.md`。本栈的**已交付代码符号**是上面列出的 `createSurface`/`useSurface` 等，而非「AAS SDK」。

concept-first 全貌见 [04 · Surface 权威表面栈](./04-surface-stack.md)，范例 `examples/surface-demo-agent`。

### 1.5 其他已合并波次

以下能力早期 roadmap 未登记，实际均已在 `main`：

| 能力 | 交付物 / 证据 |
|------|--------------|
| 附件系统 | `attachment-store` + `attachment-tool-bridge`：引用式四层附件（L0 对象存储 + L2 resolve 句柄 + tool-output 回流）。见 [09](./09-attachment-system.md) |
| AIGC 图像工具 | `image_generation`/`image_edit` 经 `aigcExtension` + `pi.registerTool` 装载（已去 ToolSpec/compileTool）。见 [11](./11-aigc-and-vision-tools.md) |
| 视觉识别 | `image-vision-tool`：`image_vision` 工具 + `/img_vision` 命令 + `GET /vision/models`。见 [11](./11-aigc-and-vision-tools.md) |
| 状态注入桥 | `state-injection-bridge`：双向会话级 KV，权威在 agent 子进程，`POST /sessions/:id/state` 写回 + `control:"state"` 下行镜像帧 |
| 会话就绪握手 | `SessionLifecycleState` + 粘性 `control:"session-status"` 帧 + `getCommands` 只读就绪探针 |
| Agent 声明式 routes | `AgentDefinition.routes` → 会话锚定端点 + `slashCompletions` 静态补全。见 [08](./08-agent-development.md) |
| 消息队列 UI | 排队/可视化/取回，per-session `control:"queue"` 粘性帧。见 [15](./15-message-queue.md) |
| 会话列表 / 启动导航区 | `SessionListPanel` + `LauncherRail`（搜索/新建/收藏锚点/webext 槽）。见 [14](./14-sessions-list.md) |
| 全局 CLI（standalone） | `bin/pi-web.mjs` 薄启动器拉起 `dist/server.mjs` + 首启共享运行时解包。见 [18](./18-cli.md) |
| 日志系统 | `@blksails/pi-web-logger` 同构结构化日志（**已合主干**）+ 浏览器面板。见 [21](./21-logging.md) |
| 新增包 | `@blksails/pi-web-logger`（依赖树真实叶根）、`-primitives`（6 个 shadcn 薄封装）。见 [05](./05-packages.md) |

> `packages/` 现为 **11 个**可独立发布的包（早期文档误写 7 个）。完整清单与依赖图见 [05 · 分层包](./05-packages.md)。

### 1.6 桌面版（Tauri v2，已交付 · 部分平台已验）

pi-web 的**第二种交付形态**：Tauri v2 桌面壳（非 Electron，已迁移），两个相关 spec 均为 `implemented-partial`——macOS 全链路已验，跨平台尚未完整验证：

- 安装包三形态：`dmg`（macOS）/ `nsis`（Windows）/ `appimage`（Linux），`desktop/src-tauri/tauri.conf.json`。
- 随包 Node sidecar v22.22.0（信任锚点：lock 文件校验官方压缩包 sha256），`desktop/node-sidecar.lock.json`。
- 共享运行时首启解包：`payload/dist.tar.zst` + `unpack.mjs` → `~/.pi/web/runtime/<ver>-<digest>/`（`shared-runtime-payload`，同为 `implemented-partial`）。
- 运行模式三态：`packaged` / `dev` / `unpackaged`（打包态强制忽略 dev url 的安全约束）。

分发与运行细节见 [20 · 桌面版（Tauri）打包与分发](./20-desktop-tauri.md)。

**测试覆盖（MVP 波次快照）**：协议 74 / 服务端 289（含 1 skip=LLM-key 门控）/ react 55 / ui 48 / agent-kit 3 / 集成 6 / 离线 Node e2e 4 / 浏览器 Playwright e2e 2。此为 MVP 波次的历史快照，1.2–1.6 各后续波次的用例未计入其中；当前逐 spec 覆盖用 `/kiro-spec-status {feature}` 查询。

### 亲手验证已交付能力

```bash
# 离线（不接真实 LLM）跑通已交付的整站闭环
PI_WEB_STUB_AGENT=1 pnpm dev
# 浏览器打开 http://localhost:5173（/api 自动代理到 :3000）
```

预期：进入选源页 → 选一个 `examples/` 下的 agent（如 `examples/hello-agent`）→ 发一条 prompt → 浏览器收到流式回复。想体验 Canvas/Surface/视觉能力，把 source 换成 `examples/aigc-canvas-agent` 或 `examples/vision-agent`，Canvas 面板门控见 [16](./16-canvas-workbench.md)。

---

## 二、里程碑回顾

| 里程碑 | 描述 | 状态 |
|--------|------|------|
| M0 | 脚手架：Web UI + shadcn + ai-elements + 示例 agent | 完成 |
| M1 | Agent 载入 + RPC 桥（`PiRpcProcess` + `SessionManager`） | 完成 |
| M2 | 翻译层 + 最小闭环（选源 → prompt → 流式回复） | 完成 |
| M3 | 工具卡 + 思考块 + 控制面板（模型/等级/abort/steer/stats） | 完成 |
| M4 | 扩展 UI + 附件 + AIGC + CLI + 补全框架 | 完成 |
| **M5** | **脱 Next → Vite+SPA+Hono+esbuild 迁移 · Canvas 工作台 · Surface 权威表面栈 · 状态注入桥/就绪握手 · Tauri 桌面版（部分平台已验）** | **完成** |
| M6+ | 远程宿主（e2b/ssh/device）+ 分布式会话路由 + pi cloud 编排 | 规划中 |

> M5 行是本次修订新增：它把 1.2–1.6 这批**已交付但曾散落无归属**的能力从「未来」栏移入「完成」栏，与 M6+ 的**纯规划**能力明确切开，避免读者把「已经做完的新东西」误读成「还没做」。

---

## 三、开发中（分支未合入 main，暂不可用）

> **范围警示**：以下条目**不在 `main`**，仅存在于未合并的功能分支，本手册其余章节一律不予记述。请勿据此编写脚本或依赖其命令——它们当前**不可用**，命令语法、路径与行为均未定型。

| 条目 | 状态 |
|------|------|
| CLI 包管理命令集（`create`/`install`/`uninstall`/`list`/`update`/`publish` 等子命令） | 开发中，未合入 main（分支 `feat/cli-package-commands`） |
| 组件安装器（shadcn 式源码安装车道） | 开发中，未合入 main（分支 `feat/component-installer`） |

合入 `main` 前，[18 · CLI](./18-cli.md) 记述的仍是**无子命令的薄启动器**（`bin/pi-web.mjs` 只接受单个 `[source]` 位置参数 + 启动选项，`bin/pi-web.mjs` 的 `parseCliArgs`）。

---

## 四、规划中（Future / Out of MVP）

以下条目来自 `PLAN.md §14` 与 `.kiro/steering/roadmap.md`，**尚未实现**，仅锁定接缝、不阻塞当前能力。

### 4.1 embed-integrations — 非 React 嵌入集成

**目标**：`@blksails/embed` 包（**规划中，尚未建目录**），让任意技术栈（Vue/Svelte/纯 HTML/后台系统）零侵入接入 pi-web。

- `<pi-web-chat src endpoint token>` Web Component 自定义元素
- `mountPiChat(el, opts)` 命令式挂载 API
- 样式经 CSS 变量 + Shadow DOM part 穿透

**复用基础**：Hono 宿主的 REST/SSE 协议已稳定（`POST /sessions`、`GET /sessions/:id/stream` 等，见 [24 · HTTP/SSE API 参考](./24-http-api-reference.md)），embed 包只是该协议的浏览器端封装，无需改动服务端。

### 4.2 host-provider-remote — 远程 agent 宿主

**目标**：在已实现的传输无关接缝 `PiRpcChannel`（`packages/server/src/rpc-channel/pi-rpc-channel.ts`）之上，新增一个 `agentHostProvider` 工厂（PLAN.md §14.1/§14.3 规划，**当前代码中尚未落地为符号**）来选择远程后端，解除「agent 必须本地运行」的限制。

| Provider | 机制 | 状态 |
|----------|------|------|
| `local` | `child_process` + 管道（当前由 `PiRpcProcess` 承担） | 已实现 |
| `docker` | 每会话容器，RPC JSONL 经 docker exec stdio | 规划中 |
| `e2b` | e2b sandbox，RPC 经 e2b SDK process stdio 流 | 规划中（M6+） |
| `ssh` | 远程主机守护进程 + 反向隧道 | 规划中（M6+） |
| `device` | 边缘设备 + WebSocket 反向连接 | 规划中（M6+） |

**已知风险**（`PLAN.md §14.6`）：远程宿主冷启动延迟（需 sandbox 池化/预热）；断连恢复（会话状态在远端，需重连而非重建）；设备纳管的安全（反向隧道鉴权、最小权限）与运维（离线/版本漂移）。

### 4.3 session-router-distributed — 分布式会话路由

**目标**：让 pi-web 水平扩展、支持多节点部署。三个子项：

1. **外置 `SessionStore`**：把当前内存实现 `InMemorySessionStore` 替换为 Redis / Cloudflare Durable Object 实现；接口 `SessionStore`（`packages/server/src/session/session-store.ts`）已在 `session-engine` 预留。
2. **控制面/数据面分离**：控制面（agent catalog、鉴权、路由、计费）无状态可上 edge；数据面（RPC 通道转发）有状态但状态在宿主侧，网关只转发。
3. **Edge 网关**：无状态鉴权 + 路由 + SSE 代理；由 `SessionRouter` 解决跨节点 sticky routing。

**约束**：edge 模式下 `agentHostProvider` **必须是远程类**（`e2b`/`ssh`/`device`），不能是 `local`（edge runtime 无法 spawn 子进程）。

### 4.4 pi-cloud-orchestration — 多 agent 云编排

**目标**：在 Hono 宿主之上构建云层（可能是 `@blksails/cloud` 包），实现多 agent 管理与计费纳管。

- `AgentCatalog`：多个 `AgentDefinition`/源的注册、版本管理、权限与分享
- Fleet 面板：一个用户对多 agent、多 host 并发会话的统一视图
- 计费集成：复用 pi SDK 已有的 `get_session_stats` 基元
- 多租户 `authResolver` + `authorizeSession` 鉴权中间件落地

**可复用的 pi SDK 基元**：`new_session`/`fork`/`clone`/`switch_session`、`get_session_stats`、`set_session_name`。

### 4.5 生产硬化（`PLAN.md §11`，分散并入相关 spec）

| 项目 | 说明 | 状态 |
|------|------|------|
| 沙箱选型落地 | 容器/e2b 隔离，工具执行权限细化 | 规划中 |
| 优雅停机 | 会话 drain + 子进程清理 | 规划中 |
| 资源限额 | CPU/内存/超时 per-session 配额 | 规划中 |
| 生产 CSP 硬化 | 禁 `unsafe-eval`、去 `unsafe-inline` 改 import map sha256 放行 | **已交付**（见 1.2 / [19](./19-deployment.md)） |
| 结构化日志 | `@blksails/pi-web-logger` 同构日志 + 浏览器面板 | **已交付**（见 [21](./21-logging.md)） |
| 镜像与反代 | 容器化发布、CDN 反代配置 | 规划中 |

---

## 五、接缝速查

如需参与未来能力开发，以下是已预留的扩展点。

已实现且可直接替换实现的接缝：

```
PiRpcChannel         — 传输无关 RPC 通道接口；PiRpcProcess 是 local 实现
                       位置：packages/server/src/rpc-channel/pi-rpc-channel.ts

SessionStore         — 外置会话后端接口；当前实现 InMemorySessionStore
                       位置：packages/server/src/session/session-store.ts

authResolver         — (req) => AuthContext（拒绝 → 401）
authorizeSession     — (ctx) => boolean（false → 403）
                       类型声明：packages/server/src/http/auth.ts
                       使用处：  packages/server/src/http/router.ts

createSurface        — agent 侧按 domain 建权威表面（已交付，见 04）
                       位置：packages/tool-kit/src/surface/create-surface.ts
```

规划中（PLAN.md §14.1/§14.3，尚未落地为代码符号）：

```
agentHostProvider    — 远程宿主工厂，按 channel 类型返回 PiRpcChannel
                       （docker/e2b/ssh/device 实现的统一入口，规划中）
```

---

## 相关链接

- [03 · 系统架构](./03-architecture.md) — Vite SPA ↔ Hono 宿主 ↔ 子进程的当前实现
- [04 · Surface 权威表面栈](./04-surface-stack.md) — 已交付的第二条通信平面
- [05 · 分层包](./05-packages.md) — 11 个 `@blksails/*` 包的职责与依赖方向
- [16 · Canvas 工作台](./16-canvas-workbench.md) — 已交付的二创画布编辑器
- [17 · Canvas 插件开发](./17-canvas-plugins.md) — 三件套契约与双端接线
- [18 · CLI](./18-cli.md) — 薄启动器与首启共享运行时解包
- [19 · 部署与运维](./19-deployment.md) — esbuild 单文件产物与生产 CSP
- [20 · 桌面版（Tauri）](./20-desktop-tauri.md) — 第二种交付形态
- [24 · HTTP/SSE API 参考](./24-http-api-reference.md) — embed/云层复用的稳定协议面
