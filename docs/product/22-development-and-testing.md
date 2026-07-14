# 22 · 开发规范与测试

本章面向 pi-web 的贡献者，涵盖 TypeScript 编码规范、`pnpm dev` 双进程开发循环、`build:dist` 真实构建管线、测试分层策略与脚本一览、可测试性接口 Seam，以及 Kiro Spec-Driven 开发流程。

> 前端为 Vite 驱动的 SPA（`index.html` 静态入口 + `src/main.tsx`，产物 `dist/client`），服务端宿主为 Hono（`server/index.ts` 一条 `app.all('/api/*')`），由 esbuild 打成单文件 `dist/server.mjs`。Next.js 已从 main 移除——本章命令均以真实 `package.json` 脚本为准，不存在 `.next` / `next dev` / `next build` / `NEXT_DIST_DIR`。

---

## 22.1 TypeScript 规范

所有代码必须在 TypeScript strict 模式下零错误编译，禁止出现 `any`。

`tsconfig.base.json` 强制以下选项（`tsconfig.base.json:8-19`）：

| 选项 | 值 |
|---|---|
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `noImplicitOverride` | `true` |
| `noFallthroughCasesInSwitch` | `true` |
| `isolatedModules` | `true` |

**RPC 协议类型处理规则**：RPC 层契约（`RpcCommand` / `RpcResponse` / `AgentEvent` / `RpcExtensionUIRequest` / `RpcExtensionUIResponse` 等）的单一事实来源是 `@blksails/pi-web-protocol` 包，由其 `src/index.ts` 统一 re-export（`packages/protocol/src/rpc/*.ts`、`packages/protocol/src/transport/*.ts`）。这些类型最初从上游 pi SDK 的 `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts` 派生而来（上游未在 `exports` 导出其 RPC 层类型），现已收敛进 protocol 包集中维护。**业务代码只 import 消费，禁止在本地重新声明**这些类型或 `SpawnSpec`。`SpawnSpec` 同样由 `@blksails/pi-web-protocol` 导出，定义于 `packages/protocol/src/transport/spawn.ts`（`SpawnSpecSchema`），字段为 `{ cmd, args, cwd, env }` 且四字段全必填。

类型检查命令（同时递归检查所有 workspace 包）：

```bash
pnpm typecheck
# 等价于：pnpm -r run typecheck && tsc -p tsconfig.json --noEmit
```

---

## 22.2 开发循环：`pnpm dev` 双进程编排

`pnpm dev` 不是单进程服务器，而是 `node scripts/dev-all.mjs`（`package.json:17`），一条命令并发拉起两个进程：

| 进程 | 端口 | 用途 |
|---|---|---|
| **API 宿主**（`server/index.ts`，经 jiti 直跑 TS） | `3000` | Hono `app.all('/api/*')` + 会话子进程 |
| **Vite dev server** | `5173` | SPA 前端 + HMR，`/api` 反向代理到 `127.0.0.1:3000` |

**开发期浏览器打开的是 `http://localhost:5173`**（不是 3000）。`3000` 是纯 API 宿主，直接打开只能看到 JSON 而非聊天界面；`/api` 请求由 Vite 代理转发到它（`vite.config.ts:72-81`）。

`dev-all.mjs` 的编排语义（`scripts/dev-all.mjs:19-36`）：

- 任一子进程退出（或 `Ctrl-C`）→ 两个进程一并 `SIGTERM` 收尾；
- 非 TTY（后台 / CI）下 `stdin` 置为 `ignore`——否则 Vite 见 stdin EOF 会自退。

端口由 `vite.config.ts:73,78` 读环境变量决定：`PI_WEB_DEV_CLIENT_PORT` 改 Vite 前端端口（默认 5173）、`PI_WEB_DEV_API_PORT` 改 Vite `/api` 代理**指向的**后端端口（默认 3000）。注意后端进程本身监听的是 `PORT`（`server/index.ts:100`，默认 3000，`dev-all.mjs` 未显式设置），因此要整体挪动后端端口须同时设 `PORT` 与 `PI_WEB_DEV_API_PORT` 保持一致，否则代理会指向空端口。

