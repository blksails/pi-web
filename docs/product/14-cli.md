# 14 · 全局 CLI（standalone 模式）

`pi-web` 提供一个全局可安装的 CLI 入口，让你无需了解 Next.js 内部细节，一条命令即可在本地或 CI 中启动一个自包含的 pi-web 实例。

---

## 工作原理

`bin/pi-web.mjs` 是一个**薄启动器**，本身不含业务代码，只做三件事：

1. 用 `node:util.parseArgs` 解析命令行参数。
2. 调用 `buildEnv()` 把参数翻译为运行时环境变量（`PI_WEB_DEFAULT_SOURCE`、`PORT`、`HOSTNAME` 等）。
3. 用 `node:child_process.spawn` 拉起 `<distDir>/standalone/server.js`，业务代码零改动。

standalone 产物由 Next.js `output: "standalone"` 模式生成，构建后由 `scripts/pack-standalone.mjs` 补全静态资源，形成一个可脱离 monorepo 源码树独立运行的最小化服务包。

```
bin/pi-web.mjs                    ← 薄启动器（入口）
.next-cli/standalone/server.js    ← Next standalone 产物
scripts/pack-standalone.mjs       ← 构建后补全静态资源的收尾脚本
```

---

## 安装

### 前置条件

- Node.js >= 22.19.0
- pnpm >= 9（monorepo 构建时需要）

### 从源码构建并安装

> 当前包 `private: true`、版本 `0.0.0`，**尚未发布到 npm registry**，因此只能从 monorepo 源码构建后用 `npm link` 全局链接，暂不支持 `npm i -g pi-web`。

```bash
# 1. 构建 CLI 产物（隔离输出到 .next-cli，不影响 dev 的 .next）
pnpm build:cli
# 等价于:
# NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs

# 2. 全局链接（开发/调试用）
npm link

# 3. 验证
pi-web --version
pi-web --help
```

`package.json` 的 `bin` 字段声明：

```json
{
  "bin": {
    "pi-web": "bin/pi-web.mjs"
  }
}
```

`files` 字段限定了发布内容，确保只打包必要文件：

```json
{
  "files": [
    "bin",
    ".next-cli/standalone",
    "next.config.ts"
  ]
}
```

---

## 快速启动

```bash
# 用当前目录作为 agent source（最简用法）
pi-web

# 指定 agent source 目录，自定义端口，就绪后自动打开浏览器
pi-web ./examples/hello-agent -p 8080 --open

# 指定 agent source，绑定所有网卡
pi-web ./my-agent --host 0.0.0.0 -p 3000

# 使用 stub agent 离线冒烟（无需真实 pi 配置）
pi-web ./examples/hello-agent --stub

# 监视 agent source 目录，文件变化时热重载活跃会话
pi-web ./my-agent --watch
```

服务就绪后控制台输出：

```
[pi-web] 就绪 → http://127.0.0.1:3000
```

---

## 选项参考

| 选项 | 短标志 | 默认值 | 说明 |
|------|--------|--------|------|
| `[source]` | — | 当前目录 | agent source（本地目录或 git 来源） |
| `--port <n>` | `-p` | `3000` | 监听端口；端口被占用时自动递增查找空闲端口（最多尝试 20 个） |
| `--host <h>` | — | `127.0.0.1` | 绑定主机 |
| `--cwd <dir>` | — | 调用 CLI 时的工作目录 | 会话工作目录 |
| `--agent-dir <dir>` | — | `~/.pi/agent` | pi 配置目录 |
| `--open` | — | `false` | 服务就绪后用系统默认浏览器自动打开 |
| `--stub` | — | `false` | 以确定性 stub agent 运行（离线冒烟，无需真实 pi 配置） |
| `--watch` | — | `false` | 监视本地 agent source 目录，文件变化时重载活跃会话（仅本地目录有效） |
| `--help` | `-h` | — | 显示帮助并退出（退出码 0） |
| `--version` | `-v` | — | 显示版本号并退出（退出码 0） |

---

## 参数到环境变量的映射

`buildEnv()` 将 CLI 选项翻译为 Next.js 应用运行时读取的 env，实现解耦：

| CLI 选项 / 默认 | 环境变量 |
|----------------|---------|
| `source`（绝对化后） | `PI_WEB_DEFAULT_SOURCE` |
| `--cwd`（绝对化后） | `PI_WEB_DEFAULT_CWD` |
| `--port` | `PORT` |
| `--host` | `HOSTNAME` |
| CLI 启动时固定注入 | `PI_WEB_AUTOSTART=1`（跳过选源页，直接进会话） |
| `--agent-dir` | `PI_WEB_AGENT_DIR` |
| `--stub` | `PI_WEB_STUB_AGENT=1` |
| `--watch`（本地 source） | `PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS=<source>` |

