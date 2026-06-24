# 19 · 路线图

pi-web 的演进路径：从单机 Web UI 到云原生多 agent 协作平台。

---

## 已实现能力矩阵

### 核心波次（MVP → 扩展完整）

以下 spec 均已完成实现并通过 e2e 验证（`phase: implemented`）。

| 波次 | Spec | 关键交付物 |
|------|------|-----------|
| 协议根 | `protocol-contract` | `@blksails/protocol`：RPC 类型、SSE 帧、UIMessage data-part schema、zod 校验 |
| 传输层 | `rpc-channel` | `PiRpcChannel` 接口 + `PiRpcProcess`（JSONL over stdio） |
| 源解析 | `agent-source-resolver` | 目录/git 入口探测、custom/cli 双模式判定、spawnSpec |
| 运行时 | `agent-runner` | bootstrap runner（jiti 载入 `index.ts` → `runRpcMode`）+ `@blksails/agent-kit` |
| 会话引擎 | `session-engine` | `PiSession` 广播/生命周期/扩展 UI 挂起 + `SessionStore` 接口 |
| HTTP 层 | `http-api` | REST + SSE Route Handlers + `createPiWebHandler(Web Fetch)` |
| 前端 | `react-client` | `PiTransport`（AI SDK v5 `ChatTransport`）+ `usePiSession`/`usePiControls`/`useExtensionUI` |
| 扩展管理 | `extension-management` | 安装/列出/卸载 + 信任策略 + `get_commands` 命令面板 |
| UI 组件 | `ui-components` | `@blksails/ui`：`<PiChat>`/Tool/Reasoning/PromptInput + 渲染器注册表 |
| 整站闭环 | `app-shell` | Next.js 全链路 e2e（选源→prompt→浏览器流式回复） |

### 附件系统波次（2026-06-21，已 e2e 通过）

| Spec | 任务数 | 关键交付物 |
|------|--------|-----------|
| `attachment-store` | 21 | L0 对象存储（LocalFs）+ `POST /sessions/:id/attachments` + `GET /attachments/:id/raw` + 前端 `useAttachments` |
| `attachment-tool-bridge` | 14 | L2 resolve 句柄 + 双进程 store 实例化 + `beforeToolCall` 属主校验 + tool-output 落库回流 |

### 扩展能力波次（已实现）

| Spec | 关键交付物 |
|------|-----------|
| `agent-web-extension` | 每个 agent source 带 `.pi/web` UI 控制层，Tier1–Tier5 五层模型 |
| `aigc-generation-tools` | AIGC 图像生成/编辑工具，默认 `gpt-image-2` |
| `pi-web-cli` | 全局 CLI（standalone）+ `--watch` 热重载 + `bin/pi-web.mjs` 薄启动器 |
| `completion-provider-framework` | `@` 触发符补全框架（file provider + realpath 安全门） |
| `rich-chat-ui` | 富版 `<PiChat>`：会话用量面板、slash 命令面板、工具卡重设计 |
| `session-persistence-url-resume` | URL 参数会话恢复 |
| `schema-config-ui` / `config-ui-sandbox-extensions` | JSON Schema 配置表单 + 沙箱扩展配置 UI |

**测试覆盖快照**（`.kiro/steering/roadmap.md`）：协议 74 / 服务端 289（含 1 skip=LLM-key 门控）/ react 55 / ui 48 / agent-kit 3 / 集成 6 / 离线 Node e2e 4 / 浏览器 Playwright e2e 2。

---

## 规划中（Future / Out of MVP）

以下条目来自 `PLAN.md §14` 与 `.kiro/steering/roadmap.md`，**尚未实现**，仅锁定接缝、不阻塞 MVP。

### embed-integrations — 非 React 嵌入集成

**目标**：`@blksails/embed` 包，让任意技术栈（Vue/Svelte/纯 HTML/后台系统）零侵入接入 pi-web。

核心交付：
- `<pi-web-chat src endpoint token>` Web Component 自定义元素
- `mountPiChat(el, opts)` 命令式挂载 API
- 样式通过 CSS 变量和 Shadow DOM part 穿透

**复用基础**：`@blksails/server` 的 REST/SSE 协议已稳定（`POST /sessions`、`GET /sessions/:id/stream` 等），embed 包只是该协议的浏览器端封装，无需改动服务端。

### host-provider-remote — 远程 agent 宿主

**目标**：在已实现的传输无关接缝 `PiRpcChannel`（`packages/server/src/rpc-channel/pi-rpc-channel.ts`）之上，新增一个 `agentHostProvider`（PLAN.md §14.1/§14.3 规划的工厂，**当前代码中尚未落地**）来选择远程后端，解除"agent 必须本地运行"的限制。

规划中的实现：

| Provider | 机制 | 状态 |
|----------|------|------|
| `local` | `child_process` + 管道（当前由 `PiRpcProcess` 直接承担） | 已实现 |
| `docker` | 每会话容器，RPC JSONL 经 docker exec stdio | 规划中 |
| `e2b` | e2b sandbox，RPC 经 e2b SDK process stdio 流 | 规划中（M5+） |
| `ssh` | 远程主机守护进程 + 反向隧道 | 规划中（M5+） |
| `device` | 边缘设备 + WebSocket 反向连接 | 规划中（M5+） |

