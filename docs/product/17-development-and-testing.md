# 17 · 开发规范与测试

本章涵盖 pi-web 的 TypeScript 编码规范、测试分层策略、脚本一览、隔离构建约定，以及 Kiro Spec-Driven 开发流程。

---

## 17.1 TypeScript 规范

所有代码必须在 TypeScript strict 模式下零错误编译，禁止出现 `any`。

`tsconfig.base.json` 强制以下选项：

| 选项 | 值 |
|---|---|
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `noImplicitOverride` | `true` |
| `noFallthroughCasesInSwitch` | `true` |
| `isolatedModules` | `true` |

**RPC 协议类型处理规则**：RPC 层契约（`RpcCommand` / `RpcResponse` / `AgentEvent` / `RpcExtensionUIRequest` / `RpcExtensionUIResponse` 等）的单一事实来源是 `@pi-web/protocol` 包，由其 `src/index.ts` 统一 re-export（`packages/protocol/src/rpc/*.ts`、`packages/protocol/src/transport/*.ts`）。这些类型最初是从上游 pi SDK 的 `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts` 派生而来（上游未在 `exports` 导出其 RPC 层类型），现已收敛进 protocol 包集中维护。**业务代码只 import 消费，禁止在本地重新声明**这些类型或 `SpawnSpec`（早期 `PLAN.md` 提到的本地 `rpc-types.ts` 复制方案已被 protocol-contract 取代）。`SpawnSpec` 同样由 `@pi-web/protocol` 导出，定义于 `packages/protocol/src/transport/spawn.ts`（`SpawnSpecSchema`），字段为 `{ cmd, args, cwd, env }` 且四字段全必填。

类型检查命令（同时递归检查所有 workspace 包）：

```bash
pnpm typecheck
# 等价于：pnpm -r run typecheck && tsc -p tsconfig.json --noEmit
```

---

## 17.2 测试分层策略（硬性要求）

每个 Kiro spec **必须**同时满足以下三层：

| 层次 | 工具 | 运行环境 | 覆盖目标 |
|---|---|---|---|
| **单元 / 集成测试** | Vitest (`test:app`) | jsdom | 前端翻译层纯函数、页面渲染冒烟 |
| **Node 级 e2e** | Vitest (`e2e:node`) | Node | 后端 RPC 桥 + HTTP/SSE 全链路（离线 stub） |
| **浏览器 e2e** | Playwright (`e2e`) | Chromium | 选源 → prompt → 流式回复闭环 |

所有层次必须以**新鲜运行证据**（实际终端输出截图或日志片段）证明通过，参见 `kiro-verify-completion` 协议。

### 17.2.1 单元 / 集成测试

配置文件：`vitest.config.ts`

- 环境：`jsdom`
- 测试目录：`test/**/*.test.ts`、`test/**/*.test.tsx`
- 初始化：`test/setup.ts`

运行：

```bash
pnpm test:app          # 仅主应用测试
pnpm test              # 递归全部 workspace 包（并发数 1）
```

主应用测试覆盖项示例（`test/`）：

- `chat-app.test.tsx` — ChatApp 组件渲染
- `route.integration.test.ts` — API Route Handler 集成
- `attachment-handler-assembly.test.ts` — 附件处理器装配
- `system-resource-args.test.ts` — 系统资源参数解析

### 17.2.2 后端 RPC 桥集成测试（packages/server）

各子包在自身目录下运行 `vitest run`，测试文件在 `packages/server/test/`：

```
test/
├── rpc-channel/
│   ├── pi-rpc-process.unit.test.ts   # PiRpcProcess 消息路由单元测试
│   ├── pi-rpc-process.e2e.test.ts    # spawn → prompt → abort 真实子进程 e2e
│   ├── pi-rpc-process.restart.test.ts
│   └── hot-reload.test.ts
├── session/
│   ├── pi-session.lifecycle.test.ts
│   ├── pi-session.commands.test.ts
│   └── mock-channel.ts               # PiRpcChannel mock 实现
└── session-store/
    ├── fs-store.test.ts
    ├── sqlite-store.test.ts
    └── file-session-agent.e2e.test.ts
```

**关键原则**：后端 RPC 桥使用真实子进程做集成测试，而非 mock 进程；`PiRpcProcess` e2e 测试支持双模式：

- 默认 `STUB`（`packages/server/test/rpc-channel/fixtures/rpc-stub-process.mjs` 固定响应，无需 API Key）
- `PI_WEB_LIVE=1 ANTHROPIC_API_KEY=... pnpm -C packages/server test` 切换为真实 `pi --mode rpc`

### 17.2.3 Node 级 e2e

