# Research & Design Decisions — pi-web-desktop

## Summary
- **Feature**: `pi-web-desktop`
- **Discovery Scope**: Extension(在既有 CLI/standalone 之上加一层 Electron 桌面壳)
- **Key Findings**:
  - CLI 已把「自包含产物 + 就绪探针 + 端口选择 + env 组装」做成可复用纯函数(`bin/pi-web.mjs`),桌面壳是这些原语的第二个消费者,不是重写。
  - 后端到 runner 的 spawn 唯一硬编码是 `assemble-spawn.ts` 两条分支的 `cmd:"node"`;改成读它已构造的 `env["PI_WEB_NODE_BIN"]`(缺省回退 `"node"`)即可让 runner 用注入的二进制,且保持「不直接读 process.env」的纯函数不变式。
  - `ELECTRON_RUN_AS_NODE=1` 经主进程 → server 的 `process.env` → `baseEnv` 透传链自动流到 runner 子进程,无需协议改动。

## Research Log

### 现有 CLI 启动原语(可复用接缝)
- **Context**: 桌面壳要拉起 standalone server 并等就绪,需确认能否复用 CLI 已有实现而非重写。
- **Sources Consulted**: `bin/pi-web.mjs`(仓库内)。
- **Findings**:
  - 已导出纯函数:`parseCliArgs`(:46)、`buildEnv`(:107)、`findFreePort`(:184)、`openBrowser`(:199)、`launch`(:221)、`main`(:317)、`CliUsageError`(:29)。
  - 未导出但可复用的内部 helper:`waitForReady`(:146,HTTP GET `/`,`READY_TIMEOUT_MS=60_000` / `READY_POLL_MS=300`,单请求 `timeout:2000`,host `0.0.0.0`/`::`→`127.0.0.1`)、`standaloneServerJs`(:212,`join(PKG_ROOT, NEXT_DIST_DIR ?? ".next-cli", "standalone", "server.js")`)。
  - `launch`(:221)自带端口选择 + spawn(`process.execPath` + `stdio:"inherit"`)+ 信号透传 + 就绪后 `openBrowser`,但**不返回 child 句柄**、且写死打开浏览器 → 桌面壳不能直接用 `launch`,需自实现「受监管 spawn」(持 child 句柄以便退出收尾 + 就绪后 `loadURL` 取代 `openBrowser`)。
- **Implications**: 桌面壳复用 `findFreePort` / `buildEnv` / `waitForReady` / `standaloneServerJs`;为此需在 `bin/pi-web.mjs` 补导出 `waitForReady` 与 `standaloneServerJs`(向后兼容,零行为变更)。桌面壳自持 spawn 供生命周期管理。

### standalone 产物布局与可重定位契约
- **Context**: 桌面壳要把产物嵌进打包 app,须确认产物自包含且可从任意资源目录运行。
- **Sources Consulted**: `scripts/pack-standalone.mjs`、`next.config.ts`、`packages/server/runner-bootstrap.mjs`、`packages/server/src/runner-bootstrap-path.ts`。
- **Findings**:
  - 产物根 `<distDir=.next-cli>/standalone`,`server.js` 在根;pi SDK 落 `standalone/packages/server/node_modules/@earendil-works/*`(子进程解析点)+ `standalone/node_modules/.pnpm`。
  - `pack-standalone.mjs` 已解决跨机可重定位:relink pi SDK 符号链接、复制依赖闭包、hoist 顶层、绝对路径重写回裸 specifier、`flattenSymlinkFree`(Windows/npm 无符号链接实体树)、prune。
  - runner 链:`server.js` → `runner-bootstrap.mjs`(纯 ESM)→ `createJiti(here)` → `jiti.import(src/runner/runner.ts)` → agent-loader 转译用户 `index.ts`。`runnerBootstrapPath()` 优先 `import.meta.url`,standalone 换机回退 `cwd/packages/server/runner-bootstrap.mjs`。
  - `next.config.ts` `outputFileTracingIncludes` 已显式纳入 runner-bootstrap.mjs、packages/server/src、pi SDK、jiti、agent-kit、tool-kit、logger、protocol、examples。