启动并验证：

```bash
pnpm dev
# 终端出现两个进程日志：Vite (5173) + API (3000)
# 浏览器打开 http://localhost:5173 —— 应看到选源页
```

**预期结果**：浏览器 5173 呈现选源页；打开 3000 只有 API 响应。开发期无共享构建缓存，因此可随时另开终端跑 `pnpm build:dist` 而不会污染开发态（这正是脱离 Next 后消失的那类 dev 冲突，见 `vite.config.ts:74-75` 注释）。

> 纯前端调试（不带 API）用 `pnpm dev:client`（仅 `vite`）；纯后端热跑用 `pnpm dev:server`（jiti 直跑 `server/index.ts`）。快速开始的完整跑通流程见 [01 快速开始](./01-quickstart.md)。

---

## 22.3 构建管线：`build:dist` 五步

生产构建入口是 `pnpm build`（= `pnpm build:dist`）；`pnpm build:cli` 是 `build:dist` 的别名（`package.json:20-33`）——没有独立的 CLI 构建路径。`build:dist` 串联五步：

| 步 | 脚本 | 产物 / 作用 |
|---|---|---|
| 1 | `build:client`（`vite build`） | 前端产物 `dist/client`（默认，可经 `PI_WEB_CLIENT_OUT` 覆盖） |
| 2 | `build:server`（`node scripts/build-server.mjs`） | esbuild 打**单文件** `dist/server.mjs`（bundle + esm + node22） |
| 3 | `node scripts/pack-dist.mjs` | 按原始 pnpm 布局收集运行时依赖并剪枝 |
| 4 | `build:unpacker`（`node scripts/build-unpacker.mjs`） | 打出零依赖单文件解包器 `payload/unpack.mjs` |
| 5 | `build:payload`（`node scripts/pack-payload.mjs`） | 压成随包载荷 `payload/dist.tar.zst` + `payload.json` |

关键约束：

- **入口 `dist/server.mjs` 必须在产物根**——`build-server.mjs` 内联 `import.meta.url` 后其回退路径是 `process.cwd()`，入口挪位会解析失败；
- esbuild `external` = pi SDK 两包 + `jiti` + `pg`（这些保持外置，不打进单文件）；
- 步骤 3–5 的随包压缩载荷 + 首启解包机制服务于 CLI 与桌面版分发，细节见 [18 CLI](./18-cli.md) 与 [20 桌面版（Tauri）](./20-desktop-tauri.md)。

本地启动构建产物：

```bash
pnpm build:dist
node dist/server.mjs      # 等价于 pnpm start，浏览器打开 http://localhost:3000
```

> **产物隔离**：需要一份不覆盖开发态 `dist/` 的独立产物（如 e2e 专用）时，用 `PI_WEB_DIST_DIR` 指向另一个目录（`playwright.config.ts:65`，默认 `dist`）。不存在 `NEXT_DIST_DIR` / `.next-cli` / `.next-e2e` / `pack-standalone.mjs` 这类 Next 时代概念，也不存在「dev 期跑 build 污染 `.next` 致 webpack 500」的旧告诫——现在无共享构建缓存。

---

## 22.4 测试分层策略（硬性要求）

每个 Kiro spec **必须**同时满足以下三层，并以**新鲜运行证据**（实际终端输出或日志片段）证明通过，参见 `kiro-verify-completion` 协议：

| 层次 | 脚本 | 运行环境 | 覆盖目标 |
|---|---|---|---|
| **单元 / 集成** | `pnpm test:app`（Vitest） | jsdom | 前端翻译层纯函数、页面渲染冒烟、handler 集成 |
| **Node 级 e2e** | `pnpm e2e:node`（Vitest） | Node | 真实 `createPiWebHandler` 的 HTTP/SSE 全链路（离线 stub） |
| **浏览器 e2e** | `pnpm e2e`（Playwright） | Chromium | 选源 → prompt → 流式回复闭环 |

