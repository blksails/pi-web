# 03 · 系统架构

**pi-web 是「浏览器（Vite SPA）↔ Hono 薄转发宿主 ↔ 一会话一个 Agent 子进程」的三段式架构**：所有跨进程通信走一条传输无关的 RPC 通道（JSONL over stdio），后端核心是框架无关的 `(Request) => Response` handler，由 esbuild 打成单文件 `dist/server.mjs`。本章自上而下讲清这条数据流、`PiRpcProcess` 的三类消息、有状态长连接的约束，并埋下贯穿全书的两个心智锚点：**前端 Vite SPA 的构建位置**，以及 pi-web 内部**两条正交的跨进程通信平面**。

## 两条正交的通信平面

读架构之前先立一个总纲——pi-web 里的前后端通信不是一根管子，而是**两条互不从属、并行存在的平面**：

| 平面 | 方向与形态 | 承载什么 | 权威在哪 |
| --- | --- | --- | --- |
| **① 会话 / 对话流** | 请求-响应 + per-turn SSE 流 | prompt / steer / 工具调用 / 文本与思考的流式回复 | agent 的对话状态（消息历史） |
| **② Surface 权威表面** | 命令上行 + 状态快照下行（CQRS 单写者） | 富交互 UI 的领域状态与命令（如 Canvas 画布） | agent 进程内某 `domain` 的权威快照 |

平面 ① 是本章的主线——RPC 通道 + 事件→`UIMessage` 翻译层，是「聊一句、流回来」的经典路径。平面 ② 是 **Surface 权威表面栈**：一块富交互 UI 被建模成「agent 进程里某 `domain` 的瘦投影 + 命令发起端」，UI 的点击变成结构化命令**上行**（不经 LLM），领域状态作为权威快照**下行**镜像到前端。二者共用同一条子进程 stdio 与同一条 SSE，却服务于完全不同的交互语义——这就是「正交」。

> 本章只把平面 ② 立为**概念锚点**（它是什么、和平面 ① 什么关系、落在哪些文件）；`createSurface` / `wireSurfaceBridge` / `useSurface` 的完整 API 与端到端实例在 [04 Surface 权威表面栈](./04-surface-stack.md) 展开。后续 [12 Web UI 扩展](./12-web-ui-extension.md)、[16 Canvas 工作台](./16-canvas-workbench.md)、[26 术语表](./26-glossary.md) 都会反向引用这里。

## 全景数据流

```
Browser（Vite SPA · AI Elements + useChat）
   │  SSE / HTTP  →  /api/*
   ▼
Hono 宿主（server/index.ts · @hono/node-server 适配 fetch↔Node）
   │  一条 app.all("/api/*") → createPiWebHandler 单例
   │  stdin/stdout JSONL
   ▼
Agent 子进程 — node <runnerEntry>（custom）  或  node <piCliEntry> --mode rpc（cli）
              （一会话一进程）
```

三段：

1. **浏览器（Vite SPA）** — AI Elements 组件 + AI SDK v5 `useChat`，经自定义 `ChatTransport`（`PiTransport`，见 `packages/react/src/transport/pi-transport.ts`）发请求、收 SSE。前端是静态单页应用（`index.html` + `src/main.tsx`，产物 `dist/client`），无 SSR / RSC——详见下节「前端构建（Vite SPA）」。
2. **Hono 薄转发宿主** — `server/index.ts` 用 `@hono/node-server` 做 `IncomingMessage ↔ Web Request/Response` 的桥接（含 SSE 流式响应），**只作 fetch↔Node 适配器、不引入框架级抽象**。整个 `/api/*` 面收敛为**一条** `app.all("/api/*")`，把标准 `Request`（`c.req.raw`）无损转发给 `createPiWebHandler` 单例、原样返回 `Response`。这一层进程常驻、持有 SSE 长连接并 spawn 子进程，因此不能跑在无状态 Serverless / Edge 上（原因见「有状态长连接的约束」）。
3. **Agent 子进程** — 每会话一个；两种模式 `cmd` 都是 `node`，只是参数不同：custom 模式跑 bootstrap runner（`node <runnerEntry> --agent <entry> --cwd <cwd>`，内部经 `jiti` 装载用户 `index.ts` 后 `runRpcMode`），cli 模式跑 `node <piCliEntry> --mode rpc`（见 `packages/server/src/agent-source/assemble-spawn.ts`）。

### 亲眼看到「一会话一进程」

这条架构可以直接观测——起 dev、开一个会话，再用 `pgrep` 查 spawn 出来的子进程：

