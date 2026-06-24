# 02 · 核心概念

理解 pi-web，抓住这几个概念即可。

## Agent Source（agent 源）

一个 **agent source** 是 pi-web 载入对象的入口描述，可以是：

- 一个**本地目录**（绝对路径），
- 一个 **git 源**（解析/拉取后落到本地目录）。

源解析（`agent-source-resolver` spec）做三件事：

1. **解析**目录或 git → 本地工作目录；
2. **入口探测**（`entry-probe.ts`）— 优先 `package.json#pi-web.entry` 覆盖，否则按 `index.ts` > `index.js` > `index.mjs` 取首个存在者；都没有则无入口；
3. **双模式判定** + 信任策略 → 生成一份 `spawnSpec`（子进程怎么起，由 `@blksails/pi-web-protocol` 定义类型）。

## 双模式载入（Dual-mode）

| 模式 | 触发条件 | spawn 目标 |
| --- | --- | --- |
| **custom** | 探测到入口（`index.ts/js/mjs` 或 `pi-web.entry` 覆盖） | bootstrap runner（`node <runner-bootstrap.mjs> --agent <entry> --cwd <work>`）：`jiti` 载入用户入口 → 归一化为 `AgentDefinition` → `createAgentSessionRuntime` → `runRpcMode` |
| **cli** | 源里无入口 | pi CLI：`node <piCliEntry> --mode rpc`（工作目录经 `spawnSpec.cwd` 设置，pi CLI 无 `--cwd` 标志） |

**关键决策：两模式对外是同一套 RPC 协议。** 底层 RPC 实现完全相同，前后端桥接完全复用，只是 spawn 的目标进程不同。这让 pi-web 既能跑任意自定义 agent，也能把通用 pi coding agent 当 Web 服务提供，而无需两套前端。

> custom 模式怎么写入口、归一化为 `AgentDefinition`，见 [07 自定义 Agent 开发](./07-agent-development.md)；cli 模式与全局 `pi-web` 命令行见 [14 CLI](./14-cli.md)。

## Session（会话）

一个会话 = **一个常驻 agent 子进程**。

- 建会话（`POST /api/sessions`）→ 解析源 → spawn 子进程 → 返回 `sessionId`；
- 会话期间该进程常驻，前端经 SSE 订阅其事件流；
- `PiSession`（`session-engine` spec）负责事件广播、生命周期、以及**扩展 UI 挂起表**（权限弹窗等待用户响应）。

会话注册表是 `SessionStore` 接口（`packages/server/src/session/session-store.ts`），默认实现 `InMemorySessionStore`（内存），但**接口外置**——为未来 Redis / Durable Object 等分布式后端预留接缝。

> 一会话一进程 + SSE 长连接 = **有状态服务**。这是 pi-web 不能跑 Serverless/Edge、横向扩容需按 `sessionId` 粘性路由的根本原因。详见 [03 系统架构](./03-architecture.md)。

> 历史会话可在 **会话列表**里浏览并一键恢复（按 `sessionId` 重新订阅其事件流），详见 [21 会话列表](./21-sessions-list.md)。

## RPC 通道（`PiRpcChannel`）

后端核心是一条**传输无关的 RPC 通道**：

```ts
// packages/server/src/rpc-channel/pi-rpc-channel.ts
interface PiRpcChannel {
  send(line: string): void;                 // 写一行 JSONL 到下游（local 即子进程 stdin）
  onLine(cb: (line: string) => void): Unsubscribe; // 注册按行回调，返回取消订阅句柄
  close(): Promise<void>;                    // 关闭通道并干净退出
  health(): ChannelHealth;                   // 查询通道健康（alive / exitCode / signal）
}
```

- `PiRpcProcess`（`packages/server/src/rpc-channel/pi-rpc-process.ts`）是它的 **local 实现**（基于 `node:child_process` spawn）；
- `SpawnSpec`（子进程怎么起）由 `@blksails/pi-web-protocol` 拥有并导出，是单一事实来源；
- 通道抽象为未来 e2b / ssh / device 等远程 host 预留。

子进程通信用 **JSONL framing**：严格按 `\n` 切、剥 `\r`，**禁用 Node `readline`**（它会误切 `U+2028/2029`）。消息分三类：`response`（命令应答）、`event`（流式事件）、`extension_ui_request`（扩展 UI 请求，如权限弹窗）。

> pi-web **不直接用 SDK 内置的 `RpcClient`**——它写死 spawn `pi` 且未暴露 extension UI 子协议。pi-web 自写 `PiRpcProcess` 处理这三类消息。

## 事件 → UIMessage 翻译层

这是**前后端的枢纽**。agent 子进程发出的 RPC 事件（文本增量、思考、工具调用、工具结果……）经翻译层转换为 AI SDK v5 的 `UIMessage` data-part，再经 SSE 推给浏览器的 `useChat`。

- 后端 RPC 桥用对**真实子进程的集成测试**保障；
- 前端翻译层是**纯函数**，用单元测试覆盖。

## SSE 帧与 `protocolVersion`

前后端经 **SSE（Server-Sent Events）** 传流式数据，每帧携带 `protocolVersion`。`@blksails/pi-web-protocol` 是稳定契约，类型/schema 改动需语义化版本管理。详见 [13 HTTP/SSE API 参考](./13-http-api-reference.md)。

## 附件的两条路径（概念预览）

附件不进 pi 协议，全在 pi-web 层。核心是**「引用而非 base64」**：历史与 context 里只放 `att_<id>` 引用，base64 仅在两个出口物化：

1. **喂 LLM 识别**（vision）— 上传图在该出口转 base64 给模型；
2. **交 server 端 tool** — 文件经 `attachmentId` 参数在 runner 子进程内 `resolve` 为 path/url/bytes，工具产出再落库回流。

详见 [08 附件系统](./08-attachment-system.md)。

## 配置目录 `~/.pi/agent`

凭据与默认值的来源：

- `auth.json` — provider 凭据（`pi` 登录后生成）；
- `settings.json` — 默认 provider/model 等；
- `models.json` — 自定义 OpenAI-compatible provider（见 [06](./06-providers-and-models.md)）。

可经 `PI_WEB_AGENT_DIR` / `PI_CODING_AGENT_DIR` 覆盖目录。注意环境变量名是 `PI_CODING_AGENT_DIR`（不是 `PI_AGENT_DIR`）。

## 三个不变式（贯穿设计）

记住这三条，很多设计决策就自洽了：

1. **单一身份** — 每个附件一个 `att_<id>`，全链路同一身份空间（含工具产出物）。
2. **先落库后引用** — 任何附件先入对象存储拿到 id，再被消息/工具引用。
3. **base64 仅具名出口物化** — 平时只传引用，base64 只在「喂 LLM」与「工具读取」两个明确出口短暂出现，以省 context。

## 下一步 / 相关

- 这些概念如何落到层与数据流上 → [03 系统架构](./03-architecture.md)
- 提到的 `@blksails/pi-web-protocol`、`@blksails/pi-web-server` 等包边界 → [04 分层包](./04-packages.md)
- 给自己的 agent 套 UI（custom 模式入口）→ [07 自定义 Agent 开发](./07-agent-development.md)
- 把通用 pi agent 当 Web 服务起（cli 模式 / `pi-web` 命令）→ [14 CLI](./14-cli.md)
- 附件三不变式的完整实现 → [08 附件系统](./08-attachment-system.md)
- 不熟的名词随时查 → [20 术语表](./20-glossary.md)
