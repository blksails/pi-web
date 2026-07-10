# 19 · 部署与运维（Web 服务端）

本章讲 pi-web 作为 **Web 服务端**的构建与部署：`pnpm build:dist` 产出的 esbuild 单文件产物结构、生产运行方式、生产 CSP 硬化，以及有状态长连接带来的拓扑约束。桌面版（Tauri）是另一种交付形态，单独见 [20-desktop-tauri.md](./20-desktop-tauri.md)。

> 前端已是 Vite 驱动的 SPA，服务端宿主是 Hono（`server/index.ts` 一条 `app.all('/api/*')`），服务端由 esbuild 打成单文件 `dist/server.mjs`。**Next.js 已从 main 删除**——不存在 `.next*` 目录、`next build`、`NEXT_DIST_DIR`、`output: "standalone"`、`outputFileTracingIncludes` 或 `pack-standalone.mjs`。若你手头的旧文档/脚本还在提这些，一律作废。

---

## 19.1 拓扑约束：有状态长连接

pi-web 的核心约束来自其架构：**每个会话对应一个常驻 pi 子进程**，进程的 LLM 上下文与工具状态存活于某一实例的内存中（架构详见 [03-architecture.md](./03-architecture.md)）。

- **不能部署为 Serverless/Edge Function**（除非走控制面/数据面分离，见 §19.10）。这是与框架无关的真实约束：宿主进程需常驻、spawn 子进程、并持有 SSE 长连接。
- **横向扩容必须按 `sessionId` 做 sticky routing（会话亲和）**，否则 SSE 流和后续命令会被路由到没有该子进程的实例，导致 404 或静默断连。
- 推荐部署形态：`pnpm build:dist` 的 `dist/` 产物 + 长驻 Node 服务（Docker / K8s Deployment + Session-Affinity）。

---

## 19.2 构建：`pnpm build:dist`

生产构建是单一入口 `pnpm build:dist`（`package.json:22`），五步串联：

| 步骤 | 脚本 | 产物 |
|---|---|---|
| ① `build:client` | `vite build` | `dist/client/`（SPA 静态资源 + `public/`） |
| ② `build:server` | `node scripts/build-server.mjs` | `dist/server.mjs`（esbuild 单文件入口） |
| ③ pack-dist | `node scripts/pack-dist.mjs` | 收集 `packages/*`、`node_modules/` 到 `dist/`（按原始 pnpm 布局） |
| ④ `build:unpacker` | `node scripts/build-unpacker.mjs` | `payload/unpack.mjs`（解包器，供 CLI/桌面首启） |
| ⑤ `build:payload` | `node scripts/pack-payload.mjs` | `payload/dist.tar.zst` + `payload/payload.json`（随 npm 包分发的压缩载荷） |

对**服务端直接部署**而言，你只需要前三步产出的 `dist/` 目录：产物根是 `dist/`，可执行入口是 `dist/server.mjs`。步骤 ④⑤ 产出的 `payload/` 是随 npm 包分发给 **CLI** 的压缩载荷（`files: ["bin", "payload", "vite.config.ts"]`，`package.json:11-15`），首次运行 `pi-web` 时才由 `unpack.mjs` 解包到共享运行时目录——那条路径见 [18-cli.md](./18-cli.md)。

### 19.2.1 esbuild 单文件入口

`scripts/build-server.mjs` 用 esbuild 把 `server/index.ts` 打成 `dist/server.mjs`（`bundle` + `format: "esm"` + `target: "node22"`，`build-server.mjs:73-80`）。两个决定性约束：

1. **入口必须位于产物根**（`dist/server.mjs`，不能是 `dist/server/index.mjs`）。`packages/server` 的 `runnerBootstrapPath()` / `resolvePiCliEntry()` 采用「① 从 `import.meta.url` 推算 → ② 失败则回退 `process.cwd()`」。esbuild 会把 `import.meta.url` 内联为**构建机绝对路径**，异机必然失效，只能靠回退 ②，而 `bin/pi-web.mjs` 以 `dirname(serverJs)` 作 cwd——入口若在子目录，回退全部失效，真实会话必崩（`build-server.mjs:4-11`、`server/index.ts:15-19`）。
2. **external 清单**（`build-server.mjs:29-35`）：pi SDK 两包（`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`）+ `jiti` + `pg`/`pg-native` 保持 external。前三者由 agent 子进程在运行时经 jiti 动态 import，静态打包会破坏 pnpm 的 realpath 解析布局；`pg` 含可选的 `require('pg-native')`，避免 esbuild 静态解析失败。`zod` 纯 JS、`node:sqlite` 是内置，均安全 bundle。