vite-spa 迁移与两种分发形态另有专项 e2e（22.4.5 / 22.4.6），也应随相关 spec 纳入。

### 22.4.1 单元 / 集成测试

配置文件 `vitest.config.ts`：环境 `jsdom`、`include: test/**/*.test.ts(x)`、`setupFiles: test/setup.ts`。alias 表把 raw-TS 的 `@blksails/pi-web-*` 包（含 canvas-kit / canvas-ui 子路径）显式映射到源文件——Vitest 不读 `tsconfig` paths，须逐条 alias（`vitest.config.ts:14-29`）。

```bash
pnpm test:app          # 仅主应用测试（vitest run）
pnpm test              # 递归全部 workspace 包（--workspace-concurrency=1）
```

主应用测试覆盖示例（`test/`）：

- `chat-app.test.tsx` — ChatApp 组件渲染；
- `route.integration.test.ts` — catch-all 会话路由转发到 `createPiWebHandler` 并原样返回 Response（含 SSE 流）+ 配置注入 / 密钥脱敏检查；
- `bootstrap-gate.test.tsx` / `runtime-features.test.ts` — `GET /api/bootstrap` 运行时门控下发（取代旧的构建期 `NEXT_PUBLIC_*` 内联）；
- `attachment-handler-assembly.test.ts`、`system-resource-args.test.ts`。

### 22.4.2 后端 RPC 桥集成测试（`packages/server`）

各子包在自身目录下运行 `vitest run`，测试目录 `packages/server/test/`：

```
test/
├── rpc-channel/
│   ├── pi-rpc-process.unit.test.ts   # PiRpcProcess 消息路由单元测试
│   ├── pi-rpc-process.e2e.test.ts    # spawn → prompt → abort 真实子进程 e2e
│   └── fixtures/rpc-stub-process.mjs # 固定响应桩（无需 API Key）
├── session/
│   ├── pi-session.lifecycle.test.ts
│   └── mock-channel.ts               # PiRpcChannel mock 实现
└── session-store/
    ├── fs-store.test.ts
    └── sqlite-store.test.ts
```

**关键原则**：后端 RPC 桥用真实子进程做集成测试，而非 mock 进程。`PiRpcProcess` e2e 支持双模式：

- 默认 `STUB`（`packages/server/test/rpc-channel/fixtures/rpc-stub-process.mjs` 固定响应，无需 API Key）；
- `PI_WEB_LIVE=1 ANTHROPIC_API_KEY=... pnpm -C packages/server test` 切换为真实 `pi --mode rpc`。

### 22.4.3 Node 级 e2e

配置文件 `vitest.node-e2e.config.ts`：环境 `node`、`include: e2e/node/**/*.test.ts`、超时 30 秒。脚本已内置 stub（`cross-env PI_WEB_STUB_AGENT=1`，跨平台）：

```bash
pnpm e2e:node   # 无需 API Key、无需浏览器
```

驱动真实 `createPiWebHandler` 的完整 HTTP/SSE 链路。当 Playwright 下载受限或 CI 无头环境有问题时，此层可作为流式链路验证的替代证据。示例（`e2e/node/`）：

- `streaming.e2e.test.ts` — 创建会话 → POST prompt → 消费 SSE → 断言 `text-delta` / `reasoning-delta` / `tool-input-available` 帧及权限对话回环；
- `config-domains.e2e.test.ts`、`attachment-completion.e2e.test.ts`；
- `state-bridge.e2e.test.ts` — 状态注入桥 `POST /sessions/:id/state` 写回 + `control:state` 下行镜像；
- `vision-tool.e2e.test.ts` / `vision-models-endpoint.e2e.test.ts` — `image_vision` 工具与 `GET /vision/models` 枚举。

### 22.4.4 浏览器 e2e（Playwright）

配置文件 `playwright.config.ts`：`testDir: e2e/browser`、`testMatch: *.e2e.ts`、超时 60 秒（断言 15 秒）、`workers: 1`（顺序执行，避免服务端状态竞争）。浏览器对**真实 pi-web 服务器 + 确定性离线 stub agent**（`PI_WEB_STUB_AGENT=1`）驱动闭环，无 API Key、无费用。

