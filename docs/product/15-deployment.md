# 15 · 部署与运维

本章覆盖从本地构建到生产容器的完整部署路径：standalone 产物打包、隔离构建目录约定、拓扑约束、生产硬化要点。

---

## 15.1 拓扑约束：有状态长连接

pi-web 的核心约束来自其架构：**每个会话对应一个常驻 pi 子进程**，进程的 LLM 上下文与工具状态存活于某一实例的内存中。

- **不能部署为 Serverless/Edge Function**（除非走控制面/数据面分离，见 §15.9）。
- **横向扩容必须按 `sessionId` 做 sticky routing（会话亲和）**，否则 SSE 流和后续命令会被路由到没有该子进程的实例，导致 404 或静默断连。
- 推荐部署形态：`next build` 的 standalone output + 长驻 Node 服务（Docker / K8s Deployment + Session-Affinity）。

> 技术依据：`next.config.ts` 注释与 PLAN.md §11.1。

---

## 15.2 隔离构建目录约定

pi-web 使用 `NEXT_DIST_DIR` 环境变量切换构建输出目录，避免不同构建场景互相污染：

| 场景 | `NEXT_DIST_DIR` | 产物位置 |
|---|---|---|
| 日常开发（`next dev`） | `.next`（默认） | `.next/` |
| 生产 CLI standalone 构建 | `.next-cli` | `.next-cli/standalone/` |
| 浏览器 e2e 隔离构建 | `.next-e2e` | `.next-e2e/` |
| stub dev（UI 测试） | `.next-stub` | `.next-stub/` |

`next.config.ts:55`：
```ts
distDir: process.env.NEXT_DIST_DIR ?? ".next",
```

**关键规则：开发期（`next dev` 进行时）切勿执行 `next build`。** 两者共享 `.next/` 缓存目录，并发写入会导致 webpack 500 或产物损坏。需要构建时，请先停止 dev 进程，或通过 `NEXT_DIST_DIR` 切换到隔离目录（如 `.next-cli`）。

---

## 15.3 构建 Standalone 产物

### 15.3.1 next.config.ts 关键配置

`next.config.ts` 已配置 `output: "standalone"`，构建时自动生成最小化 Node 服务器产物。关键配置项（已在仓库中生效，无需修改）：

```ts
// next.config.ts
output: "standalone",
outputFileTracingRoot: path.resolve(),
outputFileTracingIncludes: {
  "/**/*": [
    "./packages/server/runner-bootstrap.mjs",
    "./packages/server/src/**/*",
    "./packages/server/node_modules/@earendil-works/**/*",
    "./packages/server/node_modules/jiti/**/*",
    "./packages/agent-kit/**/*",
    "./packages/tool-kit/**/*",
    "./examples/**/*",
  ],
},
```

`outputFileTracingIncludes` 的作用：nft（Node File Tracing）默认追踪不到会话激活时由主进程 spawn 的子进程依赖（jiti 运行时 import 的 runner 源码、pi SDK），必须显式纳入，否则 standalone 下真实会话无法启动。

### 15.3.2 构建步骤

**步骤 1：安装依赖**
```bash
# 仓库使用 pnpm（package.json packageManager: pnpm@9.12.0）
pnpm install --frozen-lockfile
```

**步骤 2：执行 CLI standalone 构建**
```bash
# 在 pi-web 应用根目录执行
pnpm build:cli
# 等价于：
NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs
```

`build:cli` 脚本做两件事：
1. 以 `.next-cli` 为输出目录执行 `next build`，产出 `.next-cli/standalone/`。
2. 执行 `scripts/pack-standalone.mjs`（`scripts/pack-standalone.mjs`）：将 `.next-cli/static/` 复制到 standalone 内对应位置，并复制 `public/`——这是 Next.js standalone 产物的必要收尾步骤，否则页面样式和公共资源缺失。

**步骤 3：验证产物**
```bash
ls .next-cli/standalone/server.js   # 入口文件存在即成功
```
预期：打印出 `.next-cli/standalone/server.js` 路径（无 `No such file` 报错）。若构建期报 webpack 500 / 产物损坏，多半是 dev 进程仍在跑、污染了 `.next/`（见 §15.2），或排查 [18-troubleshooting-faq.md](./18-troubleshooting-faq.md)。

### 15.3.3 Standalone 产物结构

```
.next-cli/
└── standalone/
    ├── server.js                   # Next.js 自包含服务入口
    ├── package.json
    ├── .next-cli/                  # 运行时资源（server chunks 等）
    │   └── static/                 # 由 pack-standalone 脚本复制
    ├── public/                     # 由 pack-standalone 脚本复制
    ├── lib/                        # 应用运行时代码
    ├── examples/                   # outputFileTracingIncludes 纳入（内置示例 agent）
    ├── packages/                   # outputFileTracingIncludes 纳入的工作区包
    │   ├── server/
    │   │   ├── runner-bootstrap.mjs
    │   │   ├── src/
    │   │   └── node_modules/@earendil-works/   # pi-ai、pi-coding-agent（pi SDK）
    │   ├── agent-kit/
    │   ├── tool-kit/
    │   └── protocol/
    └── node_modules/               # 最小化运行时依赖
```
（上为代表性结构；实际产物以本机 `ls .next-cli/standalone/` 为准。）