### 19.2.2 构建步骤

**步骤 1：安装依赖**
```bash
# 仓库使用 pnpm（package.json packageManager: pnpm@9.12.0）
pnpm install --frozen-lockfile
```

**步骤 2：执行生产构建**
```bash
pnpm build:dist
```

**步骤 3：验证产物**
```bash
ls dist/server.mjs dist/client/index.html   # 两者都存在即成功
```
预期：打印出两条路径（无 `No such file` 报错）。`dist/server.mjs` 是可执行入口，`dist/client/` 是前端静态资源。若报错，见 [23-troubleshooting-faq.md](./23-troubleshooting-faq.md)。

### 19.2.3 产物结构

```
dist/                              ← cwd（server.mjs 以此为产物根启动）
├── server.mjs                     ← esbuild 单文件入口（唯一可执行入口）
├── client/                        ← vite 产物（含 public/ 的 webext-artifact/）
│   ├── index.html                 ← SPA 入口（内联单例 import map）
│   └── assets/                    ← 指纹化 JS/CSS（长缓存 immutable）
├── packages/<pkg>/{src,package.json,runner-bootstrap.mjs}
├── lib/app/stub-agent-process.mjs ← --stub 模式;stubAgentPath() 经 cwd 解析
└── node_modules/
    ├── @blksails/<pkg> → ../../packages/<pkg>   （相对链接，与源码树同构）
    └── <pi SDK 闭包>                             （hoist 自 .pnpm 同级兄弟）
```
（结构以 `scripts/pack-dist.mjs:11-30` 的注释契约为准；顶层条目集合即「产物根」的定义，少一个顶层条目不会报错，只会在某条运行时路径上**静默失败**。）

---

## 19.3 运行服务

### 19.3.1 直接启动（服务端部署推荐）

`dist/server.mjs` 是自包含入口，读 `PORT` 与 `HOST` 两个 env（`server/index.ts:100-101`）：

```bash
# 以产物根为 cwd 启动
cd dist && PORT=3000 HOST=0.0.0.0 NODE_ENV=production node server.mjs
```
仓库内也有等价脚本 `pnpm start`（= `node dist/server.mjs`，`package.json:25`）。启动成功打印 `pi-web on http://<host>:<port>`。

| Env | 作用 | 默认值 |
|---|---|---|
| `PORT` | HTTP 监听端口 | `3000` |
| `HOST` | 绑定地址 | `127.0.0.1` |
| `NODE_ENV` | `production` 时经 Hono 中间件注入生产 CSP（见 §19.5） | — |

> 服务端入口读的是 `HOST`（非 `HOSTNAME`）。通过 CLI（`pi-web`）启动时的 `--host` 选项映射与端口约定另见 [18-cli.md](./18-cli.md)。

### 19.3.2 通过 CLI 启动

若已全局安装 npm 包，`pi-web <source>` 会解析运行时、必要时首启解包载荷，再拉起 `dist/server.mjs`。完整选项（`-p`/`--host`/`--cwd`/`--stub`/`--watch` 等）与三级 `resolveRuntime` 解析见 [18-cli.md](./18-cli.md)。

---

## 19.4 运行时特性开关（`NEXT_PUBLIC_*` 语义已反转）

`NEXT_PUBLIC_PI_WEB_*` 前缀的变量名保留，但**语义已从「构建期内联」反转为「服务端运行时读取」**。前端启动时请求 `GET /api/bootstrap`，由服务端读 env 后下发（`server/bootstrap.ts:58-116`）。这意味着：

