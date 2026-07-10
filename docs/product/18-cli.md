# 18 · CLI

`pi-web` 提供一个全局可安装的命令入口：一条命令即可在本地或 CI 中启动一个自包含的 pi-web 实例（Vite + SPA 前端 + Hono/esbuild 单文件后端）。它是一个**无子命令的薄启动器**——没有 `create` / `install` / `publish` 之类的包管理子命令，只负责「解析参数 → 翻译成运行时 env → 拉起后端产物」三件事。

---

## 工作原理

`bin/pi-web.mjs` 本身不含业务代码，做三件事：

1. 用 `node:util.parseArgs` 把命令行解析为结构化选项（`parseCliArgs`，`bin/pi-web.mjs:47`）。
2. 用 `buildEnv()` 把选项翻译成后端读取的运行时环境变量（`bin/pi-web.mjs:108`）：`PI_WEB_DEFAULT_SOURCE`、`PORT`、`HOSTNAME` 等，业务代码经 `loadConfig()` 读取，二者解耦。
3. 用 `resolveRuntime()` 定位后端产物入口，再用 `node:child_process.spawn` 以 `process.execPath`（当前 Node）拉起 **产物根的 `dist/server.mjs`**（`launch`，`bin/pi-web.mjs:324`），子进程 `cwd` 设为产物根、`stdio: "inherit"`，业务代码零改动。

`parseCliArgs` 与 `buildEnv` 是**纯函数并被导出**以便单测；所有副作用（spawn / open / 端口探测 / 首启解包）集中在 `launch` / `main`，仅在作为程序入口执行时触发。入口判定经 `realpathSync` 解析符号链接后比对 `import.meta.url`（`bin/pi-web.mjs:455-469`），确保经 `npm link` 全局安装后判定仍成立，并用 `globalThis.__PI_WEB_CLI_EMBEDDED__` 标记避免被桌面壳内联打包时二次自跑。

> `dist/server.mjs` 由 `scripts/build-server.mjs` 用 esbuild 打成单文件（bundle + esm + node22，pi SDK 两包 / jiti / pg 保持 external）。**入口必须位于产物根**：`packages/server` 的 `runnerBootstrapPath()` / `resolvePiCliEntry()` 在 `import.meta.url` 被打包器内联失效后会回退到 `process.cwd()`，而 `launch()` 正是以产物根作为子进程 cwd（`bin/pi-web.mjs:322-328`）。构建产物结构详见 [19 · 部署与运维](./19-deployment.md)。

> 已知过时事实（不影响运行）：`bin/pi-web.mjs:6` 顶部注释与 `package.json:88` 的 `description` 仍写「拉起 Next standalone 自包含产物」。这是历史遗留字样——main 上早已无 Next.js，实际拉起的是 esbuild 单文件 `dist/server.mjs`。`bin/pi-web.mjs:230` 的 `standaloneServerJs` 亦已标 `@deprecated`，仅作旧名别名保留一轮。

---

## 产物入口的三级解析

`resolveRuntime()`（`bin/pi-web.mjs:263`）按优先级定位后端入口，命中即停：

| 级别 | 条件 | 入口来源 | 是否解包 |
|------|------|----------|----------|
| ① | 设了 `PI_WEB_DIST_DIR` | `<PKG_ROOT>/<PI_WEB_DIST_DIR>/server.mjs` | 否（隔离构建 / e2e） |
| ② | `<PKG_ROOT>/dist/server.mjs` 已存在 | 仓库内已构建的产物 | 否（开发态） |
| ③ | 以上都不命中（npm 安装态） | 随包压缩载荷 `payload/` → 共享运行时目录 | **首启触发解包** |

- 级别 ①② 让 `pnpm build:dist` 之后的本地迭代、CLI e2e、桌面壳未打包 e2e 都零改动继续通过，也不被首启解包拖慢。
- 级别 ③ 是 npm 全局安装后的形态：发布包内只随包 `payload/`（不随包 `dist/`），首次启动经 `payload/unpack.mjs` 解包到共享运行时目录，控制台打印：

  ```
  [pi-web] 首次启动,已解包运行时 → <distRoot>(<N>ms)
  ```

`distServerJs()`（`bin/pi-web.mjs:225`）即级别 ①② 的入口计算：`join(PKG_ROOT, process.env.PI_WEB_DIST_DIR ?? "dist", "server.mjs")`。

---

## 首启共享运行时解包