双后端会话持久化项目（`playwright.config.ts:93-110`）：

| 项目名 | 端口 | `SESSION_STORE` |
|---|---|---|
| `fs` | `3100`（`PI_WEB_E2E_PORT` 起始） | `fs` + 临时 `SESSION_STORE_ROOT` |
| `sqlite` | `3101` | `sqlite` + 临时 `SESSION_STORE_PATH` |

`session-persistence.e2e.ts` 在两个项目都跑（persist → URL → 冷恢复 → 续聊每个后端各验一遍），其余 spec 仅跑 `fs`。

**自管服务器模式**（Playwright 自己起服务器）：

```bash
pnpm exec playwright install chromium-headless-shell
pnpm build:dist && pnpm e2e
```

**外部服务器模式**（CI / 需保持一个服务器常驻时；取自 `playwright.config.ts:19-25`）：

```bash
pnpm build:dist

# 起两个 stub 服务器（node dist/server.mjs，PI_WEB_CLIENT_DIR 指向前端产物）
PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  PI_WEB_CLIENT_DIR="$PWD/dist/client" \
  SESSION_STORE=fs SESSION_STORE_ROOT=/tmp/e2e-fs \
  PORT=3100 node dist/server.mjs &

PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
  PI_WEB_CLIENT_DIR="$PWD/dist/client" \
  SESSION_STORE=sqlite SESSION_STORE_PATH=/tmp/e2e.db \
  PORT=3101 node dist/server.mjs &

# 跑测试（复用已起的外部服务器）
PI_WEB_E2E_EXTERNAL_SERVER=1 \
  PI_WEB_E2E_FS_ROOT=/tmp/e2e-fs \
  PI_WEB_E2E_SQLITE_PATH=/tmp/e2e.db \
  pnpm e2e
```

**预期结果**：`fs` 项目跑全部 spec、`sqlite` 项目仅跑持久化 spec，全绿。注意 `node dist/server.mjs` 以仓库根为 cwd 启动，其 `clientDir()` 默认取 `cwd/client`（不存在），因此外部服务器模式**必须**设 `PI_WEB_CLIENT_DIR` 指向 `dist/client`，否则前端产物 404。

浏览器 e2e 示例（`e2e/browser/`）：`rich-chat.e2e.ts`（选源→prompt→流式闭环）、`session-persistence.e2e.ts`（冷恢复）、`extension-ui-surfaces.e2e.ts`（Web 扩展渲染）、`message-queue.e2e.ts`、`aigc-canvas.e2e.ts` / `canvas-plugin-stickers.e2e.ts`。

> 若 Playwright 端口被占或下载受限，先用上文外部服务器模式，或退回 `pnpm e2e:node`。测试与工具链类问题汇总见 [23 · 测试与工具链问题](./23-troubleshooting-faq.md)。

### 22.4.5 生产 CSP 回归（`e2e:csp`）

vite-spa 迁移把生产 CSP 收紧为「禁 `unsafe-eval` + 去 `script-src` 的 `unsafe-inline`」，改为对内联 import map 做 sha256 hash 放行（`server/static.ts`）。这条安全回归专门验证 import map 在收紧后的 CSP 下仍被浏览器应用、且无内联脚本违规：

```bash
node dist/server.mjs &                       # 需生产构建产物
node e2e/csp/import-map-csp.mjs http://localhost:3000
```

它直接盯浏览器控制台：收集 CSP 违规（`Refused to execute inline script`）并断言 import map 已生效（`e2e/csp/import-map-csp.mjs:1-14`）。CSP 相关的生产白屏 / 扩展静默失效排查见 [23 故障排查](./23-troubleshooting-faq.md)。

### 22.4.6 CLI 与桌面版 / 载荷 e2e

随包压缩载荷 + 首启解包机制、CLI 启动器与 Tauri 桌面壳各有独立的黑盒 e2e（均为 `.mjs`，`node` 直跑）：

