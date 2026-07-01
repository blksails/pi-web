# 03 · 系统架构

**pi-web 是「浏览器 ↔ 薄转发 Route Handler ↔ 一会话一个 Agent 子进程」的三段式架构**：所有跨进程通信走一条传输无关的 RPC 通道（JSONL over stdio），后端核心是框架无关的 `(Request) => Response` handler。本章自上而下讲清这条数据流、`PiRpcProcess` 的三类消息、有状态长连接的约束，以及为远程隔离/分布式预留的接缝。

## 全景数据流

```
Browser（AI Elements + useChat）
   │  SSE / HTTP
   ▼
Next.js Route Handler（Node runtime，会话进程驻留）
   │  stdin/stdout JSONL
   ▼
Agent 子进程 — node <runnerEntry>（custom）  或  node <piCliEntry> --mode rpc（cli）
              （一会话一进程）
```

三段：

1. **浏览器** — AI Elements 组件 + AI SDK v5 `useChat`，经自定义 `ChatTransport`（`PiTransport`，见 `packages/react/src/transport/pi-transport.ts`）发请求、收 SSE。
2. **Next.js Route Handler（Node runtime）** — 薄转发层。`runtime = "nodejs"` 是强制的：它要 spawn 子进程并持有 SSE 长连接，Edge/Serverless 不支持。
3. **Agent 子进程** — 每会话一个；两种模式 `cmd` 都是 `node`，只是参数不同：custom 模式跑 bootstrap runner（`node <runnerEntry> --agent <entry> --cwd <cwd>`，内部经 `jiti` 装载用户 `index.ts` 后 `runRpcMode`），cli 模式跑 `node <piCliEntry> --mode rpc`（见 `packages/server/src/agent-source/assemble-spawn.ts`）。

### 亲眼看到「一会话一进程」

这条架构可以直接观测——起 dev、开一个会话，再用 `pgrep` 查 spawn 出来的子进程：

```bash
# 1. 起开发服务器（quickstart 的标准命令）
pnpm dev          # next dev — http://localhost:3000

# 2. 浏览器打开 http://localhost:3000，载入一个 agent 并发一条消息建立会话

# 3. 另开一个终端，查当前 node 子进程的完整命令行（pgrep -fl 在 macOS/Linux 通用）
pgrep -fl node | grep -E -- '--mode rpc|--agent'
```

载入 `examples/hello-agent`（含 `index.ts`，走 custom 模式）后，预期看到类似一行：

```
94786 node .../packages/server/runner-bootstrap.mjs --agent .../examples/hello-agent/index.ts --cwd .../examples/hello-agent --agent-dir ~/.pi/agent --session-id <uuid> --source-meta .../examples/hello-agent
```

- 载入的是**自定义 agent**（源里有 `index.ts`）→ 看到 `node …/runner-bootstrap.mjs --agent <你的入口> --cwd <工作目录>`；
- 载入的是**通用 pi**（源里无入口，回退 cli）→ 看到 `node …/pi… --mode rpc`。

每多开一个会话就多一个这样的子进程；关掉会话（`DELETE /api/sessions/:id`）对应进程随之退出。看不到任何子进程？多半是会话还没真正建立或刚崩溃——排查见 [18 故障排查 FAQ](./18-troubleshooting-faq.md)。

## 枢纽：RPC 通道 + 翻译层

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

### 回复流：每轮一条 /stream 订阅

SSE 不是一条会话级持久连接，而是**每轮（per-turn）新开一条**。客户端 `PiTransport.sendMessages`（`packages/react/src/transport/pi-transport.ts`）遵守固定次序：**先开流、再 POST prompt**——先调 `connection.openChunkStream()` 打开 `GET /sessions/:id/stream`，再 `await client.prompt()` 发 `POST /sessions/:id/messages` 提交本轮 prompt；该轮回复帧经这条流回来，遇 `finish` / `abort` 帧即关闭。空闲期没有任何流是正常状态。

服务端 `GET /stream`（`packages/server/src/http/routes/stream-route.ts`）在 `ReadableStream.start` 内调用 `PiSession.subscribe()`。对**迟到订阅者**，subscribe 只回放两类内容：日志 ring-buffer + 粘性（sticky）的 `session-status` / `session-state` 两类帧；承载回复正文的 `uiMessageChunk` 经 `EventEmitter` **瞬时广播、无缓冲、不回放**。`Last-Event-ID` 也仅作帧的**续号起点**（`startSeq`），网关不缓存历史帧、不按序号回放。