- **在运行时设置这些开关现在才真正生效**——例如 `NEXT_PUBLIC_PI_WEB_CANVAS=1 node dist/server.mjs` 才能打开 Canvas 面板。旧文档说的「构建期内联、CLI 运行时设无效」已不成立。
- 服务端权威门控（如 `PI_WEB_BASH_ENABLED`）与前端体验开关（如 `NEXT_PUBLIC_PI_WEB_BASH_ENABLED`）仍是两条独立变量：前者决定端点是否存在（关闭时 `POST /sessions/:id/bash` 返回 404），后者只影响 UI 提示。两者须同开方完整可用。

常见运行时开关：`NEXT_PUBLIC_PI_WEB_CANVAS`（Canvas 工作台，默认关）、`NEXT_PUBLIC_PI_WEB_SOURCE_PICKER`、`NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL`、`NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL`。完整清单见 [06-configuration.md](./06-configuration.md)。

---

## 19.5 生产 CSP 硬化

生产模式下（`NODE_ENV=production`），Hono 后置中间件对所有响应注入 `content-security-policy` 头，值由 `productionCsp()` 生成（`server/static.ts:178-192`、`server/index.ts:34,49-52`）。相较旧宿主收紧两处：

1. **禁 `unsafe-eval`**——代码 webext 经同源原生动态 import 加载，不需要它（P0 已实证：产物 0 个 `new Function` / `eval(`，注入一个即被浏览器拦截）。
2. **移除 `script-src` 的 `unsafe-inline`**——它在旧宿主里只为 Next 的内联 hydration bootstrap 存在。SPA 下唯一的内联脚本是 `index.html` 里的**单例 import map**（浏览器只认首个 import 之前的 import map，且外部 import map 支持面不足）。改为对它做 **sha256 hash 精确放行**：`inlineScriptHashes()` 读 `index.html`、正则抽出全部内联 `<script>`、逐个算 `'sha256-<base64>'` 拼进 `script-src`（`server/static.ts:124-164`）。

`style-src 'unsafe-inline'` 保留（Tailwind 运行时注入与 webext 的 scoped CSS 需要它）。完整策略：

```
default-src 'self';
script-src 'self' 'sha256-…';   ← 内联 import map 的 hash
style-src 'self' 'unsafe-inline';
connect-src 'self';
frame-src 'self' blob: data:;   ← artifact 隔离 iframe
img-src 'self' data: blob:;
object-src 'none';
base-uri 'self'
```

> **失败不静默降级，而是吵闹告警**：若 `index.html` 读不到内联脚本（`hashes.length === 0`），`inlineScriptHashes()` 会向 stderr 写警告而非退回 `script-src 'self'`（`server/static.ts:154-161`）。因为静默降级会禁掉 import map——页面看似正常，但运行时安装的代码 webext 全部加载失败。部署时若看到该告警，说明前端产物损坏，须重新 `pnpm build:client`。

### 19.5.1 验证 CSP 未误伤 import map

仓库自带一个直盯浏览器的回归检查 `pnpm e2e:csp`（`package.json:37` → `e2e/csp/import-map-csp.mjs`），它对生产模式实例断言「无 CSP 违规且 import map 已被应用」：

```bash
# 先在生产模式起一个实例（另一终端，cwd 必须是产物根 dist/，否则前端静态资源解析失败）
cd dist && NODE_ENV=production PORT=3100 node server.mjs
# 回到仓库根再跑检查（e2e 脚本随源码，不在 dist/ 内）
node e2e/csp/import-map-csp.mjs http://127.0.0.1:3100
```
预期：无违规、退出码 0。反证跑法 `PI_WEB_CSP_EXPECT_VIOLATION=1 node e2e/csp/import-map-csp.mjs <url>` 期望有违规。详见 [22-development-and-testing.md](./22-development-and-testing.md)。

---

## 19.6 环境变量清单

部署相关核心变量（完整说明见 [06-configuration.md](./06-configuration.md)）：

