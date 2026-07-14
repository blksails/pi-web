# Research & Design Decisions — electron-to-tauri

## Summary

- **Feature**: `electron-to-tauri`
- **Discovery Scope**: Complex Integration（替换宿主运行时，牵动打包、CI、e2e 三条链路）
- **Key Findings**:
  1. **一票否决点已由 PoC 实证解除**：Tauri 2.11.5 加载远端 `http://127.0.0.1:<port>` 时 `window.__TAURI__` **确实注入**，`invoke()` 可用（上游 issue #11934 在此版本不复现），且在严格 CSP 下仍可用（macOS/WKWebView）。
  2. **PoC 挖出调研未覆盖的一条硬规则**：应用**自身**的 command 被远端来源调用时，必须在 `src-tauri/permissions/*.toml` 声明 `allow-<cmd>` 并加入 capability 的 `permissions`，仅 `core:default` 会被拒（`"<cmd> not allowed. Plugin not found"`）。
  3. **「包体积」动机的输入数字是错的**：Node v22.22.0 单个二进制解压后 **107MB**（strip 后 86MB，gzip 34.8MB），而非 requirements 里写的 40~60MB。安装包约 +35MB，安装后磁盘 +86~107MB。

## Research Log

### 远端 http 页面能否 invoke（迁移可行性的一票否决点）

- **Context**: requirements 标注的「可行性前置风险」。窗口加载的是本地回环 HTTP server 提供的页面，而非随包静态资源。上游 issue #11934 声称此时 `window.__TAURI__` 不注入。若属实，`pickDirectory` 走 `invoke` 的整条路不通。
- **Sources Consulted**:
  - https://github.com/tauri-apps/tauri/issues/11934
  - https://v2.tauri.app/security/capabilities/
  - **自建 PoC**（证据：`evidence/poc-invoke-strict-csp.log`，源码：`evidence/poc-src/`）
- **Findings**:
  - Tauri 2.11.5 + macOS(WKWebView)，窗口以 `WebviewUrl::External("http://127.0.0.1:34999/")` 加载：`hasTauriGlobal: true`，键为 `app/core/dpi/event/image/menu/mocks/path/tray/webview/webviewWindow/window`；`window.__TAURI_INTERNALS__` 亦存在。**#11934 不复现**。
  - 仅配 `permissions: ["core:default"]` 时，`invoke('ping')` 报 `ping not allowed. Plugin not found`。
  - 补上 `src-tauri/permissions/ping.toml`（`identifier = "allow-ping"`，`commands.allow = ["ping"]`）并加入 capability `permissions` 后：`invokeOk: true`，返回 `PONG`，Rust 侧 stderr 确认命令被调用。
  - 页面带 `default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'` 时 **invoke 仍成功** —— macOS 的 IPC 走 WKWebView `messageHandlers`，不受 `connect-src` 约束。
  - `bundle.icon` 缺失会使 `tauri::generate_context!` 在**编译期** panic（需 RGBA PNG）。
- **Implications**:
  - 目录选择可沿用「渲染层 invoke 自定义 command」形态，无需退化为 server 端点。
  - capability 必须显式列出每个自定义 command 的 `allow-*` permission —— 这既是功能前提，也正好落实 Requirement 8.3「仅授予明确需要的能力」。
  - **未验证**：Windows(WebView2) 与 Linux(WebKitGTK) 的 IPC 实现不同（可能走 custom protocol + fetch），严格 CSP 下是否仍通过必须在 CI 上复验。设计需给出兜底。

### Node sidecar 的真实体积

- **Context**: Requirement 11 要求以实测裁定「包体积」动机是否兑现；requirements 的输入值（+40~60MB）来源不明。
- **Sources Consulted**: `https://nodejs.org/dist/v22.22.0/`（含 `SHASUMS256.txt`）；本机实测。
- **Findings**:
  - 官方压缩包：darwin-arm64 24.4MB / darwin-x64 25.9MB / linux-x64 29.3MB / win-x64 33.9MB。
  - `SHASUMS256.txt` 可得；darwin-arm64 下载物校验和实测匹配（`2bd596bb…23ac`）。
  - **解压后单个 `bin/node`：107MB**。`strip -x` 后 **86MB**。gzip 后 34.8MB。
- **Implications**:
  - 安装包（压缩态）约 +35MB；安装后磁盘占用 +86~107MB。requirements 的 40~60MB 是低估，design 与最终验收报告须以此为准。
  - `strip` 可省 21MB，成本低，采纳。
  - `--without-intl` 需自行编译 Node（CI 成本高、且 pi SDK 与 Intl 依赖未审计）—— 否决。