```bash
# 1. 起开发服务器（quickstart 的标准命令）
pnpm dev          # dev-all.mjs：API :3000 + vite :5173

# 2. 浏览器打开 http://localhost:5173（vite dev，/api 自动代理到 3000）
#    载入一个 agent 并发一条消息建立会话

# 3. 另开一个终端，查当前 node 子进程的完整命令行（pgrep -fl 在 macOS/Linux 通用）
pgrep -fl node | grep -E -- '--mode rpc|--agent'
```

> `pnpm dev` 是 `node scripts/dev-all.mjs`（`package.json:17`），**并发**拉起两个进程：API 宿主（`server/index.ts`，`:3000`）与 vite dev（`:5173`，`/api` 反代到 3000，见 `vite.config.ts:72-81`）。开发期浏览器要打开的是 **vite 的 5173**——3000 是被代理的 API-only 宿主，直接开它看不到 SPA 前端。任一进程退出或 Ctrl-C，两者同时收尾（`scripts/dev-all.mjs:20-27`）。

载入 `examples/hello-agent`（含 `index.ts`，走 custom 模式）后，预期看到类似一行：

```
94786 node .../packages/server/runner-bootstrap.mjs --agent .../examples/hello-agent/index.ts --cwd .../examples/hello-agent --agent-dir ~/.pi/agent --session-id <uuid> --source-meta .../examples/hello-agent
```

- 载入的是**自定义 agent**（源里有 `index.ts`）→ 看到 `node …/runner-bootstrap.mjs --agent <你的入口> --cwd <工作目录>`；
- 载入的是**通用 pi**（源里无入口，回退 cli）→ 看到 `node …/pi… --mode rpc`。

每多开一个会话就多一个这样的子进程；关掉会话（`DELETE /api/sessions/:id`）对应进程随之退出。看不到任何子进程？多半是会话还没真正建立或刚崩溃——排查见 [23 故障排查 FAQ](./23-troubleshooting-faq.md)。

## 前端构建（Vite SPA）

前端是 **Vite 驱动的单页应用**，不再有 Next.js / App Router / RSC（已从 main 整体删除）：

- **静态入口** 仓库根 `index.html`——含内联的单例 import map 与模块入口 `<script type="module" src="/src/main.tsx">`；`src/main.tsx` 是 React 挂载点。
- **产物** `vite build` 出到 `dist/client`（`vite.config.ts:68`），是纯静态资源；生产由 Hono 宿主的 `serveStatic` / `serveSpaFallback` 托管（`server/index.ts:94-98`）。
- **运行时配置端点** `GET /api/bootstrap`（`server/index.ts:66-67`）取代了旧 Next 的构建期 `NEXT_PUBLIC_*` 内联：env 由**服务端**在启动后读取、经该端点下发给 SPA。这是一处语义反转——像 `pi-web --canvas` 这类开关现在是**运行时**生效（而非构建期固化）。

两处 vite 配置是**硬约束、不可改动**（`vite.config.ts:5-19` 有实证注释）：

- `build.target: "esnext"` —— 低 target 下 vite 会为动态 import 注入需要 `unsafe-eval` 的 polyfill，而生产 CSP 禁 `unsafe-eval`（见 [19 部署](./19-deployment.md)），注入即导致代码扩展加载失败。
- `modulePreload.polyfill: false` —— 该 polyfill 注入内联脚本并改写动态 import 路径，会破坏 webext 的外部 URL entry 加载。

另一条隐性契约：`vite.config.ts` 的 `resolve.alias` 表必须**逐字复刻** `tsconfig.json` 的 `paths`（`vite.config.ts:37-64`），且 CSS 子路径别名要排在主入口之前（前缀匹配会吞掉 `/styles.css`）——`scripts/build-server.mjs` 与 `vitest.node-e2e.config.ts` 三处别名表需保持一致。

## 枢纽：RPC 通道 + 翻译层（平面 ①）

后端核心是一条**传输无关的 RPC 通道** `PiRpcChannel`；**事件 → AI SDK `UIMessage` 流**的翻译层是前后端枢纽。

```
                   ┌────────────────────────────────────────┐
   浏览器  ◀──SSE──│  PiSession（广播/生命周期/扩展UI挂起）        │
                   │       ▲ event→UIMessage 翻译              │
                   │  PiRpcChannel（传输无关）                  │
                   │       ▲ JSONL                            │
                   └───────┼────────────────────────────────┘
                           ▼
                 PiRpcProcess（local：child_process）
                           ▼
       custom: node <runnerEntry>（jiti+runRpcMode）  /  cli: node <piCliEntry> --mode rpc
```