| 变量名 | 作用 | 默认值 |
|---|---|---|
| `PORT` | HTTP 监听端口 | `3000` |
| `HOST` | 绑定地址（服务端入口读此，非 `HOSTNAME`） | `127.0.0.1` |
| `NODE_ENV` | `production` 启用生产 CSP（§19.5） | — |
| `PI_WEB_AGENT_DIR` | pi-web 主进程配置根目录（对应 CLI `--agent-dir`） | `~/.pi/agent` |
| `PI_WEB_DEFAULT_SOURCE` | 默认 agent 源目录 | 当前 `cwd` |
| `PI_WEB_DEFAULT_CWD` | 默认工作目录 | — |
| `PI_WEB_AUTOSTART` | `1` = 进入首页自动启动默认 agent 会话 | — |
| `PI_WEB_ATTACHMENT_DIR` | 附件落盘根目录 | `~/.pi/agent/attachments` |
| `PI_WEB_ATTACHMENT_SECRET` | 附件 HMAC 签名 secret（主/子进程必须一致） | 随机（单进程） |
| `PI_WEB_ATTACHMENT_URL_BASE` | 附件 URL 基路径（子进程经 spawn env 继承） | — |
| `PI_WEB_HIDE_PROVIDERS` | 逗号分隔的 provider 名，在模型列表中隐藏 | — |
| `PI_WEB_STUB_AGENT` | `1` = 使用 stub agent（UI 测试用，不启动真实 runner） | — |
| `PI_WEB_BASH_ENABLED` | **服务端权威门控**：启用 bang shell 端点（等同 RCE）。关闭时 `POST /sessions/:id/bash` 返回 404 | —（关闭） |
| `PI_CODING_AGENT_DIR` | pi SDK（子进程）读取的 agent 目录，由主进程经 spawn env 注入（注意非 `PI_AGENT_DIR`） | `~/.pi/agent` |

> **两个 agent-dir 变量的区别**：`PI_WEB_AGENT_DIR` 是主进程读取的配置根（全局 settings、沙箱策略落盘）；`PI_CODING_AGENT_DIR` 是主进程下发给 pi SDK 子进程的目录（trust store / session 落盘）。多租户隔离时两者都应按租户区分（见 §19.7.4）。
>
> **注意**：`PI_WEB_ATTACHMENT_SECRET` 必须由主进程经 spawn env 显式下发给子进程，主/子进程使用同一 secret，否则子进程产出的签名 URL 在主进程验证时 401。
>
> `NEXT_PUBLIC_PI_WEB_*` 前缀的运行时特性开关见 §19.4 与 [06-configuration.md](./06-configuration.md)，不重复列出。

---

## 19.7 生产硬化

### 19.7.1 安全沙箱（最高优先级）

生产环境**绝不能在宿主裸跑** pi-web：

- **agent 源 `index.ts`**：由 `jiti` 运行时载入即执行用户代码，等同 RCE。
- **pi 工具**（bash/write/edit）默认拥有完整系统权限。

| 方案 | 隔离粒度 | 适用场景 |
|---|---|---|
| 每会话独立容器（sidecar） | 进程级文件系统/网络 | 多租户 SaaS |
| Gondolin 微 VM（pi 扩展） | VM 级，工具路由进 VM | 强隔离 + 宿主保管 auth |
| OpenShell 沙箱 | 策略化（FS/网络/凭据/推理） | 托管/远程沙箱 |

最低要求：限定 `cwd` 工作区、容器只读根 + 可写工作卷、禁出网或按需放行。

> **Bang shell 命令（`PI_WEB_BASH_ENABLED`）**：pi-web 的 `!`/`!!` 聊天命令直接在会话 agent 工作目录执行任意 shell，等同 RCE。**默认关闭**；关闭时 `POST /sessions/:id/bash` 返回 404，不泄露端点存在。多用户 / 公网部署一律保持关闭。变量详见 [06-configuration.md](./06-configuration.md)。

### 19.7.2 优雅停机

服务端已注册 `SIGTERM` / `SIGINT` 处理（`server/index.ts:107-113`）：`server.close()` 停止接受新连接 → `shutdownHandler()` 关闭所有子进程与句柄 → `process.exit(0)`。容器编排下发 `SIGTERM` 即可触发。若需在停机前额外通知在线前端（SSE 推送关闭事件），可在 `shutdownHandler` 上层扩展。