npm 安装态首次启动时，`ensureRuntime()`（随包 `payload/unpack.mjs`，源在 `src/runtime/unpack.src.mjs:435`）把压缩载荷解包到共享运行时目录：

- **目标目录**：`~/.pi/web/runtime/<version>-<digest 前缀>/`（`defaultRuntimeRoot`，`src/runtime/unpack.src.mjs:145-148`；目录名由 `runtimeDirName`，`:73` 生成）。可用 `PI_WEB_RUNTIME_ROOT` 覆盖根路径。
- **并发安全**：多个实例同时首启时经锁目录 + 心跳协调（`acquireLock`，`src/runtime/unpack.src.mjs:370`），后到者复用已解包结果，不重复解包。
- **摘要校验**：解包时边读边算载荷 digest，读完不匹配即中止（`src/runtime/unpack.src.mjs:274-278`）。
- **GC**：后端拉起**之后**才尽力而为回收旧运行时目录，保留最近 `GC_KEEP=2` 个版本（`scheduleRuntimeGc`，`bin/pi-web.mjs:284`；`gcRuntimeRoot`，`src/runtime/unpack.src.mjs:561`）。GC 永不阻塞或影响启动。

解包失败时 `main()` 把判别式错误码翻译成可读文案（`RUNTIME_ERROR_HINTS`，`bin/pi-web.mjs:392-401`）：

| 错误码 | 用户下一步 |
|--------|-----------|
| `runtime-root-unwritable` | 运行时目录不可写，检查权限或用 `PI_WEB_RUNTIME_ROOT` 换位置 |
| `disk-full` | 磁盘空间不足，清理后重试 |
| `payload-missing` / `payload-corrupt` | 载荷缺失/损坏，重新安装 `@blksails/pi-web` |
| `zstd-unsupported` | Node 版本过低，升级到 Node >= 22.15.0 |
| `lock-timeout` | 等待其他实例解包超时，确认无卡住进程后重试 |

> 共享运行时载荷这条生产线同时服务桌面版（Tauri），完整机制见 [20 · 桌面版（Tauri）打包与分发](./20-desktop-tauri.md)。故障自救速查见 [23 · 故障排查 / FAQ](./23-troubleshooting-faq.md)。

---

## 安装

### 前置条件

- Node.js >= 22.19.0（`package.json:6` `engines.node`）
- pnpm >= 9（仅从 monorepo 源码构建时需要）

### 从 npm 全局安装（推荐）

CLI 以 `@blksails/pi-web` 名发布到公共 npm registry（`package.json:89-91` `publishConfig.access: "public"`）：

```bash
npm i -g @blksails/pi-web
# 或
pnpm add -g @blksails/pi-web

pi-web --version   # 0.2.0
pi-web --help
```

发布包内只随三项分发——薄启动器、随包压缩载荷、以及供后端解析 alias 的 vite 配置（`package.json:11-15`）：

```json
{
  "name": "@blksails/pi-web",
  "version": "0.2.0",
  "bin": { "pi-web": "bin/pi-web.mjs" },
  "files": ["bin", "payload", "vite.config.ts"],
  "publishConfig": { "access": "public" }
}
```

安装后首次运行会自动解包共享运行时（见上文）。

### 从源码构建并链接（开发 / 调试）

基于本地改动调试 CLI 时，从 monorepo 构建后用 `npm link` 全局链接：

```bash
# 1. 构建全套产物（dist/client + dist/server.mjs + payload/）
pnpm build:dist

# 2. 全局链接
npm link

# 3. 验证
pi-web --version
pi-web --help
```

链接态下 `resolveRuntime()` 命中级别 ②（仓库内 `dist/server.mjs` 已存在），不触发解包。

---

## 快速启动

```bash
# 用当前目录作为 agent source（最简用法）
pi-web

# 指定 agent source 目录，自定义端口，就绪后自动打开浏览器
pi-web ./examples/hello-agent -p 8080 --open

# 绑定所有网卡
pi-web ./my-agent --host 0.0.0.0 -p 3000

# 用 stub agent 离线冒烟（无需真实 pi 配置）
pi-web ./examples/hello-agent --stub

# 监视 agent source 目录，文件变化时热重载活跃会话
pi-web ./my-agent --watch
```

服务就绪后控制台输出（`bin/pi-web.mjs:356`）：

```
[pi-web] 就绪 → http://127.0.0.1:3000
```

`examples/hello-agent` 是仓库自带的最小 agent，配合 `--stub` 可在没有任何 pi 凭据的机器上完成端到端冒烟。