### 现有 Electron 壳的行为契约（迁移的验收基准）

- **Context**: 「行为等价」是本迁移的核心约束；必须把 Electron 侧的隐性行为提取成可逐条对齐的契约。
- **Sources Consulted**: `desktop/src/*.ts`、`test/desktop/*.test.ts`（7 文件）、`e2e/desktop/*.mjs`（4 文件）、`bin/pi-web.mjs`。
- **Findings**（下列均为必须在 Rust 侧复刻的行为）：
  - `findFreePort(host, startPort, maxTries=20)`：递增探测，`connect` 成功=被占，`error`/`timeout(1000ms)`=空闲；`0.0.0.0`/`::` 探测时映射为 `127.0.0.1`；全占返回「无」。
  - `waitForReady`：超时 **60_000ms**，轮询间隔 **300ms**，单请求超时 2000ms；探测 `GET /`，**任何 HTTP 响应即视为就绪**（不看状态码）；`signal.aborted`（子进程已退）立即失败。
  - `buildEnv` 注入键：恒有 `PI_WEB_DEFAULT_SOURCE`、`PI_WEB_DEFAULT_CWD`、`PORT`、`HOSTNAME`、`PI_WEB_AUTOSTART=1`；条件有 `PI_WEB_AGENT_DIR`、`PI_WEB_STUB_AGENT=1`、`PI_WEB_WATCH=1` + `PI_RUNNER_HOT_RELOAD_PATHS`。
  - `ServerSupervisor.start` 的**微妙时序**：探针失败时必须**先快照 `exitedBeforeCleanup`，再 `stop()`** —— 否则 stop 杀掉仍存活的 server 会把 `ready-timeout` 误判成 `early-exit`。这是 Rust 侧最容易复刻错的一点。
  - `stop()`：POSIX 对 detached 组长发**负 pid** SIGTERM，3s 宽限后 SIGKILL；Windows `taskkill /PID <pid> /T /F`；幂等；已自行退出则跳过。
  - `decideExternalOpen`：非回环 http(s) → 外开；回环（`127.0.0.1`/`localhost`/`::1`，`[::1]` 需剥括号）→ deny；非 http(s) scheme → deny；非法 URL → deny 不抛。
  - `resolveServerEntry`：packaged → `resourcesPath/dist/server.mjs`；unpackaged → CLI 布局；dev → null（不拉起）。**入口必须在产物根**，supervisor 以 `dirname(entry)` 作 cwd，否则 `packages/server` 的路径解析回退失效。
  - 前端消费面**极小**：`lib/app/desktop-bridge.ts` 是唯一访问器，唯一消费方是 `components/chat-app.tsx`（`useDesktopPickDirectory()` → 传 `onBrowseDirectory` 给两个 `AgentSourcePicker`）；桥缺失时干脆不传该 prop，`AgentSourcePicker` 据此不渲染「浏览」按钮。
- **Implications**:
  - 7 个 `test/desktop/*.test.ts` 断言的是 Electron 主进程 TS 纯函数，无法搬运，但**其行为契约逐条构成 Rust 侧单测的验收清单**。
  - 前端改动面可压到 1 个文件。

### e2e 驱动能力

- **Context**: 现有四条 e2e 全靠 Playwright `_electron`（`launch`/`firstWindow`/`app.evaluate`）。
- **Sources Consulted**: https://v2.tauri.app/develop/tests/webdriver/
- **Findings**:
  - `tauri-driver` **官方明确不支持 macOS**（无 WKWebView driver），仅 Windows(msedgedriver) + Linux(WebKitWebDriver)。
  - `desktop-directory-picker.mjs` 靠 `app.evaluate` 在 Electron 主进程猴补 `dialog.showOpenDialog` —— Tauri 下无任何等价物（对话框在 Rust 侧）。
- **Implications**:
  - macOS 只能黑盒（对回环 HTTP 端点断言 + 进程/端口断言）+ Rust 单测。
  - 需要一个**非猴补**的可测接缝来验证目录选择：采用环境变量驱动的 stub（见 Design Decisions）。
  - 真正驱动 WebView 的 e2e（含经桥调用 `pickDirectory`）放到 **Linux CI**（tauri-driver + WebKitWebDriver + xvfb），这正好是 Requirement 10.4 允许的形态。

### 打包与发布

