# 14 · 全局 CLI（standalone 模式）

`pi-web` 提供一个全局可安装的 CLI 入口，让你无需了解 Next.js 内部细节，一条命令即可在本地或 CI 中启动一个自包含的 pi-web 实例。

---

## 工作原理

`bin/pi-web.mjs` 是一个**薄启动器**，本身不含业务代码（`bin/pi-web.mjs:1-12`），只做三件事：

1. 用 `node:util.parseArgs` 解析命令行参数（`parseCliArgs`，`bin/pi-web.mjs:46`）。
2. 调用 `buildEnv()` 把参数翻译为运行时环境变量（`bin/pi-web.mjs:107`）：`PI_WEB_DEFAULT_SOURCE`、`PORT`、`HOSTNAME` 等，业务代码经 `loadConfig()` 读取，二者解耦。
3. 用 `node:child_process.spawn` 以 `process.execPath`（当前 Node）拉起 `<distDir>/standalone/server.js`（`launch`，`bin/pi-web.mjs:221`），子进程 `cwd` 设为 standalone 目录，`stdio: "inherit"`，业务代码零改动。

`parseCliArgs` 与 `buildEnv` 是**纯函数并被导出**以便单测；所有副作用（spawn / open / 端口探测）集中在 `launch` / `main`，仅在作为程序入口执行时触发（`bin/pi-web.mjs:347-360` 用 `realpathSync` 解析符号链接后比对 `import.meta.url`，确保经 `npm link` 全局安装后入口判定仍成立）。

standalone 产物由 Next.js `output: "standalone"` 模式生成（`next.config.ts:60-61`），构建后由 `scripts/pack-standalone.mjs` 补全静态资源并瘦身，形成一个可脱离 monorepo 源码树独立运行的最小化服务包。启动器解析产物路径时 `NEXT_DIST_DIR` 默认 `.next-cli`（`bin/pi-web.mjs:211-215`），与 dev 的 `.next` 隔离。

```
bin/pi-web.mjs                    ← 薄启动器（入口）
.next-cli/standalone/server.js    ← Next standalone 产物
scripts/pack-standalone.mjs       ← 构建后补全静态资源 + 瘦身的收尾脚本
```

---

## 安装

### 前置条件

- Node.js >= 22.19.0
- pnpm >= 9（monorepo 构建时需要）

### 从 npm 全局安装（推荐）

CLI 以 `@blksails/pi-web` 名发布到公共 npm registry（`package.json:2` `publishConfig.access: "public"`），可直接全局安装：

```bash
npm i -g @blksails/pi-web
# 或
pnpm add -g @blksails/pi-web

pi-web --version   # 0.1.2
pi-web --help
```

发布包内只含 standalone 自包含产物，**不需要** monorepo 源码即可运行。

### 从源码构建并链接（开发/调试）

如需基于本地改动调试 CLI，可从 monorepo 构建后用 `npm link` 全局链接：

```bash
# 1. 构建 CLI 产物（隔离输出到 .next-cli，不影响 dev 的 .next）
pnpm build:cli
# 等价于:
# NEXT_DIST_DIR=.next-cli next build && NEXT_DIST_DIR=.next-cli node scripts/pack-standalone.mjs

# 2. 全局链接
npm link

# 3. 验证
pi-web --version
pi-web --help
```

`package.json:8-15` 的 `bin` 与 `files` 字段共同决定发布形态——`bin` 把命令名指向薄启动器，`files` 把发布内容收紧到三项，只随包分发 standalone 产物与配置：