因为两种模式共享同一 RPC 实现，桥接完全复用，**只有 spawn 目标不同**。

### 为什么自写 `PiRpcProcess`

SDK 自带的 `RpcClient` 写死 spawn `pi`，且不暴露 extension UI 子协议。pi-web 自写 `PiRpcProcess`（`packages/server/src/rpc-channel/pi-rpc-process.ts`，实现 `PiRpcChannel` 端口），按 stdout 每行 JSON 的 `type` 字段路由三类消息：

- `type: "response"`（带 `id`）— 命令应答，按 `id` 兑现 `pendingCommands` 对应 Promise（请求/响应配对）；
- `type: "extension_ui_request"` — 扩展 UI 请求（权限弹窗等），登记到 `pendingExtensionUI` 挂起表，等待上层经 `respondExtensionUI` 回写；
- 其余带 `type` 字符串的帧 — 一律视为流式 `event`（`agent_start` / `agent_end` / `message_update` 等：文本、思考、工具…），广播给 `onEvent` 监听器。

封装了一组与 SDK `RpcClient` 对齐的命令方法（19 个：`prompt` / `steer` / `follow_up` / `abort` / `set_model` / `cycle_model` / `get_available_models` / `set_thinking_level` / `get_state` / `get_messages` / `get_session_stats` / `get_commands` / `compact` / `fork` / `get_fork_messages` / `clone` / `new_session` / `bash` / `abort_bash`）——每个都「生成唯一 id + 发送 + 等待对应 `response`」。

### JSONL framing 的坑

自写 `JsonlLineReader`（`packages/server/src/rpc-channel/jsonl-reader.ts`）做增量成帧：**仅以 `\n` 切行**、剥尾随 `\r`（CRLF）、跨 chunk 拼接残行、跳空行。**禁用 Node `readline`**——它会误把 `U+2028` / `U+2029` 当行分隔，而这些字符可合法出现在 JSON 字符串内，按它切会破坏 JSON。

> **子进程 stdin 上不止一个读取器。** runner 在进入 RPC 模式之前，会为 `process.stdin` 再挂几个 JSONL 读取器：状态注入桥（`wireStateBridge`，截 `piweb_state_set`）、Surface 桥（`wireSurfaceBridge`，截 surface 命令行）、消息队列「取回」桥等（`packages/server/src/runner/runner.ts:346` 一带）。它们各自只消费自己认得的帧、放行其余行，构成平面 ② 与其它跨进程 seam 的**上行**通道；下行则复用状态桥的 fd1 直写。详见 [04](./04-surface-stack.md)。

### 回复流：每轮一条 /stream 订阅

SSE 不是一条会话级持久连接，而是**每轮（per-turn）新开一条**。客户端 `PiTransport.sendMessages`（`packages/react/src/transport/pi-transport.ts`）遵守固定次序：**先开流、再 POST prompt**——先调 `connection.openChunkStream()` 打开 `GET /sessions/:id/stream`，再 `await client.prompt()` 发 `POST /sessions/:id/messages` 提交本轮 prompt；该轮回复帧经这条流回来，遇 `finish` / `abort` 帧即关闭。空闲期没有任何流是正常状态。

服务端 `GET /stream`（`packages/server/src/http/routes/stream-route.ts`）在 `ReadableStream.start` 内调用 `PiSession.subscribe()`。对**迟到订阅者**，subscribe 只回放两类内容：日志 ring-buffer + 粘性（sticky）的 `session-status` / `session-state` 两类帧；承载回复正文的 `uiMessageChunk` 经 `EventEmitter` **瞬时广播、无缓冲、不回放**。`Last-Event-ID` 也仅作帧的**续号起点**（`startSeq`），网关不缓存历史帧、不按序号回放。

正因如此，「先开流再 POST prompt」的次序是硬约定而非风格：若 `POST /messages` 抢在流连上之前触发 agent 首次产出（实测 prompt 落地约 32ms，而 dev 冷编译/高负载下流可能数秒才连上——热态 ~79ms、冷态实测过 3237ms），连接窗口内广播的 `uiMessageChunk` 会因无缓冲而永久丢失，回复只有手动刷新（走历史接口 `GET /sessions/:id/messages`）才可见。这也是「发送后需刷新才看到回复」这类间歇性现象的根因。

## 有状态长连接的约束