### 19.7.3 子进程资源限额

| 维度 | 手段 |
|---|---|
| 内存 / CPU | 容器 cgroups 限额 |
| bash 执行超时 | pi 工具内置超时配置 |
| 输出截断 | pi `fullOutputPath`（大输出写文件而非内联） |
| 并发上限 | 全局 + 每租户最大会话数，超限排队/拒绝 |
| 空闲回收 | N 分钟无活动 → `stop()` + 清出 registry |

### 19.7.4 密钥与多租户

- provider API key 经 `env` 注入子进程；**不要挂载宿主 `~/.pi/agent`**（会暴露 auth/session）。
- 每租户使用独立 `PI_CODING_AGENT_DIR`（隔离 settings/扩展/session）、独立 `cwd`、独立 auth。
- 推荐用 secret manager 动态注入，每容器独立 secret。

### 19.7.5 反向代理（SSE 关键配置）

```nginx
# nginx 示例
proxy_buffering off;
proxy_read_timeout 3600s;
proxy_http_version 1.1;
proxy_set_header Connection "";
# 或通过响应头让 nginx 禁用缓冲：add_header X-Accel-Buffering "no";
```

- 关闭代理缓冲（`proxy_buffering off`），否则 SSE 帧会被 buffer 住无法实时推送。
- 禁止对 SSE 端点启用 gzip 压缩。
- 配置定时 heartbeat 注释帧防止中间层断连。

---

## 19.8 容器镜像

仓库内不含 git-tracked 的 `Dockerfile`——以下为**参考示例**，容器化对象是 `pnpm build:dist` 产出的 `dist/` 目录。

### 19.8.1 基础镜像

运行时要求 Node ≥ 22.19.0（`package.json` `engines`）；esbuild 产物 `target: "node22"`。选 `node:22-bookworm-slim` 即满足。

### 19.8.2 参考 Dockerfile

```dockerfile
FROM node:22-bookworm-slim

# pi 工具集（bash/git/ripgrep 等）需预装
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ripgrep bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制自包含产物（含最小化 node_modules 与 client/）
COPY dist ./

# 附件存储挂载点
VOLUME ["/data/attachments"]

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PI_WEB_ATTACHMENT_DIR=/data/attachments

EXPOSE 3000

# 产物根即 WORKDIR，直接跑单文件入口
CMD ["node", "server.mjs"]
```

> **注意**：镜像内不应包含 `~/.pi/agent`（避免 auth 泄露）；provider API key 通过容器 env 或 secret manager 注入。

---

## 19.9 可观测性与计费

- 通过 RPC `get_session_stats` 采集每会话 token/cost，用于配额管理、计费与限流。
- 建议采集的结构化日志事件：会话生命周期（create / idle-reclaim / stop / crash）、扩展安装审计、子进程 stderr、auto-retry / compaction 事件。
- 日志系统详见 [21-logging.md](./21-logging.md)。

---

## 19.10 边缘部署（控制面/数据面分离）

若需要 Edge/Serverless 上的无状态网关，需将控制面与数据面分离：

- **控制面**（可无状态，可上 Edge）：catalog 管理、鉴权/多租户、路由、计费。
- **数据面**（有状态）：到 agent 宿主的 RPC 通道（SSE/命令转发）；状态在宿主（sandbox/设备）里而非网关。

sticky routing 通过外置 SessionRouter（如 Redis-backed）解决，路由到正确的宿主实例。

---

## 下一步 / 相关文档

- [06-configuration.md](./06-configuration.md) — 完整环境变量与配置文件说明
- [18-cli.md](./18-cli.md) — `pi-web` CLI、三级运行时解析、首启共享运行时解包
- [20-desktop-tauri.md](./20-desktop-tauri.md) — 桌面版（Tauri）打包与分发
- [21-logging.md](./21-logging.md) — 日志系统与结构化日志配置
- [22-development-and-testing.md](./22-development-and-testing.md) — 开发期双进程编排、构建管线与 e2e（含 `e2e:csp`）
- [23-troubleshooting-faq.md](./23-troubleshooting-faq.md) — 常见部署问题排查