---

## 选项参考

来源：`parseCliArgs` 的 `parseArgs` 配置（`bin/pi-web.mjs:53-63`）。

| 选项 | 短标志 | 默认值 | 说明 |
|------|--------|--------|------|
| `[source]` | — | 当前目录 | agent source（本地目录或 git 来源） |
| `--port <n>` | `-p` | `3000` | 监听端口；被占用时自动递增查找空闲端口（最多 20 个） |
| `--host <h>` | — | `127.0.0.1` | 绑定主机 |
| `--cwd <dir>` | — | 调用 CLI 时的工作目录 | 会话工作目录 |
| `--agent-dir <dir>` | — | `~/.pi/agent` | pi 配置目录 |
| `--open` | — | `false` | 就绪后用系统默认浏览器打开 |
| `--stub` | — | `false` | 以确定性 stub agent 运行（离线冒烟） |
| `--watch` | — | `false` | 监视本地 agent source 目录，文件变化时重载活跃会话（仅本地目录有效） |
| `--help` | `-h` | — | 显示帮助并退出（退出码 0） |
| `--version` | `-v` | — | 显示版本并退出（退出码 0） |

未知 / 非法选项抛 `CliUsageError`，打印用法提示并以非零退出，不启动服务器（`bin/pi-web.mjs:65-68`、`412-420`）。

---

## 参数到环境变量的映射

`buildEnv()`（`bin/pi-web.mjs:108-144`）把 CLI 选项翻译成后端读取的 env：

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

> `source` / `--cwd` 相对调用 CLI 时的工作目录（`baseCwd`）绝对化，因为后端子进程的 cwd 会变为产物根（`bin/pi-web.mjs:109-119`）。git 形态的 source（`git:` / `https:` / `ssh:` / `git@`）原样透传、不绝对化（`looksLikeGitSource`，`:38`）。
>
> `PI_WEB_AUTOSTART=1` 并非 CLI 独占——桌面壳同样向后端注入它。各 env 的完整语义见 [06 · 配置参考](./06-configuration.md)。

### 直接进会话（autostart）

经 CLI 启动时 agent source 已确定，不必再让用户在选源页点一次。启动器**固定注入** `PI_WEB_AUTOSTART=1`（`bin/pi-web.mjs:128`），前端据此跳过 `AgentSourcePicker`、用 `PI_WEB_DEFAULT_SOURCE` 直接建会话进入会话界面；进入后「切换源」仍可回到选源页。非 CLI 启动（未设该信号）时默认行为不变，仍显示选源页。

---

## 端口选择与就绪判定

- **自动避让**：`findFreePort`（`bin/pi-web.mjs:189`）从指定端口起递增探测，最多尝试 20 个，命中空闲端口即用；若实际端口与请求端口不同会打印提示（`:317-321`）。20 个全被占用则报错退出。先选空闲端口再拉起，避免就绪探测误打到占用方（`:308-316`）。
- **就绪探测**：`waitForReady`（`bin/pi-web.mjs:151`）轮询 `host:port`，任何 HTTP 响应即视为就绪，随后打印就绪地址并按 `--open` 决定是否开浏览器。该函数被导出供桌面壳复用同一就绪判定，避免逻辑分叉。

---

## --watch 热重载

`--watch` 复用 dev runner 的热重载机制：

- 注入 `PI_WEB_WATCH=1` 解除 dev 环境门控。
- 注入 `PI_RUNNER_HOT_RELOAD_PATHS=<source>` 告知 watcher 监视路径。
- 文件变化时，空闲的 per-session runner 进程自动重启（续上会话，不新建）。

**限制**：`--watch` 仅对本地目录 source 有效。传入 git 来源时，`main()` 打印告警并跳过（`bin/pi-web.mjs:429-431`），同时 `buildEnv()` 静默不注入 watch env（`:139-142`）。

### 回合安全（不打断进行中的会话）

热重载只在 runner **空闲**时才真正重启，避免半途中断流式回包或工具调用。`requestRestart` 的「忙」判断从「有待决命令」扩展为「有待决命令 OR 回合进行中」（`packages/server/src/rpc-channel/pi-rpc-process.ts:217-220`）：回合进行中（流式 token / 工具调用 / 等待 extension_ui 应答）收到重启请求，延迟到 `agent_end` 之后统一结算。dev 模式的 `PI_RUNNER_HOT_RELOAD=1` 与 CLI `--watch` 共用这套机制，两者都不会打断进行中的会话。