| 脚本 | 文件 | 验证 |
|---|---|---|
| `e2e:cli` | `e2e/cli/cli-smoke.mjs` | CLI 冒烟启动 |
| `e2e:cli:watch` | `e2e/cli/cli-watch.mjs` | `--watch` 热重载 |
| `e2e:cli:real` / `e2e:cli:reloc` | `e2e/cli/cli-real.mjs` / `cli-reloc.mjs` | 真实模式 / 可重定位产物 |
| `e2e:runtime:conc` | `e2e/runtime-payload/concurrency.mjs` | 首启解包并发锁 |
| `e2e:runtime:recovery` | `e2e/runtime-payload/recovery.mjs` | 解包崩溃后恢复 |
| `e2e:desktop:real` | `e2e/desktop/desktop-real.mjs` | 未打包壳拉起本地会话、无孤儿退出 |
| `e2e:desktop:packaged` | `e2e/desktop/desktop-packaged.mjs` | 打包态从随包资源拉后端 |
| `e2e:desktop:nonode` / `:corrupt` | `desktop-no-node.mjs` / `desktop-corrupt-payload.mjs` | 缺 sidecar / 载荷损坏的判别式错误码 |
| `e2e:desktop:webdriver` | `e2e/desktop/webdriver/bridge.e2e.mjs` | 桌面目录选择桥 |

桌面版整体形态、随包 Node sidecar 与解包错误码见 [20 桌面版（Tauri）](./20-desktop-tauri.md)；CLI 启动与首启解包见 [18 CLI](./18-cli.md)。

> `e2e/parity/compare.mjs` 与 `e2e/review/webext-review.mjs` 是对照 / 检阅辅助工具（非门槛回归测试），按需手动运行。

---

## 22.5 脚本一览

`package.json` `scripts` 常用条目：

| 脚本 | 命令 | 说明 |
|---|---|---|
| `dev` | `node scripts/dev-all.mjs` | 双进程：Vite 前端 :5173 + API :3000（浏览器开 5173） |
| `dev:client` | `vite` | 仅前端 dev |
| `dev:server` | jiti 直跑 `server/index.ts` | 仅后端 API 宿主 |
| `build` / `build:cli` | `pnpm build:dist` | 生产构建（二者等价） |
| `build:dist` | client + server + pack-dist + unpacker + payload | 五步构建管线（22.3） |
| `build:client` | `vite build` | 前端产物 `dist/client` |
| `build:server` | `node scripts/build-server.mjs` | esbuild 单文件 `dist/server.mjs` |
| `build:unpacker` / `build:payload` | `build-unpacker.mjs` / `pack-payload.mjs` | 载荷解包器 + 压缩载荷 |
| `start` / `start:dist` | `node dist/server.mjs` | 启动生产服务器 |
| `start:cli` | `node bin/pi-web.mjs` | 启动全局 CLI |
| `typecheck` | `pnpm -r run typecheck && tsc -p tsconfig.json --noEmit` | 全量类型检查 |
| `test` | `pnpm -r --workspace-concurrency=1 run test` | 全 workspace 测试 |
| `test:app` | `vitest run` | 主应用单元 / 集成测试 |
| `e2e` | `playwright test` | 浏览器 e2e（需先 `build:dist`） |
| `e2e:build` | `pnpm build:dist && playwright test` | 构建后立即 e2e |
| `e2e:node` | `cross-env PI_WEB_STUB_AGENT=1 vitest run -c vitest.node-e2e.config.ts` | Node 级 e2e |
| `e2e:csp` | `node e2e/csp/import-map-csp.mjs` | 生产 CSP import map 放行回归 |
| `e2e:cli` / `:watch` / `:real` / `:reloc` | `node e2e/cli/*.mjs` | CLI 冒烟 / 热重载 / 真实 / 重定位 |
| `e2e:desktop:*` | `node e2e/desktop/*.mjs` | 桌面壳 e2e（real / packaged / no-node / corrupt / webdriver） |
| `e2e:runtime:conc` / `:recovery` | `node e2e/runtime-payload/*.mjs` | 首启解包并发 / 恢复 |
| `desktop:sidecar` / `desktop:build` | fetch sidecar / `tauri build` | 桌面版 Node 运行时与打包 |