---

## 15.4 运行 Standalone 服务

### 15.4.1 通过 CLI 启动（推荐）

`bin/pi-web.mjs` 是薄启动器，将命令行参数翻译为 env，再 spawn `standalone/server.js`：

```bash
# 启动，指向某个 agent 源目录
node bin/pi-web.mjs /path/to/agent-source -p 3000

# 或全局安装后：
pi-web /path/to/agent-source --port 3000 --host 0.0.0.0
```

| 选项 | 说明 | 默认值 |
|---|---|---|
| `[source]` | agent 源目录（省略则用 `cwd`） | `process.cwd()` |
| `-p, --port <n>` | 监听端口 | `3000` |
| `--host <h>` | 绑定主机 | `127.0.0.1` |
| `--cwd <dir>` | 会话工作目录 | 当前 `cwd` |
| `--agent-dir <d>` | pi agent 目录 | `~/.pi/agent` |
| `--open` | 启动后自动打开浏览器 | `false` |
| `--stub` | 以确定性 stub agent 运行（离线冒烟） | `false` |
| `--watch` | 热重载模式（监视 agent source 目录，变更自动重启 runner，仅本地目录） | `false` |

### 15.4.2 直接启动 server.js

```bash
PORT=3000 HOSTNAME=0.0.0.0 node .next-cli/standalone/server.js
```

---

## 15.5 环境变量清单

以下为部署相关的核心环境变量（完整配置说明见 [05-configuration.md](./05-configuration.md)）：

| 变量名 | 作用 | 默认值 |
|---|---|---|
| `PORT` | HTTP 服务监听端口 | `3000` |
| `HOSTNAME` | 绑定地址 | `127.0.0.1` |
| `NODE_ENV` | 运行模式（`production` 启用 CSP 等安全头） | — |
| `NEXT_DIST_DIR` | 构建输出目录（隔离多套 build 用） | `.next` |
| `PI_WEB_AGENT_DIR` | pi agent 配置根目录（替代 `~/.pi/agent`） | `~/.pi/agent` |
| `PI_WEB_DEFAULT_SOURCE` | 默认 agent 源目录 | 当前 `cwd` |
| `PI_WEB_DEFAULT_CWD` | 默认工作目录 | — |
| `PI_WEB_AUTOSTART` | `1` = 进入首页自动启动默认 agent 会话 | — |
| `PI_WEB_ATTACHMENT_DIR` | 附件落盘根目录 | `~/.pi/agent/attachments` |
| `PI_WEB_ATTACHMENT_SECRET` | 附件 HMAC 签名 secret（主/子进程必须一致） | 随机（单进程） |
| `PI_WEB_ATTACHMENT_URL_TTL_MS` | 附件签名 URL 有效期（毫秒） | `315360000000`（约 10 年） |
| `PI_WEB_ATTACHMENT_URL_BASE` | 附件 URL 基路径（子进程通过 spawn env 继承） | — |
| `PI_WEB_HIDE_PROVIDERS` | 逗号分隔的 provider 名，在模型列表中隐藏 | — |
| `PI_WEB_STUB_AGENT` | `1` = 使用 stub agent（UI 测试用，不启动真实 runner） | — |
| `PI_WEB_WATCH` | `1` = 开启 runner 热重载（生产 standalone 模式下的 `--watch`） | — |
| `PI_WEB_TRUST_PROJECT` | `1` = 信任 `.pi/` 项目扩展（custom agent 模式） | — |
| `PI_WEB_SANDBOX_ENTRY` | 沙箱入口路径（由主进程注入子进程，custom 模式） | — |
| `PI_CODING_AGENT_DIR` | pi SDK（子进程）读取的 agent 目录，由主进程通过 spawn env 注入（注意非 `PI_AGENT_DIR`） | `~/.pi/agent` |

> **两个 agent-dir 变量的区别**：`PI_WEB_AGENT_DIR` 是 pi-web 主进程读取的配置根目录（全局 settings、沙箱策略落盘，对应 CLI 的 `--agent-dir`，见 `bin/pi-web.mjs:130`、`packages/server/src/config/config-codec.ts:16`）；`PI_CODING_AGENT_DIR` 是主进程下发给 pi SDK 子进程的目录（trust store / session 落盘，见 `packages/server/test/agent-source/mode-trust.test.ts:159`）。多租户隔离时两者都应按租户区分（见 §15.6.4）。

> **注意**：`PI_WEB_ATTACHMENT_SECRET` 必须由主进程通过 spawn env 显式下发给子进程，主/子进程使用同一 secret，否则子进程产出的签名 URL 在主进程验证时 401。

---

## 15.6 生产硬化

### 15.6.1 安全沙箱（最高优先级）