> **不能 Serverless / Edge**（除非控制面/数据面分离）；横向扩容需按 `sessionId` **sticky routing**。

原因链：一会话 = 一常驻子进程 + 一条 SSE 长连接 → 会话状态绑定在某台进程驻留的实例上 → 同一 `sessionId` 的后续请求必须回到同一实例。这个约束与前端框架无关，纯粹来自「进程常驻 + spawn 子进程 + 持有长连接」的宿主形态。

未来要分布式（路线图 `session-router-distributed`）的路径：外置 `SessionStore`（Redis/DO）+ 控制面/数据面分离 + edge 网关。

> 桌面版（Tauri）是与 Web 服务端并列的第二种交付形态，`packaged` 模式下由 Rust 壳 spawn **同一个** `dist/server.mjs`（注入 `PORT` / `PI_WEB_NODE_BIN` 等）从随包资源拉后端——同样受「一会话一进程 + 长连接」约束，只是被隔离在本机单实例里。见 [20 桌面版（Tauri）](./20-desktop-tauri.md)。

## 预留接缝（接口隔离）

传输 / 隔离 / 存储都按**接口**实现，后端经配置切换，是为未来能力预留的接缝：

| 接口 | 当前实现 | 未来 |
| --- | --- | --- |
| `PiRpcChannel` | `PiRpcProcess`（local child_process） | e2b / ssh / device 远程 host |
| `agentHostProvider` | 本机 spawn | docker / e2b / ssh / device |
| `SessionStore` | 内存 Registry | Redis / Durable Object |
| `BlobStore` | `LocalFsBlobBackend` | S3 风格对象存储 |

除上表外，还有两条**已落地**的跨进程 seam（区别于「未来接缝」，它们现在就在跑）：

- **状态注入桥**——会话级双向共享 KV，权威在 agent 子进程（seam `__piWebSessionState__`，`packages/tool-kit/src/session-state.ts:15`）；`POST /sessions/:id/state` 写回，`control:"state"` SSE 帧下行镜像（带 `rev` 单调号）。作者工具经 `getSessionState()` 读写，概念与作者面见 [04](./04-surface-stack.md)、写回端点见 [24 HTTP API 参考](./24-http-api-reference.md)。
- **Surface 桥**（平面 ②）——建立在状态桥的下行之上（`wireSurfaceBridge` 复用 `wireStateBridge` 的 fd1 直写），命令上行经 stdin 第二读取器派发（`packages/server/src/runner/surface-wiring.ts`）。

附件能力按 **L0 存储 / L1 引用 / L2 投影(resolve) / L3 context 闸门**分层（见 [09 附件系统](./09-attachment-system.md)）。

## 安全是可替换策略

沙箱、信任（`trustPolicy`）、鉴权（`authResolver`）都做成**插件点**而非硬编码：

- 源信任策略由 agent-source 解析管道落地（`packages/server/src/agent-source/resolver.ts`、`trust-policy.ts`，决定一个源能否被载入/spawn），默认实现返回 `"ask"`（headless 安全默认）；
- 附件分发 URL 用 HMAC 签名自洽鉴权（`GET /attachments/:id/raw?exp&sig`，`sig = HMAC-SHA256(secret, "<id>.<exp>")`，校验用 `timingSafeEqual` 常量时间比较），防枚举、不绑会话（见 `packages/server/src/attachment/url-signer.ts`）；
- 扩展安装走来源白名单 + `--ignore-scripts`（禁 npm 生命周期脚本 RCE，见 `packages/server/src/extensions/install/install-args.ts`）；
- 鉴权门在 Hono 层留有接缝：`server/index.ts:49-52` 的中间件在门控关闭（默认）时表现与不存在完全一致，多租户/登录墙合入后原 `middleware.ts` 逻辑迁到这里。

## 框架无关的 handler

HTTP 层核心是 `createPiWebHandler`（`packages/server/src/http/create-handler.ts`）——一个 **Web Fetch `(Request) => Response`** 的框架无关 handler，自己做 method+path 路由与 SSE 编码。宿主层薄到只有一条转发：

```ts
// server/index.ts:75-91（节选）
app.all("/api/*", async (c) => {
  const res = await getHandler()(c.req.raw);       // 标准 Request 无损转发给单例
  if (c.req.method === "DELETE" && res.ok) {
    const id = wholeSessionIdFromUrl(c.req.url);    // 整会话删除成功时
    if (id !== undefined) await forgetSessionSource(id).catch(() => {}); // 顺带清 sessionId→source 映射
  }
  return res;                                       // Response（含 SSE ReadableStream body）原样交还
});
```