- **Implications**: 产物必须整目录以**真实文件路径**暴露给被 spawn 的 server 及其子进程 → electron-builder 必须用 `extraResources`(asar 之外),不能进 asar 虚拟文件系统(child_process 无法从 asar 内解析 spawn 目标/jiti 动态 require)。桌面壳的 server.js 定位改为基于 `process.resourcesPath`。

### 后端 spawn 注入点
- **Context**: 干净无 Node 机器上 runner 子进程不能依赖 PATH 上的 `node`。
- **Sources Consulted**: `packages/server/src/agent-source/assemble-spawn.ts`、`lib/app/pi-handler.ts`。
- **Findings**:
  - `assemble()`(:74)两分支均返回 `cmd:"node"`(:103 custom / :124 cli)。`buildEnv`(:61)合并 `baseEnv + env + trust`;real 模式 `baseEnv = process.env`(pi-handler.ts:109,注释强调须带 PATH 否则 spawn 不到 node)。
  - runnerEntry/piCliEntry 由 `makeRealResolver`(pi-handler.ts:97-98)注入绝对路径。
  - stub 模式已用 `cmd: process.execPath`(pi-handler.ts:255),real 模式走 assemble 的 `"node"`。
- **Implications**: 只改 `assemble()`:`const cmd = env["PI_WEB_NODE_BIN"] ?? "node"`,两分支共用。读的是**已构造的 env**(而非 process.env),纯函数不变式不破;桌面主进程把 `PI_WEB_NODE_BIN=process.execPath` + `ELECTRON_RUN_AS_NODE=1` 放进 server 进程 env,经 `baseEnv` 透传即生效。未注入时 `?? "node"` 与现状完全一致(CLI/dev 无回归)。

### 桌面壳的包与 e2e 形态
- **Context**: 确认 workspace 布局与 e2e 手段。
- **Sources Consulted**: `pnpm-workspace.yaml`(仅 `packages/*`)、`package.json`(scripts)、`e2e/cli/*.mjs`、已安装 `@playwright/test`(`_electron` 可用)。
- **Findings**:
  - 现 workspace 仅 glob `packages/*`;根本身是 Next app(不在 packages 下)。
  - CLI e2e 是 node 驱动 smoke 脚本(`cli-real.mjs` 真实 mock-provider 会话、`cli-reloc.mjs` 藏原构建目录测重定位)。
  - `@playwright/test` 的 `_electron.launch()` 可直接驱动打包/未打包 Electron app 做 e2e。
- **Implications**: 桌面壳作为顶层 `desktop/` 目录(与 `bin/`、`app/` 同级,非 `@blksails/*` 库),须把 `desktop` 加进 `pnpm-workspace.yaml`。e2e 采用 Playwright `_electron` 驱动主进程 + 断言窗口加载本地 UI;干净无 Node 验证沿用 `cli-reloc.mjs` 的「藏 node」思路。