- **Sources Consulted**: https://v2.tauri.app/reference/config/ ・ https://github.com/tauri-apps/tauri-action ・ https://v2.tauri.app/develop/sidecar/ ・ https://v2.tauri.app/develop/resources/ ・ https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html ・ https://v2.tauri.app/start/prerequisites/
- **Findings**:
  - `bundle.externalBin`：磁盘文件名须带 target triple 后缀（`node-aarch64-apple-darwin`），打包时后缀被剥离；落盘与主可执行**同目录**（macOS 是 `.app/Contents/MacOS/`，**不是** Resources）。`shell().sidecar()` 不返回落盘绝对路径。
  - `bundle.resources`：解压为**真实文件**，无 asar 式虚拟 FS 问题，子进程可用真实路径 require。`resource_dir()`：macOS=`.app/Contents/Resources`；Windows=exe 同目录；Linux AppImage=`${APPDIR}/usr/lib/${exe_name}`。
  - `tauri_plugin_shell` 的 Command **不暴露 detached/process_group**，`child.kill()` 只杀直接子进程 → 孙进程（pi runner）会成孤儿。
  - `tauri-action` 经 `args: '--target <triple>'` 按三元组构建；官方示例以矩阵分别构建 macOS arm64/x64，**未推荐** universal。
  - 安全公告 GHSA-7gmj-67g7-phm9：Tauri 2.0–2.11.0 的 `is_local_url()` 在 Windows/Android 有 origin 绕过 → 必须 ≥2.11.1。
  - macOS sidecar 破坏 codesign/notarization（tauri-apps/tauri#11992）。
  - Linux 构建依赖：`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`。
- **Implications**:
  - 进程树收尾必须绕开 `tauri_plugin_shell`，直接用 `std::process::Command`。
  - `PI_WEB_NODE_BIN` 只能由 `current_exe()?.parent()?.join("node")` 推得。
  - 本 spec 沿用未签名分发，#11992 被规避（已在 requirements 的 Out of scope）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Rust 全量重实现编排层 | 端口/就绪/spawn/收尾全在 Rust | 无额外进程；与 Tauri 生命周期天然贴合；单二进制 | 与 `bin/pi-web.mjs` 的 CLI 实现存在就绪语义分叉风险 | **选定**；用契约表 + 两侧单测对冲分叉 |
| 保留薄 JS 编排层 | Rust 只起 node，编排逻辑仍在 JS | 与 CLI 共用同一份原语，零分叉 | 鸡生蛋（要先起 node 才能算端口）；多一次进程启动；Rust↔JS 双向通信复杂度 | 否决 |
| 窗口直接 `WebviewUrl::External` | 建窗即指向回环 URL | 少一步 navigate | 端口未知时无法建窗；空白窗口违反 1.4 | 否决 |
| 本地 App 页 + 就绪后 navigate | 初始加载随包 `index.html`（加载页），就绪后 `navigate()` | 同时满足 Tauri 必填的 `frontendDist` 与 Req 1.4 的「不空白」 | 需确认 capability 同时覆盖本地与远端来源 | **选定** |

## Design Decisions

### Decision: 编排层在 Rust 侧重实现，以契约表对冲与 CLI 的分叉

- **Context**: `bin/pi-web.mjs` 的四个纯原语当前被 esbuild 内联进 Electron 主进程，桌面与 CLI 共用一份就绪语义。Tauri 主进程是 Rust。
- **Alternatives Considered**:
  1. Rust 重实现 —— 有分叉风险。
  2. 保留薄 JS 层 —— 需先起 node 才能算端口，鸡生蛋。
- **Selected Approach**: Rust 重实现 `find_free_port` / `wait_for_ready` / `resolve_server_entry` / `build_env`。把就绪语义（`GET /` 任意响应即就绪、60s 超时、300ms 轮询）与 `buildEnv` 注入键表写入 design 作为**单一事实源**，Rust 与 JS 两侧单测各自断言同一组行为。
- **Rationale**: 避免鸡生蛋与跨语言通信；分叉风险用可执行的契约测试而非文档约定来锁。
- **Trade-offs**: 两份实现需同步维护；换来编排层与宿主生命周期的直接贴合。
- **Follow-up**: 若未来 CLI 的就绪语义变更，须同步 Rust 侧并更新契约表。

### Decision: 前端改 `desktop-bridge.ts` 内部实现，而非注入 `window.piWebDesktop` shim

- **Context**: Requirement 6.1 要求桥的**形状**与既有前端契约一致。两条路：Rust 侧 `initialization_script` 注入同形状全局（前端零改）；或改前端唯一访问器的内部实现。
- **Alternatives Considered**:
  1. `initialization_script` 注入 shim —— 前端零改，但依赖「注入脚本对 remote URL 生效」这一**未验证**行为，多一个失败点。
  2. 改 `lib/app/desktop-bridge.ts` —— 改动面 1 个文件。