> `source` 路径相对调用 CLI 时的工作目录（`baseCwd`）绝对化，因为 standalone server 进程的 cwd 会变为 standalone 目录。

---

## --watch 热重载

`--watch` 复用 dev runner 的热重载机制：

- 注入 `PI_WEB_WATCH=1` 解除 dev 环境门控。
- 注入 `PI_RUNNER_HOT_RELOAD_PATHS=<source>` 告知 watcher 监视路径。
- 文件变化时，空闲的 per-session runner 进程自动重启（续上会话，不新建）。

**限制**：`--watch` 仅对本地目录 source 有效。传入 git 来源时会打印告警并跳过文件监视。

---

## 构建详解

### 为什么需要隔离构建目录

```bash
NEXT_DIST_DIR=.next-cli next build
```

开发期 `next dev` 使用默认 `.next` 目录；CLI 产物写入 `.next-cli`，两者互不干扰。在 dev server 运行期间执行 `next build` 会污染共享 `.next`，导致 webpack 500 错误，因此必须隔离。

### standalone 产物与静态资源补全

Next.js `output: "standalone"` 不自带 `static/` 与 `public/`，`scripts/pack-standalone.mjs` 在构建后完成：

1. 校验 `<distDir>/standalone/server.js` 存在。
2. 复制 `<distDir>/static/` → `<distDir>/standalone/<distDir>/static/`。
3. 复制 `public/` → `<distDir>/standalone/public/`（若存在）。

### outputFileTracingIncludes — P0 关键配置

会话激活时主进程 spawn 的子进程（runner-bootstrap.mjs、pi SDK cli.js、jiti）是运行时动态进程，Next.js 的 nft（Node File Tracer）默认追踪不到。`next.config.ts` 中显式纳入：

```typescript
// next.config.ts
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

缺少此配置，standalone 产物下真实会话无法启动（子进程依赖文件缺失）。

---

## npm scripts 速查

| 命令 | 等价操作 |
|------|---------|
| `pnpm build:cli` | `NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs` |
| `pnpm start:cli` | `node bin/pi-web.mjs` |
| `pnpm e2e:cli` | `node e2e/cli/cli-smoke.mjs` |
| `pnpm e2e:cli:watch` | `node e2e/cli/cli-watch.mjs` |

---

## E2E 验收

`e2e/cli/cli-smoke.mjs` 覆盖完整启动链路，可重复运行（产出新鲜证据截图）：

```bash
# 前置：先构建
pnpm build:cli

# 运行冒烟
pnpm e2e:cli
```

冒烟覆盖：

1. **产物完整性** — 验证 `server.js`、`runner-bootstrap.mjs`、pi SDK `cli.js`、`jiti` 均在 standalone 目录中。
2. **参数路径** — `--help`/`--version` 退出码 0；未知参数退出非 0 且不启动服务器。
3. **stub 启动 + 浏览器冒烟** — CLI 启动 standalone → 浏览器加载 → 默认 source 激活会话 → 发消息 → 收到 stub 流式回包。

证据截图保存至 `.kiro/specs/pi-web-cli/evidence/cli-smoke-repeatable.png`。

`e2e/cli/cli-watch.mjs` 专项验证 `--watch` 热重载行为。

---

## 常见问题

> 以下是 CLI 特有的高频问题；更多启动 / 会话排查见 [18 · 故障排查 FAQ](./18-troubleshooting-faq.md)。

**Q：启动时报 `未找到自包含产物 .next-cli/standalone/server.js`**

A：尚未构建，请先执行 `pnpm build:cli`。

**Q：端口被占用怎么办**

A：CLI 会自动从指定端口（默认 3000）起递增查找空闲端口，最多尝试 20 个，并在控制台提示实际使用的端口。若 20 个端口均被占用，请用 `-p` 指定其他范围。

**Q：`--watch` 不生效**

A：确认 `source` 是本地目录路径，而非 `git:` / `https:` 等 git 来源。git 来源无本地目录可监视，CLI 会打印告警并跳过。

---

## 下一步 / 相关文档

- [05 · 配置](./05-configuration.md) — `PI_WEB_DEFAULT_SOURCE`、`PI_WEB_AUTOSTART` 等 env 变量的完整说明
- [15 · 部署](./15-deployment.md) — 生产环境部署、Docker 打包
- [17 · 开发与测试](./17-development-and-testing.md) — dev 模式运行、`NEXT_DIST_DIR` 隔离构建原理
- [18 · 故障排查 FAQ](./18-troubleshooting-faq.md) — 更多启动问题排查