配置文件：`vitest.node-e2e.config.ts`

- 环境：`node`
- 测试目录：`e2e/node/**/*.test.ts`
- 超时：30 秒

运行：

```bash
pnpm e2e:node   # 脚本已内置 PI_WEB_STUB_AGENT=1，无需额外设置
```

驱动真实 `createPiWebHandler` 的完整 HTTP/SSE 链路，不依赖浏览器。当 Playwright 下载受限或 CI 无头环境有问题时，此层可作为流式链路验证的替代证据。

测试文件（`e2e/node/`）示例：

- `streaming.e2e.test.ts` — 创建会话 → POST prompt → 消费 SSE 流 → 验证增量 `text-delta`、`reasoning-delta`、`tool-input-available` 等帧并断言权限对话回环
- `config-domains.e2e.test.ts` — 配置域 HTTP 端点
- `attachment-completion.e2e.test.ts` — 附件触发符补全

### 17.2.4 浏览器 e2e（Playwright）

配置文件：`playwright.config.ts`

- 测试目录：`e2e/browser/`，匹配 `*.e2e.ts`
- 超时：60 秒（断言 15 秒）
- Workers：1（顺序执行，避免服务端状态竞争）

双后端项目配置：

| 项目名 | 端口 | `SESSION_STORE` |
|---|---|---|
| `fs` | `3100`（默认） | `fs` + `SESSION_STORE_ROOT` |
| `sqlite` | `3101` | `sqlite` + `SESSION_STORE_PATH` |

`session-persistence.e2e.ts` 同时在两个项目运行，其余 spec 仅运行 `fs` 项目。

运行（需先构建）：

```bash
pnpm build && pnpm e2e
```

或使用外部服务器模式（开发服务器运行中时，避免二次 build 污染 `.next`）：

```bash
# 先用隔离目录构建（见 17.3 节）
NEXT_DIST_DIR=.next-e2e pnpm build

# 启动两个 stub 服务器
PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  NEXT_DIST_DIR=.next-e2e SESSION_STORE=fs SESSION_STORE_ROOT=/tmp/e2e-fs \
  next start -p 3100 &

PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  NEXT_DIST_DIR=.next-e2e SESSION_STORE=sqlite SESSION_STORE_PATH=/tmp/e2e.db \
  next start -p 3101 &

# 跑测试
PI_WEB_E2E_EXTERNAL_SERVER=1 \
  PI_WEB_E2E_FS_ROOT=/tmp/e2e-fs \
  PI_WEB_E2E_SQLITE_PATH=/tmp/e2e.db \
  pnpm e2e
```

浏览器 e2e 测试文件示例（`e2e/browser/`）：

- `rich-chat.e2e.ts` — PiChat 选源 → prompt → 流式回复完整闭环
- `session-persistence.e2e.ts` — 冷恢复 URL 会话持久性
- `webext.e2e.ts` / `webext-full.e2e.ts` — Web Extension 渲染 e2e
- `tool-call-ui.e2e.ts` — 工具调用卡片 UI

> 常见报错：若构建后页面报 webpack 500，多半是与运行中的 `next dev` 共享了 `.next`（见 [18 · 1.1](./18-troubleshooting-faq.md)）；若 Playwright 端口被占用或下载受限，先用上文外部服务器模式或退回 `pnpm e2e:node`。测试与工具链类问题汇总见 [18 · 4 测试与工具链问题](./18-troubleshooting-faq.md)。

---

## 17.3 隔离构建（避免污染共享 .next）

**禁止在 `next dev` 运行期间执行 `next build`**——两者共享 `.next` 目录，并发写入会导致 webpack 500 错误。

| 用途 | `NEXT_DIST_DIR` | 命令 |
|---|---|---|
| 开发（默认） | `.next`（隐式） | `pnpm dev` |
| e2e 独立构建 | `.next-e2e` | `NEXT_DIST_DIR=.next-e2e pnpm build` |
| CLI standalone 构建 | `.next-cli` | `pnpm build:cli` |

CLI 构建后调用 `scripts/pack-standalone.mjs` 后处理产物，输出至 `.next-cli/standalone`。

---

## 17.4 脚本一览

`package.json` 中全部 `scripts`：