**接缝位置**：`PiRpcChannel` 接口（`packages/server/src/rpc-channel/pi-rpc-channel.ts`），`PiRpcProcess`（`pi-rpc-process.ts`）是其 `local` 实现之一。

**已知风险**（`PLAN.md §14.6`）：
- 远程宿主冷启动延迟 → 需 sandbox 池化/预热
- 断连恢复：会话状态在远端，需重连而非重建
- 设备纳管是大工程：安全（反向隧道鉴权、最小权限）、运维（离线/版本漂移）

### session-router-distributed — 分布式会话路由

**目标**：让 pi-web 水平扩展，支持多节点部署。

三个子项：
1. **外置 `SessionStore`**：将当前内存实现 `InMemorySessionStore`（由 `SessionManager` 注入，`packages/server/src/session/session-store.ts`）替换为 Redis / Cloudflare Durable Object 实现；接口 `SessionStore` 已在 `session-engine` 中预留。
2. **控制面/数据面分离**：控制面（agent catalog、鉴权、路由、计费）无状态可上 edge；数据面（RPC 通道转发）有状态但状态在宿主侧，网关只转发。
3. **Edge 网关**：无状态鉴权 + 路由 + SSE 代理；由 `SessionRouter` 解决跨节点 sticky routing。

**约束**：edge 模式下 `agentHostProvider` **必须是远程类**（`e2b`/`ssh`/`device`），不能是 `local`（edge runtime 无法 spawn 子进程）。

### pi-cloud-orchestration — 多 agent 云编排

**目标**：在 `@blksails/server` 之上构建云层（可能是 `@blksails/cloud` 包），实现多 agent 管理与计费纳管。

规划功能：
- `AgentCatalog`：多个 `AgentDefinition`/源的注册、版本管理、权限与分享
- Fleet 面板：一个用户对多 agent、多 host 并发会话的统一视图
- 计费集成：复用 pi SDK 已有的 `get_session_stats` 基元
- 多租户 `authResolver` + `authorizeSession` 鉴权中间件落地

**可复用的 pi SDK 基元**：`new_session`/`fork`/`clone`/`switch_session`、`get_session_stats`、`set_session_name`。

### 生产硬化（`PLAN.md §11`，分散并入相关 spec）

| 项目 | 说明 |
|------|------|
| 沙箱选型落地 | 容器/e2b 隔离，工具执行权限细化 |
| 优雅停机 | 会话 drain + 子进程清理 |
| 资源限额 | CPU/内存/超时 per-session 配额 |
| 可观测 | 结构化日志（`packages/logger` 已实现，待合并主干）+ 指标 |
| 镜像与反代 | 容器化发布、CDN 反代配置 |

---

## 里程碑回顾

| 里程碑 | 描述 | 状态 |
|--------|------|------|
| M0 | 脚手架：Next.js + shadcn + ai-elements + 示例 agent | 完成 |
| M1 | Agent 载入 + RPC 桥（`PiRpcProcess` + `SessionManager`） | 完成 |
| M2 | 翻译层 + 最小闭环（选源 → prompt → 流式回复） | 完成 |
| M3 | 工具卡 + 思考块 + 控制面板（模型/等级/abort/steer/stats） | 完成 |
| M4 | 扩展 UI + 附件 + AIGC + CLI + 补全框架 | 完成 |
| M5+ | 远程宿主（e2b/ssh/device）+ 分布式路由 + pi cloud | 规划中 |

---

## 接缝速查

如需参与未来能力开发，以下是已预留的扩展点：

已实现且可直接替换实现的接缝：

```
PiRpcChannel         — 传输无关 RPC 通道接口；PiRpcProcess 是 local 实现
                       位置：packages/server/src/rpc-channel/pi-rpc-channel.ts

SessionStore         — 外置会话后端接口；当前实现 InMemorySessionStore
                       位置：packages/server/src/session/session-store.ts

authResolver         — (req) => AuthContext（拒绝 → 401）
authorizeSession     — (ctx) => boolean（false → 403）
                       类型声明：packages/server/src/http/auth.ts
                       注入面：  packages/server/src/http/handler.types.ts
                       使用处：  packages/server/src/http/router.ts
```

规划中（PLAN.md §14.1/§14.3，尚未落地为代码符号）：

```
agentHostProvider    — 远程宿主工厂，按 channel 类型返回 PiRpcChannel
                       （docker/e2b/ssh/device 实现的统一入口，规划中）
```

---

## 下一步 / 相关

- [03 · 系统架构](./03-architecture.md) — RPC 通道与接缝的当前实现细节
- [04 · 包结构](./04-packages.md) — `@blksails/embed` 预计位置与包依赖图
- [07 · Agent 开发](./07-agent-development.md) — `AgentDefinition` 定义与本地宿主当前用法
- [08 · 附件系统](./08-attachment-system.md) — 已实现的附件两 spec 详解
- [15 · 部署](./15-deployment.md) — 当前单机部署方案与容器化参考