- **Selected Approach**: 保持 `PiWebDesktopBridge` 接口与唯一消费方 `chat-app.tsx` 零改动；`getPiWebDesktopBridge()` 内部改为：优先读 `window.piWebDesktop`（向后兼容旧壳），否则在检测到 `window.__TAURI__` 时合成一个同形状的桥（`pickDirectory` → `invoke('pick_directory')`）。
- **Rationale**: PoC 已证实 `window.__TAURI__` 在远端页面可用；不引入未验证依赖。桥本就是收敛入口，改它是最小且语义正确的改法。
- **Trade-offs**: 前端从「完全不知道宿主」变为「知道两种宿主」，但仍收敛在单文件内。
- **Follow-up**: `test/desktop-bridge.test.ts` 需增补 `__TAURI__` 注入态的用例。

### Decision: sidecar 校验和入库，不信任上游 `SHASUMS256.txt`

- **Context**: Requirement 9.4 要求校验完整性且失败即构建失败。
- **Alternatives Considered**:
  1. CI 下载 `SHASUMS256.txt` 并比对 —— 校验和与二进制同源，上游被篡改时同时被改，防护力弱。
  2. 期望 sha256 提交入库。
- **Selected Approach**: `desktop/node-sidecar.lock.json` 记录 Node 版本与每个 target triple 的期望 sha256（首次由维护者从官方 `SHASUMS256.txt` 取得并人工核对后入库）。`scripts/fetch-node-sidecar.mjs` 只比对**入库值**，不匹配即非零退出。
- **Rationale**: 把信任锚点从「下载时的网络」移到「代码评审时的人眼」，且使升级 Node 版本成为一次显式的、可 review 的提交。
- **Trade-offs**: 升级 Node 需改 lock 文件；换来供应链可审计性。
- **Follow-up**: 校验对象是**官方压缩包**的 sha256（而非解压后的 `bin/node`），因为后者随 tar 实现可能不稳定。

### Decision: 目录选择的可测接缝用环境变量 stub，而非猴补

- **Context**: 现有 e2e 靠 Playwright `app.evaluate` 在 Electron 主进程替换 `dialog.showOpenDialog`；Tauri 下对话框在 Rust 侧，无此能力。
- **Alternatives Considered**:
  1. 编译期 `#[cfg(test)]` hook —— 只覆盖 Rust 单测，不覆盖「渲染层经桥拿到路径」的端到端。
  2. 环境变量驱动 stub。
- **Selected Approach**: `pick_directory` command 在读到非空 `PI_WEB_DESKTOP_STUB_PICK_DIR` 时直接返回该路径、不弹对话框；否则走 `tauri-plugin-dialog`。纯归一化逻辑（选中→路径 / 取消→无 / 异常→无）抽为不依赖 Tauri 运行时的函数，由 `cargo test` 覆盖。
- **Rationale**: 同一接缝同时服务 Linux 的 WebDriver e2e（真实经桥 invoke）与 macOS 的黑盒验证；不需要向渲染层暴露任何测试专用能力。
- **Trade-offs**: 生产二进制中存在一个由环境变量激活的测试分支。以「仅影响对话框来源、不放宽任何权限、不回传目录内容」限制其风险面，并在 Requirement 8.5 的意义下不构成新增能力。
- **Follow-up**: 该 env 不得出现在任何随包默认环境中；Rust 单测断言 env 缺失时走真实对话框路径。

### Decision: 测试拓扑按平台分层

- **Context**: `tauri-driver` 不支持 macOS，而 macOS 是唯一经现有 e2e 验证过的平台。
- **Selected Approach**:
  - **macOS**：黑盒 e2e 三条（real / no-node / packaged）—— 启动二进制、对其拉起的回环端点做真实会话断言、退出后断言端口释放。
  - **Linux CI**：tauri-driver + WebKitWebDriver + xvfb 跑 WebView e2e，覆盖「渲染层经桥调用 `pickDirectory` 拿到路径」这条 macOS 测不到的路径，并顺带在真实严格 CSP 下复验 `invoke`（对冲 WebKitGTK 的 IPC 差异风险）。
  - **全平台**：`cargo test` 覆盖编排层纯逻辑（端口选取、就绪判定、失败分类、进程树收尾、路径解析、外链判定、目录选择归一化）。