| 脚本 | 命令 | 说明 |
|---|---|---|
| `dev` | `next dev` | 开发服务器（默认端口 3000；部分机器约定 3010，以 `pnpm dev` 实际输出为准） |
| `build` | `next build` | 生产构建（写 `.next`） |
| `start` | `next start` | 生产启动 |
| `build:cli` | `NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs` | standalone CLI 构建 |
| `start:cli` | `node bin/pi-web.mjs` | 启动全局 CLI |
| `test` | `pnpm -r --workspace-concurrency=1 run test` | 全 workspace 测试 |
| `test:app` | `vitest run` | 主应用单元/集成测试 |
| `e2e` | `playwright test` | 浏览器 e2e（需先 build） |
| `e2e:build` | `next build && playwright test` | 构建后立即 e2e |
| `e2e:node` | `PI_WEB_STUB_AGENT=1 vitest run -c vitest.node-e2e.config.ts` | Node 级 e2e |
| `e2e:cli` | `node e2e/cli/cli-smoke.mjs` | CLI 冒烟 e2e |
| `e2e:cli:watch` | `node e2e/cli/cli-watch.mjs` | CLI --watch 热重载 e2e |
| `typecheck` | `pnpm -r run typecheck && tsc -p tsconfig.json --noEmit` | 全量类型检查 |

---

## 17.5 接口 Seam（可测试性边界）

以下接口是单元测试的关键注入点，任何实现必须满足接口契约，不得绕过：

### PiRpcChannel

定义于：`packages/server/src/rpc-channel/pi-rpc-channel.ts`

```typescript
interface PiRpcChannel {
  send(line: string): void;
  onLine(listener: LineListener): Unsubscribe;
  close(): Promise<void>;
  health(): ChannelHealth;
}
```

`PiRpcProcess` 是本地子进程实现；测试中用 `mock-channel.ts`（`packages/server/test/session/mock-channel.ts`）替换，无需真实子进程。

### SessionStore / SessionEntryStore

定义于：`packages/server/src/session-store/`，后端支持 `fs` / `sqlite` / `postgres` 三种。通过 `SESSION_STORE` 环境变量切换；`SESSION_STORE_ROOT`（fs）或 `SESSION_STORE_PATH`（sqlite）指定存储路径。

### BlobStore

端口接口 `BlobStore` 定义于 `packages/server/src/attachment/blob-store.ts`；当前实现 `LocalFsBlobBackend` 在 `packages/server/src/attachment/local-fs-backend.ts`（S3 等其他后端接口预留）。通过 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 配置，主进程与子进程必须保持一致（否则签名 URL 401）。

---

## 17.6 Kiro Spec-Driven 流程简介

pi-web 采用 Kiro spec-driven 开发，所有特性须经三阶段审批后方可实现。

### 目录结构

```
.kiro/
├── steering/          # 项目级规则（product.md / tech.md / structure.md）
└── specs/
    └── <feature>/
        ├── spec.json          # 阶段状态与审批记录
        ├── requirements.md    # EARS 格式需求
        ├── design.md          # 架构设计
        └── tasks.md           # 带 checkbox 的实现任务列表
```

### 典型命令链

```bash
# 1. 初始化新 spec
/kiro-spec-init "功能描述"

# 2. 生成需求（EARS 格式）
/kiro-spec-requirements <feature>

# 3. 分析与现有代码库的差距（可选）
/kiro-validate-gap <feature>

# 4. 生成设计文档
/kiro-spec-design <feature>

# 5. 生成实现任务
/kiro-spec-tasks <feature>

# 6. 查看进度
/kiro-spec-status <feature>

# 7. 快捷路径（全自动，跳过逐步审批）
/kiro-spec-quick <feature> --auto
```

`spec.json` 记录当前阶段与审批状态，`phase: "implemented"` 表示完成。以 `rpc-channel` spec（`.kiro/specs/rpc-channel/spec.json`）为例，其 `approvals` 字段记录 requirements / design / tasks 三阶段均已批准。

### 实现阶段要求

- 后端 RPC 桥实现需配合 `packages/server/test/rpc-channel/` 下的集成/e2e 测试
- 前端翻译层（event → UIMessage）用纯函数单测覆盖
- 闭环验证使用 `PI_WEB_STUB_AGENT=1`，无需 API Key 或费用
- 每个 spec 完成后调用 `/kiro-verify-completion` 提供新鲜运行证据

---

## 下一步 / 相关

- 后端 RPC 通道与会话引擎架构 → [03 架构](./03-architecture.md)
- `packages/server`、`packages/protocol` 等子包边界 → [04 包结构](./04-packages.md)
- `SESSION_STORE`、`PI_WEB_ATTACHMENT_DIR` 等环境变量 → [05 配置](./05-configuration.md)
- `build:cli` standalone 构建与 `bin/pi-web.mjs` → [14 CLI](./14-cli.md)
- 生产构建与服务器启动 → [15 部署](./15-deployment.md)
- 测试环境日志配置 → [16 日志](./16-logging.md)
- 构建污染、e2e 端口冲突等问题排查 → [18 常见问题](./18-troubleshooting-faq.md)