---

## 22.6 接口 Seam（可测试性边界）

以下接口是单元测试的关键注入点，任何实现必须满足接口契约，不得绕过：

### PiRpcChannel

定义于 `packages/server/src/rpc-channel/pi-rpc-channel.ts`：

```typescript
interface PiRpcChannel {
  send(line: string): void;
  onLine(listener: LineListener): Unsubscribe;
  close(): Promise<void>;
  health(): ChannelHealth;
}
```

`PiRpcProcess` 是本地子进程实现；测试中用 `packages/server/test/session/mock-channel.ts` 替换，无需真实子进程。

### SessionStore / SessionEntryStore

定义于 `packages/server/src/session-store/`，后端支持 `fs` / `sqlite` / `postgres` 三种。通过 `SESSION_STORE` 环境变量切换；`SESSION_STORE_ROOT`（fs）或 `SESSION_STORE_PATH`（sqlite）指定路径。

### BlobStore

端口接口 `BlobStore` 定义于 `packages/server/src/attachment/blob-store.ts`；当前实现 `LocalFsBlobBackend` 在 `packages/server/src/attachment/local-fs-backend.ts`（S3 等后端接口预留）。通过 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET` 配置，主进程与子进程必须一致（否则签名 URL 401）。

---

## 22.7 Kiro Spec-Driven 流程简介

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
/kiro-spec-init "功能描述"        # 1. 初始化新 spec
/kiro-spec-requirements <feature> # 2. 生成需求（EARS 格式）
/kiro-validate-gap <feature>      # 3. 分析与现有代码库的差距（可选）
/kiro-spec-design <feature>       # 4. 生成设计文档
/kiro-spec-tasks <feature>        # 5. 生成实现任务
/kiro-spec-status <feature>       # 6. 查看进度
/kiro-spec-quick <feature> --auto # 7. 快捷路径（全自动，跳过逐步审批）
```

`spec.json` 记录当前阶段与审批状态，`phase: "implemented"` 表示完成。以 `rpc-channel` spec（`.kiro/specs/rpc-channel/spec.json`）为例，其 `approvals` 字段记录 requirements / design / tasks 三阶段均已批准。

### 实现阶段要求

- 后端 RPC 桥实现需配合 `packages/server/test/rpc-channel/` 下的集成 / e2e 测试；
- 前端翻译层（event → UIMessage）用纯函数单测覆盖；
- 闭环验证使用 `PI_WEB_STUB_AGENT=1`，无需 API Key 或费用；
- 每个 spec 完成后调用 `/kiro-verify-completion` 提供新鲜运行证据。

---

## 下一步 / 相关

- 5 分钟跑通第一条流式回复（`pnpm dev` 完整流程） → [01 快速开始](./01-quickstart.md)
- 后端 RPC 通道与会话引擎、Vite/Hono/esbuild 架构 → [03 架构](./03-architecture.md)
- `packages/server`、`packages/protocol` 等 11 个子包边界 → [05 包结构](./05-packages.md)
- `SESSION_STORE`、`PI_WEB_ATTACHMENT_DIR`、`PI_WEB_DIST_DIR` 等环境变量 → [06 配置](./06-configuration.md)
- `bin/pi-web.mjs` 启动器与首启解包 → [18 CLI](./18-cli.md)
- `dist/server.mjs` 产物结构、随包载荷与生产 CSP → [19 部署](./19-deployment.md)
- 桌面版（Tauri）打包、sidecar 与桌面 e2e → [20 桌面版](./20-desktop-tauri.md)
- 测试环境日志配置 → [21 日志](./21-logging.md)
- 构建 / e2e 端口冲突、CSP 白屏等问题排查 → [23 常见问题](./23-troubleshooting-faq.md)