### Electron 打包外部事实(官方文档核实)
- **Context**: 需选内置 Node ≥22.19 的 Electron 版本,并确认 ELECTRON_RUN_AS_NODE、asar/extraResources、窗口安全、进程树收尾的官方做法。
- **Sources Consulted**: electronjs.org(environment-variables / fuses / security / browser-window / release blog)、electron.build(contents / mac / code-signing)、releases.electronjs.org。
- **Findings**:
  - **Electron ↔ Node**:Electron 37=Node 22.16、38=22.18(均 <22.19)、**39=22.20.0(首个 ≥22.19)**、40–43(当前稳定,2026-07)=Node 24.x。→ 最低 `>=39`,实务用最新稳定(40+)。
  - **ELECTRON_RUN_AS_NODE**:官方"Starts the process as a normal Node.js process"(无 GUI/Chromium,可跑任意 `.js`,除 5 个 crypto flag 外接受普通 node flag)。受 `runAsNode` fuse 门控(默认开);主进程 `child_process.fork()` 依赖它。标准 spawn-as-node:`spawn(process.execPath, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })`。**坑**:此变量被后代继承 → 本该是 GUI 的后代若继承会静默变成裸 node,反之亦然;故 node 子进程显式设、GUI 子进程显式删。
  - **electron-builder**:`extraResources` 原样复制进 resources 目录,运行时经 `process.resourcesPath` 定位,完全在 asar 外(官方用途即"native binaries / CLI tools / data files accessible at runtime")。`asar` **默认开**;`child_process.spawn/exec` **不能执行 asar 内的二进制/脚本**(虚拟 fs 只重定向 fs 读,不重定向进程启动/动态 native require)。→ 被 spawn 的 Node server + 其子进程动态 require 兄弟文件的场景,**推荐 extraResources**(干净的 asar 外绝对路径,避开 asar 路径翻译对孙进程的边界坑),`asarUnpack` 留给少量仍想用 asar 路径寻址的文件。
  - **macOS dmg**:最小 `"mac": { "target": "dmg" }`。本地未签名但可运行:`identity:null` + `hardenedRuntime:false` + `gatekeeperAssess:false`(或 `CSC_IDENTITY_AUTO_DISCOVERY=false`);`--dir` 出未打包 app 最快。未签名 dmg 本机可运行(异机 Gatekeeper 会警告/隔离)。
  - **窗口安全基线**:`contextIsolation:true`(12+ 默认)、`nodeIntegration:false`(5+ 默认)、`sandbox:true`(20+ 默认)——保持默认;preload 经 `contextBridge`。外链 `webContents.setWindowOpenHandler((d)=>{ if(isSafe(d.url)) shell.openExternal(d.url); return {action:'deny'}; })`,先校验 scheme(openExternal 传不受信输入可致命令执行)。
  - **进程树收尾**:`app.on('before-quit')` 拆 server;主进程直属子有退出信号,但**孙进程(runner)不自动传播**。POSIX:server `detached:true` 成进程组组长,`process.kill(-child.pid,'SIGTERM')`(负 pid=组)触达孙进程;Windows:`taskkill /PID <pid> /T /F`(/T=树 /F=强制)。裸 `child.kill()` 只杀直属子 → 留僵尸 runner。
- **Implications**:
  - `desktop/package.json` 依赖 `electron@>=39`(装最新稳定);构建工具 `electron-builder`。
  - server 经 `spawn(process.execPath, [serverJs], { detached:true, env:{ ...buildEnv(), ELECTRON_RUN_AS_NODE:'1', PI_WEB_NODE_BIN: process.execPath } })`;主进程 env **不设** ELECTRON_RUN_AS_NODE(保持 GUI)。本方案无 GUI 后代,继承坑不触发。
  - electron-builder `extraResources` 把 `.next-cli/standalone` 整目录放进 `process.resourcesPath`;运行时以 `process.resourcesPath` 定位 server.js(dev 模式改指 dev server)。
  - 退出收尾:POSIX 组 kill(负 pid)/ Windows `taskkill /T /F`,自实现小 helper(避免 `tree-kill` 额外依赖)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Electron 薄壳 + 复用 standalone | 主进程 spawn 现有 standalone server(Electron-as-Node)+ BrowserWindow 加载本地 UI | 后端零重写、与 e2e Chromium 一致、单一运行时(Electron 充当 Node)、复用 CLI 原语 | 安装包体积大(~120-180MB)、内存占用 | 选定 |
| Tauri v2 + Node sidecar | Rust 壳 + 捆绑 node 跑 server/runner | 壳体积小 | Node 运行时省不掉(sidecar 仍捆 node)、新工具链、系统 WebView 兼容需重测、Windows 进程树清理复杂 | 否决(净收益小) |
| 托盘启动器包 CLI | 极薄壳调系统 node 跑 CLI | 体积最小 | 要求用户自装 Node → 非自包含桌面版,违背核心目标 | 否决 |

## Design Decisions

### Decision: runner 子进程用注入的 Node 二进制(`PI_WEB_NODE_BIN`)
- **Context**: 干净机器无系统 Node,`assemble-spawn` 硬编码 `cmd:"node"` 会导致 runner spawn 失败(exit code:null → 会话删除 → 404)。
- **Alternatives Considered**:
  1. 在桌面包里额外捆绑一份独立 node 二进制 — 体积翻倍、版本漂移。
  2. 让桌面壳把独立 node 加进 PATH — 侵入宿主环境、跨平台脆弱。
  3. `ELECTRON_RUN_AS_NODE` 让 Electron 二进制充当 node,runner `cmd` 指向 `process.execPath`。