`getHandler()(c.req.raw)` 把 `c.req.raw`（标准 `Request`）直接喂给单例 handler，返回的 `Response`（含 SSE 的 `ReadableStream` body）原样交还，不重写 status/headers/body、不缓冲。唯一的额外动作是 DELETE 整会话成功后顺带清 `sessionId → source` 映射（尽力而为，绝不改变 handler 的原始响应）。注意 webext 端点（`/api/webext/*`）与 `/api/bootstrap` 必须**早于**这条通用转发注册（`server/index.ts:54-67`），否则被 `app.all` 抢匹配。

> 这意味着 pi-web 的后端引擎**不绑任何 Web 框架**——`createPiWebHandler` 是标准 `(Request) => Promise<Response>`，理论上可挂到任何支持 Web Fetch 的运行时；Hono 在这里只是一个可替换的 fetch↔Node 适配器。

## 服务端构建：esbuild 单文件

服务端由 `scripts/build-server.mjs` 用 esbuild 打成**单文件** `dist/server.mjs`（`bundle` + `format:esm` + `target:node22`）：

- **★ 入口必须位于产物根**（`dist/server.mjs`，不能是 `dist/server/index.mjs`）。`packages/server` 的 `runnerBootstrapPath()` / `resolvePiCliEntry()` 采用「从 `import.meta.url` 推算 → 失败则回退 `process.cwd()`」；esbuild 会把 `import.meta.url` 内联为构建机绝对路径，异机/异 OS 下只能靠回退，而 CLI 以 `dirname(serverJs)` 作 cwd——入口若在子目录，回退全部失效，真实会话必崩（`scripts/build-server.mjs:1-27`）。
- **external 清单**：pi SDK 两包（`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`）+ `jiti` + `pg` / `pg-native` 保持外置——前三者 agent 子进程在运行时经 jiti 动态 import，静态打包会破坏 pnpm 的 realpath 布局；`pg` 含可选的 `require('pg-native')`（`scripts/build-server.mjs:29-35`）。
- 生产构建管线是 `pnpm build:dist`（`package.json:22`）= `build:client`（vite）→ `build:server`（esbuild）→ `pack-dist` → `build:unpacker` → `build:payload` 五步串联。产物结构与生产 CSP 硬化见 [19 部署](./19-deployment.md)。

## 包/层即边界

依赖单向收敛：`protocol ← 一切`（真正的零依赖叶根是 `logger`，`protocol` 依赖它 + zod）；`server` 经协议解耦；`react`/`ui` 与后端经协议解耦。每个 spec 的边界 = 包/层边界。packages/ 下共 **11 个**可独立发布的包，详见 [05 分层包](./05-packages.md)。

## 运行时

- **语言** TypeScript（strict，禁 `any`）；
- **前端** Vite + SPA（`index.html` 静态入口 + `src/main.tsx`，产物 `dist/client`）；
- **服务端** Hono 宿主（`server/index.ts`，`@hono/node-server` 适配），由 esbuild 打成单文件 `dist/server.mjs`（`bundle`+`esm`+`node22`，pi SDK 两包/jiti/pg 保持 external，入口必须在产物根）；
- **运行时** Node `>=22.19.0`（`package.json:6`）；**Bun 仅工具链**；
- **Agent 载入** `jiti`（运行时直接跑用户 `index.ts`）。

## 下一步 / 相关

- 第二条通信平面 Surface 权威表面栈的完整 API 与 Canvas 实例 → [04 Surface 权威表面栈](./04-surface-stack.md)
- 包与层的具体边界、依赖方向（11 包） → [05 分层包](./05-packages.md)
- 上面提到的 HTTP 端点、SSE 控制帧、`/api/bootstrap` 与状态写回端点 → [24 HTTP API 参考](./24-http-api-reference.md)
- 附件 L0–L3 分层与 HMAC 分发 URL 全貌 → [09 附件系统](./09-attachment-system.md)
- 扩展安装/信任策略 → [10 扩展与 Skills](./10-extensions-and-skills.md)
- 部署形态、esbuild 产物结构、生产 CSP 与 sticky routing 约束 → [19 部署](./19-deployment.md)
- 桌面版（Tauri）分发形态 → [20 桌面版（Tauri）](./20-desktop-tauri.md)
- dev-all 双进程编排与构建管线细节 → [22 开发规范与测试](./22-development-and-testing.md)