```json
{
  "name": "@blksails/pi-web",
  "version": "0.1.2",
  "bin": { "pi-web": "bin/pi-web.mjs" },
  "files": ["bin", ".next-cli/standalone", "next.config.ts"],
  "publishConfig": { "access": "public" }
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

**限制**：`--watch` 仅对本地目录 source 有效。传入 git 来源时，`main()` 打印告警并跳过文件监视（`bin/pi-web.mjs:334-336`），同时 `buildEnv()` 静默不注入 watch env（`bin/pi-web.mjs:138-141`）。

### 回合安全（不打断进行中的会话）

热重载只在 runner **空闲**时才真正重启，避免半途中断流式回包或工具调用。`PiRpcProcess`（`packages/server/src/rpc-channel/pi-rpc-process.ts:122`）跟踪 `agent_start..agent_end` 区间为 `turnActive`（`pi-rpc-process.ts:511-512`），并把 `requestRestart` 的「忙」判断从「有待决命令」扩展为「**有待决命令 OR 回合进行中**」（`pi-rpc-process.ts:198-201`）：

- 回合进行中（流式 token / 工具调用 / 等待 extension_ui 应答）时收到重启请求，延迟到 `agent_end` 之后执行。
- 仅靠 `pendingCommands` 不够——prompt 立即 ack、增量全走 event 流，回合中 `pendingCommands` 为空会被误判为空闲，从而中断回合、丢失信息。
- `maybeRestartWhenIdle`（`pi-rpc-process.ts:209-213`）在命令结算与回合结束后（`pi-rpc-process.ts:500`、`pi-rpc-process.ts:514`）统一结算延迟的重启。

dev 模式的热重载（`PI_RUNNER_HOT_RELOAD=1`）与 CLI `--watch` 共用这套机制，因此两者都不会打断进行中的会话。

---

## 直接进会话（autostart）

经 CLI 启动时既然已确定 agent source，就不必再让用户在选源页点一次。启动器**固定注入** `PI_WEB_AUTOSTART=1`（`bin/pi-web.mjs:127`），前端 app-shell 据此跳过 `AgentSourcePicker`、用 `PI_WEB_DEFAULT_SOURCE` 直接建会话进入会话界面（复用既有 resume 分支）：

- `AppConfig.autoStart` 读 `PI_WEB_AUTOSTART` → `page.tsx` 透传 → `ChatApp` 初始 session 在 `autoStart` 时用 `defaultSource` 直接建会话。
- 进入自动会话后，「切换源」（`onReset`）仍可回到选源页。
- 非 CLI 启动（未设该信号）时默认行为不变，仍显示选源页。

这是 CLI 与应用层之间唯一的「直接进会话」接线信号，应用层只做极小装配改动，会话引擎 / 源解析 / runner 行为均不受影响。

---

## 构建详解

### 为什么需要隔离构建目录

```bash
NEXT_DIST_DIR=.next-cli next build
```

开发期 `next dev` 使用默认 `.next` 目录；CLI 产物写入 `.next-cli`，两者互不干扰。在 dev server 运行期间执行 `next build` 会污染共享 `.next`，导致 webpack 500 错误，因此必须隔离。

### standalone 产物与静态资源补全

Next.js `output: "standalone"` 不自带 `static/` 与 `public/`，`scripts/pack-standalone.mjs` 在构建后以覆盖式（可重复执行）完成（`scripts/pack-standalone.mjs:22-44`）：

1. 校验 `<distDir>/standalone/server.js` 存在（缺失 = 尚未以 standalone 模式 build，退出码 1）。
2. 复制 `<distDir>/static/` → `<distDir>/standalone/<distDir>/static/`。
3. 复制 `public/` → `<distDir>/standalone/public/`（若存在）。

布局假设 `outputFileTracingRoot` = app 根（= workspace 根，`next.config.ts:64`），故 standalone 内 app 文件在根、`server.js` 在 standalone 根。

### standalone 与 next start 的互斥（PI_WEB_DISABLE_STANDALONE）

standalone 产物与 `next start` 不兼容（后者拒绝服务 standalone build）。浏览器 e2e 须经 `next start` 起服，故 `next.config.ts:60-61` 把 `output` 条件化：

```typescript
// next.config.ts:60-61
output:
  process.env.PI_WEB_DISABLE_STANDALONE === "1" ? undefined : "standalone",