---

## 构建与 npm scripts 速查

CLI 产物即整套生产产物，由 `pnpm build:dist` 五步串联生成（`package.json:22`）：

```
vite build(client) → esbuild(server) → pack-dist.mjs → build:unpacker → build:payload
```

| 命令 | 等价操作 |
|------|---------|
| `pnpm build:dist` | 五步全套构建（dist/client + dist/server.mjs + payload/） |
| `pnpm build:cli` | 就是 `pnpm build:dist`（`package.json:26`，别名） |
| `pnpm start:cli` | `node bin/pi-web.mjs`（`package.json:27`） |
| `pnpm e2e:cli` | `node e2e/cli/cli-smoke.mjs` |
| `pnpm e2e:cli:watch` | `node e2e/cli/cli-watch.mjs` |
| `pnpm e2e:cli:real` | `node e2e/cli/cli-real.mjs` |
| `pnpm e2e:cli:reloc` | `node e2e/cli/cli-reloc.mjs` |

构建管线细节（esbuild 单文件、pack-dist 产物布局、生产 CSP）见 [19 · 部署与运维](./19-deployment.md)。

---

## E2E 验收

CLI 的 e2e 分四条，各覆盖不同路径：

```bash
# 前置：先构建
pnpm build:dist

# 启动链路冒烟
pnpm e2e:cli
```

- `e2e/cli/cli-smoke.mjs` — 产物完整性 + 参数路径（`--help`/`--version` 退出码 0、未知参数非 0 且不启动）+ stub 启动 + 浏览器冒烟（默认 source 激活会话 → 发消息 → 收到 stub 流式回包）。
- `e2e/cli/cli-watch.mjs` — 专项验证 `--watch` 热重载行为。
- `e2e/cli/cli-real.mjs` — 真实（非 stub）模式启动链路。
- `e2e/cli/cli-reloc.mjs` — **首启共享运行时解包 / 重定位路径**。级别 ①② 的直连产物路径测不到解包，解包只由 `cli-reloc` 与桌面壳的 `desktop-packaged` 覆盖（`bin/pi-web.mjs:257-259`）。

---

## 常见问题

> 以下是 CLI 特有的高频问题；更多启动 / 会话排查见 [23 · 故障排查 / FAQ](./23-troubleshooting-faq.md)。

**Q：启动时报 `未找到自包含产物 <...>/dist/server.mjs`**

A：仓库态尚未构建，先执行 `pnpm build:dist`（`bin/pi-web.mjs:301-306`）。npm 安装态则应能自动解包——若报此错，多半是级别 ③ 载荷缺失，见 `payload-missing` 提示。

**Q：端口被占用怎么办**

A：CLI 会从指定端口（默认 3000）起递增查找空闲端口，最多 20 个，并提示实际使用的端口。若 20 个均被占用，用 `-p` 指定其他范围。

**Q：`--watch` 不生效**

A：确认 `source` 是本地目录，而非 `git:` / `https:` 等 git 来源。git 来源无本地目录可监视，CLI 会打印告警并跳过。

**Q：`--watch` 改了文件但会话没立刻重载**

A：这是回合安全保护。重启只在 runner 空闲时发生；会话正在流式回包或调用工具（回合进行中）时，重启延迟到本回合结束（`agent_end`）后再执行。空闲后自动续上。

**Q：首次启动很慢 / 想指定运行时解包位置**

A：npm 安装态首次启动会解包共享运行时（一次性）。可用 `PI_WEB_RUNTIME_ROOT` 指定解包根目录。解包相关错误码与自救见上文「首启共享运行时解包」表。

---

## 相关链接

- [06 · 配置参考](./06-configuration.md) — `PI_WEB_DEFAULT_SOURCE`、`PI_WEB_AUTOSTART`、`PI_WEB_DIST_DIR`、`PI_WEB_RUNTIME_ROOT` 等 env 的完整说明
- [19 · 部署与运维（Web 服务端）](./19-deployment.md) — esbuild 单文件产物结构、随包载荷生产线、生产 CSP
- [20 · 桌面版（Tauri）打包与分发](./20-desktop-tauri.md) — 复用同一 `dist/server.mjs` 后端与共享运行时载荷的第二种交付形态
- [22 · 开发规范与测试](./22-development-and-testing.md) — `pnpm dev` 双进程编排与 `build:dist` 五步管线
- [23 · 故障排查 / FAQ](./23-troubleshooting-faq.md) — 更多启动问题与首启解包故障排查