- **Rationale**: 落实 Requirement 10.4 与 10.5；把 macOS 测不到的那条路径挪到能测的平台，而不是宣称「假定可用」。
- **Follow-up**: Linux WebView e2e 同时是 Windows/Linux 严格 CSP 下 IPC 可用性的**唯一自动化证据**。

### Decision: 包体裁定阈值

- **Context**: Requirement 11.5 要求「净收益不显著则交回裁定」，但未定义「显著」。
- **Selected Approach**: 以 **macOS arm64 安装包**为基准口径：若 Tauri 安装包体积 > Electron 安装包体积 × 0.75，判定为「净收益不显著」，停止并交回决策者。sidecar 采用 `strip` 后的 node（省 21MB）。
- **Rationale**: 迁移的两大动机之一是包体；若连 25% 都省不下，则该动机基本落空，值得重新裁定。
- **Trade-offs**: 阈值是工程判断而非客观真理；写明即可被推翻。

## Risks & Mitigations

| # | 风险 | 缓解 |
|---|------|------|
| R1 | Windows(WebView2)/Linux(WebKitGTK) 在严格 CSP 下 IPC 可能被 `connect-src` 拦截（macOS 已实证不受影响，但实现机制不同） | Linux CI 的 WebView e2e 作为自动化证据；若被拦，兜底为在桌面态放行 `ipc:`/`http://ipc.localhost` 到 pi-web server 的 CSP `connect-src`（该放行仅在桌面壳加载时生效，不影响浏览器部署） |
| R2 | 进程树收尾在 Rust 侧复刻不全，孙进程（pi runner）成孤儿占端口 | `cargo test` 断言「stop 后孙进程不存活且端口可再占」；`desktop-no-node.mjs` 黑盒复验端口释放 |
| R3 | 「就绪超时 vs 后端早退」误判（Electron 侧曾踩过） | Rust 侧在 stop 前快照进程退出状态；`cargo test` 对两种失败各断言一次 |
| R4 | sidecar node 落在 `Contents/MacOS/` 而 `dist/` 落在 `Contents/Resources/`，路径推导错误导致 packaged 态起不来 | `resolve_artifact` 单测按平台断言两条路径；`desktop-packaged.mjs` 是唯一能抓到此类回归的验证 |
| R5 | 包体净收益不达 25% 阈值，迁移动机落空 | Requirement 11.5 已规定停止并交回裁定；不默认继续 |
| R6 | Rust 编排层与 `bin/pi-web.mjs` 的就绪语义漂移 | design 的契约表为单一事实源；两侧单测各自断言 |
| R7 | macOS 无 WebDriver，「渲染层经桥拿到路径」在 macOS 无端到端覆盖 | 该路径由 Linux CI 的 WebView e2e 覆盖；macOS 侧由 `cargo test` 覆盖归一化逻辑 + 黑盒覆盖其余三条 |

## References

- [Tauri v2 Sidecar](https://v2.tauri.app/develop/sidecar/) — externalBin 命名规则与落盘位置
- [Tauri v2 Resources](https://v2.tauri.app/develop/resources/) — 随包目录树与 `resource_dir()`
- [Tauri v2 Capabilities](https://v2.tauri.app/security/capabilities/) — `remote.urls` 与 permission 声明
- [Tauri v2 Config Reference](https://v2.tauri.app/reference/config/) — bundle targets / csp / withGlobalTauri
- [Tauri v2 Dialog Plugin](https://v2.tauri.app/plugin/dialog/) — `pick_folder`
- [Tauri v2 WebDriver Testing](https://v2.tauri.app/develop/tests/webdriver/) — macOS 不支持
- [PathResolver (docs.rs)](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html) — 三平台 resource_dir 位置
- [tauri-action](https://github.com/tauri-apps/tauri-action) — CI 输入参数与 target 矩阵
- [tauri#11934](https://github.com/tauri-apps/tauri/issues/11934) — 远端 URL 不注入全局（本 spec PoC 实测 2.11.5 不复现）
- [tauri#11992](https://github.com/tauri-apps/tauri/issues/11992) — sidecar 破坏 macOS 签名（本 spec 未签名分发，规避）
- [GHSA-7gmj-67g7-phm9](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9) — 须 ≥ 2.11.1
- [tauri#3273](https://github.com/tauri-apps/tauri/discussions/3273) — shell plugin 不管孙进程
- [Node.js dist v22.22.0](https://nodejs.org/dist/v22.22.0/) — sidecar 二进制与官方校验和
- 本地 PoC 证据：`evidence/poc-invoke-strict-csp.log`、`evidence/poc-src/`