- **Selected Approach**: 方案 3。`assemble()` 读 `env["PI_WEB_NODE_BIN"] ?? "node"`;桌面主进程注入 `PI_WEB_NODE_BIN=process.execPath` + `ELECTRON_RUN_AS_NODE=1`,经 baseEnv 透传到 runner。
- **Rationale**: 零第二运行时、复用 Electron 已内置的 Node、单点改动、向后兼容(未注入回退 `"node"`)。是 VS Code 跑扩展宿主的同款做法。
- **Trade-offs**: runner 及其后代进程继承 `ELECTRON_RUN_AS_NODE`;对纯 node 后代正确,但若 pi SDK 派生本应是 GUI 的进程会受影响(M1 无此路径,记为风险)。
- **Follow-up**: 集成测试断言注入 env 时 spawnSpec.cmd == 注入值、未注入时 == "node"。

### Decision: standalone 产物走 `extraResources`(asar 之外)
- **Context**: 被 spawn 的 server 与 runner 子进程需真实文件路径 + jiti 动态 require。
- **Alternatives Considered**:
  1. 产物进 asar(默认打包) — child_process/jiti 无法从虚拟 fs 解析。
  2. `asarUnpack` 部分解包 — 产物本就是完整目录,不如整目录外置清晰。
  3. `extraResources` 整目录放 `resources/` 下(asar 外)。
- **Selected Approach**: 方案 3。运行时经 `process.resourcesPath` 定位 `server.js`。
- **Rationale**: 语义清晰、与 pack-standalone 的自包含实体树天然契合、避免 asar 边界坑。
- **Trade-offs**: 产物文件在包内可见(非机密,本就是开源产物)。
- **Follow-up**: e2e 在打包形态下验证 server.js 从 resourcesPath 成功拉起。

### Decision: 复用 CLI 纯原语,桌面壳自持受监管 spawn
- **Context**: `launch()` 不返回 child、写死 openBrowser,不满足桌面生命周期需求。
- **Selected Approach**: 复用 `findFreePort`/`buildEnv`/`waitForReady`/`standaloneServerJs`(后两个补导出);桌面壳自实现持句柄的 spawn + 就绪后 `loadURL` + 退出 kill 进程树。
- **Rationale**: 探针/端口/env 逻辑与 CLI 一致可测,生命周期是桌面特有职责。
- **Trade-offs**: `bin/pi-web.mjs` 新增两个导出(极小、无行为变更)。

## Risks & Mitigations
- runner 后代进程继承 `ELECTRON_RUN_AS_NODE` — M1 无 GUI 后代路径;记录并在 e2e 真实会话中验证 bash/工具调用正常。
- GUI 进程 PATH 缺失波及 agent 内调用的外部命令(git/pnpm 等) — M1 聚焦 node;PATH 经 baseEnv 透传已带宿主 PATH(登录 shell 场景 M2 再补)。
- 打包体积 — 接受(方案取舍已记录);prune 已裁 dev 依赖。
- 端口就绪探针在慢机器上 60s 超时 — 复用 CLI 常量;失败走 Req 2 的可见错误路径。

## References
- [Electron 39 release blog](https://www.electronjs.org/blog/electron-39-0) — 首个内置 Node 22.20.0(≥22.19)的大版本
- [Electron stable releases](https://releases.electronjs.org/releases/stable) — 版本↔Node 对照
- [ELECTRON_RUN_AS_NODE](https://www.electronjs.org/docs/latest/api/environment-variables) — 以纯 node 运行 Electron 二进制
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) — runAsNode fuse 门控
- [electron-builder contents(extraResources/asar/asarUnpack)](https://www.electron.build/docs/contents/)
- [electron-builder macOS(dmg/签名默认)](https://www.electron.build/docs/mac/)
- [Electron security(webPreferences/openExternal)](https://www.electronjs.org/docs/latest/tutorial/security)
- [进程树收尾讨论](https://github.com/electron/electron/issues/7084)