生产环境**绝不能在宿主裸跑** pi-web：

- **agent 源 `index.ts`**：由 `jiti` 运行时载入即执行用户代码，等同 RCE。
- **pi 工具**（bash/write/edit）默认拥有完整系统权限。

沙箱选型（按隔离强度）：

| 方案 | 隔离粒度 | 适用场景 |
|---|---|---|
| 每会话独立容器（sidecar） | 进程级文件系统/网络 | 多租户 SaaS |
| Gondolin 微 VM（pi 扩展） | VM 级，工具路由进 VM | 强隔离 + 宿主保管 auth |
| OpenShell 沙箱 | 策略化（FS/网络/凭据/推理） | 托管/远程沙箱 |

最低要求：限定 `cwd` 工作区、容器只读根 + 可写工作卷、禁出网或按需放行。

### 15.6.2 优雅停机

响应 `SIGTERM` 的推荐顺序：

1. 停止接受新会话（拒绝新的 `POST /api/sessions`）。
2. 通知所有在线前端（SSE 推送关闭事件）。
3. 对所有子进程调用 `stop()`。
4. 关闭 SSE 连接，退出进程。

### 15.6.3 子进程资源限额

| 维度 | 手段 |
|---|---|
| 内存 / CPU | 容器 cgroups 限额 |
| bash 执行超时 | pi 工具内置超时配置 |
| 输出截断 | pi `fullOutputPath`（大输出写文件而非内联） |
| 并发上限 | 全局 + 每租户最大会话数，超限排队/拒绝 |
| 空闲回收 | N 分钟无活动 → `stop()` + 清出 registry |

### 15.6.4 密钥与多租户

- provider API key 经 `env` 注入子进程；**不要挂载宿主 `~/.pi/agent`**（会暴露 auth/session）。
- 每租户使用独立 `PI_CODING_AGENT_DIR`（隔离 settings/扩展/session）、独立 `cwd`、独立 auth。
- 推荐用 secret manager 动态注入，每容器独立 secret。

### 15.6.5 反向代理（SSE 关键配置）

SSE 长连接对反代有特殊要求：

```nginx
# nginx 示例
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_http_version 1.1;
proxy_set_header Connection "";
# 或通过响应头让 nginx 禁用缓冲
# add_header X-Accel-Buffering "no";
```

- 关闭代理缓冲（`proxy_buffering off`），否则 SSE 帧会被 buffer 住无法实时推送。
- 禁止对 SSE 端点启用 gzip 压缩。
- 配置定时 heartbeat 注释帧防止中间层断连。

---

## 15.7 容器镜像

### 15.7.1 基础镜像

```dockerfile
FROM node:24-bookworm-slim
```

运行时要求 Node >= 22.19.0（pi `engines` 约束）；`node:24-bookworm-slim` 满足此要求。

### 15.7.2 必要系统工具

pi 工具集（bash/git/ripgrep 等）需在镜像中预装：

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

### 15.7.3 最小 Dockerfile 示例

```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制 standalone 产物（已包含最小化 node_modules）
COPY .next-cli/standalone ./

# 附件存储挂载点
VOLUME ["/data/attachments"]

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PI_WEB_ATTACHMENT_DIR=/data/attachments

EXPOSE 3000

# 用 CLI 启动器，或直接 node server.js
CMD ["node", "server.js"]
```

> **注意**：镜像内不应包含 `~/.pi/agent`（避免 auth 泄露）；provider API key 通过容器 env 或 secret manager 注入。

---

## 15.8 可观测性与计费

- 通过 RPC `get_session_stats` 采集每会话 token/cost，用于配额管理、计费与限流。
- 建议采集的结构化日志事件：
  - 会话生命周期（create / idle-reclaim / stop / crash）
  - 扩展安装审计（谁、何时、装了什么源）
  - 子进程 stderr
  - auto-retry / compaction 事件
- 日志系统详见 [16-logging.md](./16-logging.md)。

---

## 15.9 边缘部署（控制面/数据面分离）

若需要 Edge/Serverless 上的无状态网关，需将控制面与数据面分离：

- **控制面**（可无状态，可上 Edge）：catalog 管理、鉴权/多租户、路由、计费。
- **数据面**（有状态）：到 agent 宿主的 RPC 通道（SSE/命令转发）；状态在宿主（sandbox/设备）里而非网关。

sticky routing 通过外置 SessionRouter（如 Redis-backed）解决，路由到正确的宿主实例。

---

## 下一步 / 相关文档

- [05-configuration.md](./05-configuration.md) — 完整环境变量与配置文件说明
- [14-cli.md](./14-cli.md) — `pi-web` CLI 全部选项与 `--watch` 热重载
- [16-logging.md](./16-logging.md) — 日志系统与结构化日志配置
- [17-development-and-testing.md](./17-development-and-testing.md) — 开发期构建隔离与 e2e 测试构建约定
- [18-troubleshooting-faq.md](./18-troubleshooting-faq.md) — 常见部署问题排查