正因如此，「先开流再 POST prompt」的次序是硬约定而非风格：若 `POST /messages` 抢在流连上之前触发 agent 首次产出（实测 prompt 落地约 32ms，而 dev 冷编译/高负载下流可能数秒才连上——热态 ~79ms、冷态实测过 3237ms），连接窗口内广播的 `uiMessageChunk` 会因无缓冲而永久丢失，回复只有手动刷新（走历史接口 `GET /sessions/:id/messages`）才可见。这也是「发送后需刷新才看到回复」这类间歇性现象的根因。

## 有状态长连接的约束

> **不能 Serverless / Edge**（除非控制面/数据面分离）；横向扩容需按 `sessionId` **sticky routing**。

原因链：一会话 = 一常驻子进程 + 一条 SSE 长连接 → 会话状态绑定在某台进程驻留的实例上 → 同一 `sessionId` 的后续请求必须回到同一实例。

未来要分布式（路线图 `session-router-distributed`）的路径：外置 `SessionStore`（Redis/DO）+ 控制面/数据面分离 + edge 网关。

## 预留接缝（接口隔离）

传输 / 隔离 / 存储都按**接口**实现，后端经配置切换，是为未来能力预留的接缝：

| 接口 | 当前实现 | 未来 |
| --- | --- | --- |
| `PiRpcChannel` | `PiRpcProcess`（local child_process） | e2b / ssh / device 远程 host |
| `agentHostProvider` | 本机 spawn | docker / e2b / ssh / device |
| `SessionStore` | 内存 Registry | Redis / Durable Object |
| `BlobStore` | `LocalFsBlobBackend` | S3 风格对象存储 |

附件能力按 **L0 存储 / L1 引用 / L2 投影(resolve) / L3 context 闸门**分层（见 [08](./08-attachment-system.md)）。

## 安全是可替换策略

沙箱、信任（`trustPolicy`）、鉴权（`authResolver`）都做成**插件点**而非硬编码：

- 源信任策略由 agent-source 解析管道落地（`packages/server/src/agent-source/resolver.ts`、`trust-policy.ts`，决定一个源能否被载入/spawn），默认实现返回 `"ask"`（headless 安全默认）；
- 附件分发 URL 用 HMAC 签名自洽鉴权（`GET /attachments/:id/raw?exp&sig`，`sig = HMAC-SHA256(secret, "<id>.<exp>")`，校验用 `timingSafeEqual` 常量时间比较），防枚举、不绑会话（见 `packages/server/src/attachment/url-signer.ts`）；
- 扩展安装走来源白名单 + `--ignore-scripts`（禁 npm 生命周期脚本 RCE，见 `packages/server/src/extensions/install/install-args.ts`）。

## 框架无关的 handler

HTTP 层核心是 `createPiWebHandler`（`packages/server/src/http/create-handler.ts`）——一个 **Web Fetch `(Request) => Response`** 的框架无关 handler，自己做 method+path 路由与 SSE 编码。Next.js 的 catch-all route（`app/api/sessions/[[...path]]/route.ts`、`app/api/config/[[...path]]/route.ts`、`app/api/attachments/[[...path]]/route.ts`）只是 `getHandler()(req)`——把标准 `Request` 无损转发给单例 handler、原样返回 `Response`（含 SSE 的 `ReadableStream` body），不重写 status/headers/body、不缓冲。

> 这意味着 pi-web 的后端引擎**不绑 Next.js**——理论上可挂到任何支持 Web Fetch 的运行时。

## 包/层即边界

依赖单向收敛：`protocol ← 一切`；`server` 只依赖 `protocol`；`react`/`ui` 与后端经协议解耦。每个 spec 的边界 = 包/层边界。详见 [04 分层包](./04-packages.md)。

## 运行时与镜像

- **语言** TypeScript（strict，禁 `any`）；
- **框架** Next.js 15（App Router / RSC），API Route 强制 `runtime="nodejs"`；
- **运行时** Node `>=22.19.0`，镜像 `node:24-bookworm-slim`；**Bun 仅工具链**；
- **Agent 载入** `jiti`（运行时直接跑用户 `index.ts`）。

## 下一步 / 相关

- 包与层的具体边界、依赖方向 → [04 分层包](./04-packages.md)
- 上面提到的 HTTP 端点（`/api/sessions`、`/api/attachments` 等）逐条说明 → [13 HTTP API 参考](./13-http-api-reference.md)
- 附件 L0–L3 分层与 HMAC 分发 URL 全貌 → [08 附件系统](./08-attachment-system.md)
- 扩展安装/信任策略 → [09 扩展与 Skills](./09-extensions-and-skills.md)
- 部署形态与 sticky routing 约束 → [15 部署](./15-deployment.md)