```

- 默认（未设该变量）：产出 standalone，CLI 打包行为不变。
- `PI_WEB_DISABLE_STANDALONE=1`：关闭 standalone，让 `next start` 可服务普通 production build（供 e2e）。

### standalone 发布产物瘦身（pack-standalone prune）

CLI 包是自包含产物，无需 test / docs / source-map / markdown 等开发文件。`scripts/pack-standalone.mjs:46-71` 在静态资源补全后递归清理 standalone 目录：

- **删整目录**（`PRUNE_DIRS`，`scripts/pack-standalone.mjs:47-53`）：`test`/`tests`/`__tests__`、`docs`/`doc`、`example`/`examples`、`.github`/`coverage`/`stories`/`man` 等；以及经 `outputFileTracingIncludes` 被内部包 devDep 捎进来、运行时不需要的纯 test/e2e 库——`vitest`/`vite`/`@vitest`/`tinypool`/`tinyspy`/`tinybench`/`jsdom`/`happy-dom`/`@testing-library`/`playwright`/`playwright-core`/`@playwright`。
- **删文件**（`PRUNE_FILE` 正则，`scripts/pack-standalone.mjs:54`）：`*.md` / `*.markdown` / `*.map` / `*.flow` / `*.tsbuildinfo` / `*.d.ts`，以及 `changelog`/`authors`/`contributors`/`.npmignore`/`.editorconfig`/`.prettierrc*`/`.eslintrc*`。

效果：CLI 包 **69.7MB → 46.4MB（13619 → 8345 文件）**（提交 `e07dfa7`）。完成时打印清理计数：

```
[pack-standalone] 瘦身:清理 N 个开发文件/目录(test/docs/*.map/*.md…)
```

需对照 / 调试时可用 `PACK_NO_PRUNE=1` 关闭瘦身（`scripts/pack-standalone.mjs:66-71`），保留完整产物。

### outputFileTracingIncludes — P0 关键配置

会话激活时主进程 spawn 的子进程（runner-bootstrap.mjs、pi SDK cli.js、jiti）是运行时动态进程，Next.js 的 nft（Node File Tracer）默认追踪不到。`next.config.ts` 中显式纳入：

```typescript
// next.config.ts:69-79
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

构建相关环境变量：

| 变量 | 作用 |
|------|------|
| `NEXT_DIST_DIR` | 隔离构建输出目录；CLI 用 `.next-cli`，与 dev 的 `.next` 互不污染 |
| `PI_WEB_DISABLE_STANDALONE=1` | 关闭 standalone 产出，让 `next start` 可服务普通 build（供浏览器 e2e） |
| `PACK_NO_PRUNE=1` | 跳过 standalone 瘦身，保留完整产物（对照 / 调试用） |

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

**Q：`--watch` 改了文件，但会话没有立刻重载**

A：这是回合安全保护。重启只在 runner 空闲时发生；若会话正在流式回包或调用工具（回合进行中），重启会延迟到本回合结束（`agent_end`）后再执行，避免打断当前会话。空闲后自动续上。

**Q：CLI 包体积太大 / 想保留完整产物排查**

A：默认构建已自动瘦身（清理 test/docs/`*.map`/`*.md` 等，约 69.7MB → 46.4MB）。如需对照完整产物，用 `PACK_NO_PRUNE=1 pnpm build:cli` 关闭瘦身。

---

## 下一步 / 相关文档

- [05 · 配置](./05-configuration.md) — `PI_WEB_DEFAULT_SOURCE`、`PI_WEB_AUTOSTART` 等 env 变量的完整说明
- [15 · 部署](./15-deployment.md) — 生产环境部署、Docker 打包
- [17 · 开发与测试](./17-development-and-testing.md) — dev 模式运行、`NEXT_DIST_DIR` 隔离构建原理
- [18 · 故障排查 FAQ](./18-troubleshooting-faq.md) — 更多启动问题排查
