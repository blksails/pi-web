# 20 · 桌面版（Tauri）打包与分发

**pi-web 的第二种交付形态：一个 Tauri v2 薄壳，把 [19 部署与运维](./19-deployment.md) 里那个 `dist/server.mjs` 后端连同一个随包 Node 运行时打进 `.dmg` / `.exe` 安装器 / `.AppImage`，让用户双击即用、无需预装 Node。** 壳本身不承载业务逻辑——它只负责解包运行时、受监管地拉起后端、就绪后把窗口导航到本地回环 UI，并在退出时干净地收尾整棵进程树。

> **范围纪律（务必先读）**
> 桌面壳在 main 上真实存在（`desktop/src-tauri/` 为一个 git-tracked 的 Rust crate），两个相关 spec（`electron-to-tauri`、`shared-runtime-payload`）当前 phase 均为 **`implemented-partial`**。**只有 macOS 全链路（构建→打包→拉起→收尾→黑盒 e2e）经过验证**；Windows（nsis）与 Linux（appimage）的目标已在 `bundle.targets` 声明、代码含对应分支，但**跨平台尚未端到端验证**。本章凡涉及 Windows/Linux 之处均如实标注「未验」。

---

## 20.1 架构总览

桌面壳是 Tauri v2 应用，可执行名恒为 `pi-web`（`desktop/src-tauri/Cargo.toml:10-12`）。它与 Electron 时代最大的不同：**壳里没有 Node**，Node 是作为一个独立的 sidecar 二进制随包，业务后端仍是同一个 `dist/server.mjs`。

```
┌─ pi-web.app（或 .exe / .AppImage）────────────────────────┐
│                                                            │
│  Tauri 薄壳（Rust，main.rs）                                │
│    ├─ 建窗 + 随包加载页（先于一切，杜绝空白窗口）           │
│    ├─ 判定运行模式（packaged / dev / unpackaged）          │
│    ├─ 解包共享运行时（首启一次）                            │
│    ├─ 受监管拉起后端 → 就绪探针 → 导航到 127.0.0.1:<port>  │
│    └─ 退出时收尾进程树（SIGTERM→SIGKILL / taskkill /T）    │
│                                                            │
│  随包资源：                                                 │
│    ├─ binaries/node        （externalBin，Node v22.22.0）  │
│    └─ payload/             （resources：压缩后端载荷）      │
│         ├─ dist.tar.zst    （zstd 压缩的 dist/ 树）        │
│         ├─ payload.json    （摘要/版本/条目数）            │
│         └─ unpack.mjs      （零依赖单文件解包器）          │
└────────────────────────────────────────────────────────────┘
        │ 随包 node 执行 unpack.mjs（首启）
        ▼
   ~/.pi/web/runtime/<version>-<digest>/dist/server.mjs
        │ 随包 node 拉起（注入 PORT / PI_WEB_NODE_BIN …）
        ▼
   Hono 后端（127.0.0.1:<port>）─── spawn ──▶ pi runner 孙进程
```

关键身份信息（`desktop/src-tauri/tauri.conf.json`）：

| 字段 | 值 |
| --- | --- |
| `productName` | `pi-web` |
| `identifier` | `com.blksails.pi-web-desktop` |
| `version` | `0.2.0` |
| `bundle.category` | `DeveloperTool` |
| `bundle.targets` | `["dmg", "nsis", "appimage"]` |
| `bundle.externalBin` | `["binaries/node"]` |
| `bundle.resources` | `{"../../payload/": "payload/"}` |
| `macOS.minimumSystemVersion` | `10.15` |

Tauri 依赖下限钉死 **2.11.1**（`Cargo.toml:19`），因为更低版本存在 `is_local_url()` 在 Windows/Android 的 origin 绕过（GHSA-7gmj-67g7-phm9）。`profile.release` 走 `opt-level="s" + lto + strip + panic="abort"`（`Cargo.toml:38-44`）——薄壳无热点计算，一切换体积。

> `tauri.conf.json` 里的 `frontendDist: "frontend"` 与 `app.security.csp` 只作用于**壳自带的加载页/错误页**（`tauri://` 资源），不是聊天 UI。窗口就绪后会导航到回环后端，那之后生效的是**服务端自己的 CSP**（`productionCsp()`，见 [19 部署与运维 §生产 CSP](./19-deployment.md)）。

---

## 20.2 三种安装包形态

一次 `tauri build` 依 `bundle.targets` 产出三平台安装物：

| 目标 | 产物 | 平台 | 验证状态 |
| --- | --- | --- | --- |
| `dmg` | `pi-web_0.2.0_<arch>.dmg` | macOS | **全链路已验** |
| `nsis` | `pi-web_0.2.0_x64-setup.exe` | Windows | 代码含分支，**跨平台未验** |
| `appimage` | `pi-web_0.2.0_amd64.AppImage` | Linux | 代码含分支，**跨平台未验** |

可执行名之所以显式钉死为 `pi-web`（而非从包名派生），是因为 Linux 的 AppImage 拒绝含 `@` 的派生名——旧 electron-builder 曾从 `@blksails/pi-web-desktop` 派生出非法名（`Cargo.toml:8-9` 注释）。

---

## 20.3 随包 Node 运行时（sidecar）

后端要跑，就得有 Node。桌面壳把官方 Node **v22.22.0** 作为 sidecar 随包（`desktop/node-sidecar.lock.json`），四个目标各带一个可 code-review 的信任锚点：

| triple | 归档 | 校验对象 |
| --- | --- | --- |
| `aarch64-apple-darwin` | `node-v22.22.0-darwin-arm64.tar.xz` | 官方压缩包 sha256 |
| `x86_64-apple-darwin` | `node-v22.22.0-darwin-x64.tar.xz` | 官方压缩包 sha256 |
| `x86_64-unknown-linux-gnu` | `node-v22.22.0-linux-x64.tar.xz` | 官方压缩包 sha256 |
| `x86_64-pc-windows-msvc` | `node-v22.22.0-win-x64.zip` | 官方压缩包 sha256 |

**信任模型**（`node-sidecar.lock.json` 头注释 + `scripts/fetch-node-sidecar.mjs:1-13`）：

- 校验和入库、可 review；构建脚本只比对本文件，**不信任下载来的 `SHASUMS256.txt`**（它与二进制同源，上游被篡改会一并被改）。
- sha256 校验的对象是**官方压缩包**而非解压后的 `bin/node`（后者随 tar 实现与 strip 而变，不稳定）。
- 升级 Node = 一次显式的、可 code-review 的提交。
- 二进制本身不入库（strip 后仍约 86MB/个），由 `pnpm desktop:sidecar` 按需 fetch 并校验，落到 `desktop/src-tauri/binaries/`（`.gitignore` 已排除）。

> ★ **`fetch-node-sidecar.mjs` 是编译的前置步骤，不止是打包步骤**：Tauri 的 `externalBin` 在 `cargo build` 期即校验文件存在（带 target triple 后缀，如 `node-aarch64-apple-darwin`），打包时后缀被剥离、落到主可执行同目录。因此**没先 fetch sidecar，`cargo check`/`tauri build` 会直接失败**。

打包后随包 node 恒在**主可执行同目录**（macOS 为 `Contents/MacOS/node`），与 `payload/`（来自 `resource_dir()`）来源不同、**不可混用**（`resolve_artifact.rs:6-9`）。

---

## 20.4 共享运行时载荷与首启解包

`dist/` 本身**不再随包**。它被压成一份载荷随包，首次启动时解包到用户目录下的共享运行时——CLI（[18 CLI](./18-cli.md)）与桌面壳复用同一套解包语义。

### 打包侧：生成载荷

`scripts/pack-payload.mjs` 把 `dist/` 打成 `payload/dist.tar.zst` + `payload/payload.json`（`pack-payload.mjs:1-17`）：

- **zstd 级别 19**（实测 9.4MB / 打包约 21s；级别 3 为 13.2MB / 1.2s——21 秒是每次发布的一次性成本，3.8MB 是每次用户下载的重复成本）。
- **`follow: true` 展开符号链接是必需而非优化**：`dist/node_modules/@blksails/pi-web-*` 在 POSIX 上是指向 `../../packages/*` 的符号链接；若归档里留着符号链接，Windows 解包会重演 realpath EPERM 坑。代价：`packages/*` 被复制一份，解包树比 `dist/` 多约 489 文件 / 4MB。
- 摘要（sha256）取**压缩后的载荷字节**而非内容树，与解包时的流式校验同口径；「归档正确但写盘出错」由 `payload.json` 的 `entries` 文件计数兜底。

`scripts/build-unpacker.mjs` 用 esbuild 把 `src/runtime/unpack.src.mjs` 打成**零运行时依赖的单文件** `payload/unpack.mjs`（约 115KB，内联 npm `tar`）。之所以必须内联：解包器运行时没有 `node_modules` 可用——它正是用来解包出那棵 `node_modules` 的（chicken-and-egg，`build-unpacker.mjs:5-9`）。

### 运行侧：Rust 只 spawn，不实现解包

关键设计约束（`desktop/src-tauri/src/unpack_runtime.rs:1-16`）：**解包语义只有一份**，在 `payload/unpack.mjs` 里。桌面壳既然已经必须持有随包 node（用来拉后端），就用同一个二进制去执行同一个解包器。Rust 侧只负责 spawn、超时、把单行 JSON 翻成判别式错误——**绝不新增归档/压缩 crate**，否则「锁该等多久」「什么算损坏」「GC 删什么」会有两份实现并必然漂移。

进程边界契约（`unpack_runtime.rs:11-16`）：

```
node unpack.mjs --payload-dir <dir> --json
  → stdout 恰好一行 JSON（诊断走 stderr）
  → 成功: {"ok":true,"serverJs":…,"runtimeRoot":…,"runtimeDir":…,"unpacked":…}
  → 失败: {"ok":false,"code":…,"message":…}，退出码 1
```

Rust **只消费 `code`，从不解析人类可读的 `message`**（`parse_ensure_output`，`unpack_runtime.rs:46-86`；解析取最后一个非空行，因为 node 或其加载的模块偶尔会往 stdout 多写东西）。

解包落点：默认 `~/.pi/web/runtime/<version>-<digest>/`，可经 `PI_WEB_RUNTIME_ROOT` 覆盖（`src/runtime/unpack.src.mjs` 的 `defaultRuntimeRoot`）。`<digest>` 是载荷字节 sha256 前 12 位——版本相同但内容变了也会落到不同目录。

### 判别式错误码

解包失败一律进壳的可重试错误页（绝不静默退出，`main.rs:154-161`）。错误码与用户文案（`describe_unpack_error`，`unpack_runtime.rs:145-157`）：

| `code` | 含义 | 用户文案要点 |
| --- | --- | --- |
| `payload-missing` | 载荷/解包器缺失 | 请重新安装应用 |
| `payload-corrupt` | 摘要不匹配 | 请重新安装应用 |
| `zstd-unsupported` | 随包 Node 不支持 zstd 解压 | 应用可能已损坏 |
| `runtime-root-unwritable` | 运行时目录不可写 | 检查权限，或设 `PI_WEB_RUNTIME_ROOT` |
| `disk-full` | 磁盘空间不足 | 清理磁盘后重试 |
| `lock-timeout` | 等其他进程解包超时 | 确认无实例卡住后重试 |
| `extract-failed` | 解包器未按契约跑起来（空输出/非 JSON/缺字段） | 通用失败 |

> 这些错误码同样出现在 [23 故障排查 / FAQ](./23-troubleshooting-faq.md) 的桌面版首启小节，含逐条自救步骤。

### 旧运行时回收（GC）

后端**拉起成功之后**才触发（GC 不得阻塞后端拉起，`main.rs:186-190`），尽力而为、不等待、失败不报（`spawn_gc`，`unpack_runtime.rs:124-142`）：

```
node unpack.mjs --gc --runtime-root <root> --keep <当前运行时目录>
```

回收判据是刻意保守的多重条件（`selectGcVictims`，`src/runtime/unpack.src.mjs:119-142`）——宁可留着也不误删正被其他实例使用的运行时：

- 当前正在使用的运行时目录（`--keep`）**永不入选**。
- 其余运行时目录按最近使用时间降序，**保留最近 2 个**（`GC_KEEP=2`）；再往后的仅在**超过 7 天**（`GC_MIN_AGE_MS`）时才删除。
- 残留的 `.staging-` / `.trash-` 临时目录与陈旧 `.lock-` 锁目录按各自年龄阈值清理（`GC_TEMP_AGE_MS` / `STALE_LOCK_MS`）。

---

## 20.5 运行模式三态判定

`resolve_runtime_mode(dev_url, is_packaged)`（`runtime_mode.rs:19-29`）以「是否打包态」为主判据，叠加显式开发开关：

| 模式 | 条件 | 行为 |
| --- | --- | --- |
| **packaged** | 打包态 | 从随包 `payload/` 解包 → 拉后端 |
| **dev** | 未打包 **且** `PI_WEB_DESKTOP_DEV_URL` 非空 | 导航到该 URL，**不拉后端**（保留前端热更新） |
| **unpackaged** | 未打包 **且** 无 dev url | 直跑构建产物 `dist/server.mjs`（e2e 与本地非打包路径） |

★ **安全约束（有单测钉住）**：打包态即便设了 `PI_WEB_DESKTOP_DEV_URL` 也**强制走 packaged**，绝不走 dev 分支——防止分发出去的应用连到某个开发服务器（`runtime_mode.rs:50-53`，单测 `packaged_takes_precedence_over_dev_url`）。

---

## 20.6 受监管拉起后端与就绪探针

`ServerSupervisor::start`（`server_supervisor.rs:129-243`）：选空闲回环端口 → 用**随包 node** spawn `server.mjs`（置为独立进程组组长）→ 复用就绪探针等待可用 → 返回 url，或判别式启动错误（失败时先收尾已拉起的进程，不留孤儿）。

**注入子进程的环境覆盖项**（`build_child_env`，`server_supervisor.rs:76-98`）：

| 键 | 值 | 用途 |
| --- | --- | --- |
| `PORT` | 选定的空闲端口 | 后端监听 |
| `HOSTNAME` | `127.0.0.1` | 后端绑定 |
| `PI_WEB_AUTOSTART` | `1` | 令后端自动起会话（与 CLI 同一注入方——见 [06 配置 · PI_WEB_AUTOSTART](./06-configuration.md)，不止 CLI 一个来源） |
| `PI_WEB_NODE_BIN` | 随包 node 绝对路径 | **供 pi runner 孙进程复用同一个随包 node** |

★ **刻意不注入 `PI_WEB_AGENT_DIR`**（`server_supervisor.rs:75`，单测 `child_env_never_generates_agent_dir`）：使会话默认落 `~/.pi/agent`，与 CLI 共享同一份 agent 配置。但**用户显式设置**的 `PI_WEB_AGENT_DIR` 会被继承（子进程继承父环境，`HOME`/`PATH` 也由此可达）。另会**剥除** `ELECTRON_RUN_AS_NODE`（Electron 残留，Tauri 下无意义，`STRIPPED_ENV_KEYS`）。

**就绪探针**（`ready_probe.rs` 头部契约表，与 `bin/pi-web.mjs` 同步）：

| 行为 | 取值 |
| --- | --- |
| 最大端口尝试次数 | 20（从 `start_port` 递增） |
| 「被占」判据 | TCP connect 成功 |
| 就绪探测端点 | `GET /` |
| 就绪判据 | **任何 HTTP 响应**（不看状态码） |
| 轮询间隔 / 单次请求超时 | 300ms / 2000ms |
| 就绪总超时 | 60_000ms |
| 中止条件 | 子进程已退出 → 立即失败 |

★ **快照先于收尾**（`server_supervisor.rs:213-215`，单测 `ready_timeout_is_not_misclassified_as_early_exit`）：探针失败时必须**先读**子进程退出状态快照，**再** `stop()`。否则 `stop()` 杀掉仍存活的 server 会把 `ReadyTimeout` 误判成 `EarlyExit`。判别式启动错误共三类：`NoFreePort` / `EarlyExit`（带退出码 + stderr 尾部）/ `ReadyTimeout`，各自映射到可读错误页文案（`startup_error.rs`）。

---

## 20.7 进程树收尾（不留孤儿）

后端会 spawn pi runner **孙进程**，因此收尾必须触达整棵进程树（`server_supervisor.rs:245-297`）：

- **POSIX**：server 被 `process_group(0)` 置为独立进程组组长；收尾时对**负 pid** 发 `SIGTERM`（`killpg`，触达孙进程），3s 宽限期后升级 `SIGKILL`，5s 硬兜底。**不使用 `tauri_plugin_shell` 的 Command**——它不暴露进程组，其 `kill()` 只杀直接子进程，触不到孙进程（`server_supervisor.rs:6-8`）。
- **Windows（未验）**：`taskkill /PID <pid> /T /F`（`/T` 树 / `/F` 强制）。

★ **信号处理是必需而非锦上添花**（`main.rs:222-245`）：**tao 不处理 SIGTERM/SIGINT**——进程会被内核直接终止，`RunEvent::ExitRequested` 与 `Drop` 都不执行，于是 server 与 runner 成孤儿、端口不释放（实测证实）。壳用 `signal-hook` 捕获这两个信号并转调 `app.exit(0)`，正常走 `ExitRequested → stop()` 退出路径。macOS 黑盒 e2e（无 WebDriver）正是靠这条信号退出路径。

`stop()` 幂等，`ServerSupervisor` 的 `Drop` 也会兜底调用它。

---

## 20.8 原生目录选择桥

渲染层（回环 UI）唯一可触达的「文件系统相关」宿主能力，用于「选择 agent 目录」这类交互（`dialog.rs:1-15`）：

- 渲染层经 `invoke('pick_directory')` 调用，返回 `Option<String>`——**只回传被选目录的绝对路径字符串**，静态保证不回传目录内容、文件列表或任何 fs 元数据。
- **取消 / 无选择 / 异常 → 一律「无结果」，绝不使 IPC reject**（`normalize_pick_result`，`dialog.rs:26-43`）；异常记 stderr。
- 授权：应用自身的 command 被回环 UI 调用时，须在 `permissions/pick-directory.toml` 声明 `allow-pick-directory` 并加入 capability；渲染层**不**授予 `dialog:allow-open`——对话框由 Rust 侧调用。
- e2e 接缝：非空 `PI_WEB_DESKTOP_STUB_PICK_DIR` 时直接返回该路径、不弹对话框（只改对话框来源，不放宽任何 permission，`dialog.rs:13-15`）。

相关地，**外链治理**（`external_link.rs` + `window.rs`）：应用内导航拦截三分支——本应用页面（`tauri://` 资源或已拉起的回环 origin）放行；非回环 http(s) 交系统默认浏览器；其余（非 http(s) scheme、其他主机的回环、非法 url）一律拒绝，防止把不受信输入交给系统 opener。

---

## 20.9 桌面版专属环境变量

桌面壳读取的输入 env（`grep PI_WEB_ desktop/src-tauri/src`）：

| 变量 | 默认 | 作用 | 证据 |
| --- | --- | --- | --- |
| `PI_WEB_DESKTOP_PORT` | `3000` | 后端起始探测端口 | `main.rs:48-53` |
| `PI_WEB_DESKTOP_DEV_URL` | 未设 | dev 模式加载地址（打包态忽略） | `runtime_mode.rs:13` |
| `PI_WEB_DESKTOP_SERVER_JS` | 未设 | 覆盖 unpackaged 态后端入口 | `resolve_artifact.rs:22` |
| `PI_WEB_RUNTIME_ROOT` | `~/.pi/web/runtime` | 共享运行时解包根 | `unpack.src.mjs` |
| `PI_WEB_DEFAULT_SOURCE` | 未设 | 后端 base env 默认 agent 源 | `main.rs:58` |
| `PI_WEB_DEFAULT_CWD` | 当前目录 | 后端 base env 默认 cwd | `main.rs:63` |
| `PI_WEB_DESKTOP_STUB_PICK_DIR` | 未设 | e2e：跳过原生对话框返回该路径 | `dialog.rs:21` |

壳**向后端注入** `PORT`/`HOSTNAME`/`PI_WEB_AUTOSTART=1`/`PI_WEB_NODE_BIN`；**刻意不注入** `PI_WEB_AGENT_DIR`（见 §20.6）。完整 env 清单参见 [06 配置参考](./06-configuration.md) 的桌面版分组。

---

## 20.10 从源码构建（macOS，已验路径）

以下步骤在 macOS + Apple Silicon 上全链路验证过。

1. **构建自包含产物并生成载荷**（这一步已内含 `build:unpacker` + `build:payload`）：
   ```bash
   pnpm build:dist
   ```
   预期：产出 `dist/client`、`dist/server.mjs`，以及 `payload/dist.tar.zst` + `payload/payload.json` + `payload/unpack.mjs`。

2. **取得随包 Node sidecar**（必须早于 `tauri build`——`cargo build` 期即校验其存在）：
   ```bash
   pnpm desktop:sidecar          # 本机 triple；CI 交叉构建加 --target <triple>
   ```
   预期：`desktop/src-tauri/binaries/node-<triple>` 落盘，sha256 与 `node-sidecar.lock.json` 一致；不一致或缺失即非零退出。

3. **打包**：
   ```bash
   pnpm desktop:build            # = tauri build，依 bundle.targets 产出 dmg/nsis/appimage
   ```
   预期：macOS 下 `desktop/src-tauri/target/release/bundle/dmg/pi-web_0.2.0_*.dmg`。

4. **首启验证**：安装并打开，或直接跑打包态 e2e：
   ```bash
   pnpm e2e:desktop:packaged     # 黑盒：解包→拉起→就绪→收尾（macOS 已验）
   ```
   预期：首启日志出现 `[desktop] 首次启动，已解包运行时 → ~/.pi/web/runtime/0.2.0-<digest>`，窗口导航到 `http://127.0.0.1:<port>`。

> 本地**未打包**开发（跑 Rust 壳但用仓库内 `dist/server.mjs`）：`pnpm build:dist` 后进 `desktop/` 跑 `pnpm dev`（`tauri dev`）。若要壳加载已运行的 Vite dev（[01 快速开始](./01-quickstart.md) 的 `pnpm dev` 起在 5173），设 `PI_WEB_DESKTOP_DEV_URL=http://localhost:5173` 走 dev 模式（不拉后端）。

---

## 20.11 体积与冷启动（macOS arm64 实测）

下列数字取自 git-tracked 的 `.kiro/specs/shared-runtime-payload/evidence/measure-summary.json`（2026-07-09，macOS 24.6.0 / Apple Silicon；`before` 为 Electron 基线，`after` 为 Tauri + 共享运行时载荷）。**仅 macOS arm64，其他平台/架构未测。**

| 指标 | before（Electron） | after（Tauri） |
| --- | --- | --- |
| `.app` | 177 MB | 101 MB |
| dmg | 81.4 MB | 47.6 MB |
| npm 包（CLI） | 86 MB | 10 MB |
| 解包后 runtime | — | 89 MB |
| 桌面单装磁盘 | 177 MB | **190 MB** |
| 桌面 + CLI 都装磁盘 | 263 MB | 200 MB（−24%） |
| 稳态冷启中位数 | 1101 ms | 1137 ms |
| 首次冷启（含解包） | — | 6974 ms |

★ **「桌面单装反而 +13MB」是固有取舍**：安装包里存着压缩载荷（约 47.6MB 的 dmg 内含约 9.4MB 的 `dist.tar.zst`），首启又把它解包成一份 89MB 的 runtime，两份各存一份。收益在「桌面 + CLI 都装」场景：两者复用同一份共享运行时，总磁盘从 263MB 降到 200MB。首次冷启因含一次性解包而显著偏高（约 6974ms），稳态回到约 1137ms。

---

## 20.12 测试面

| 命令 | 覆盖 | 平台 |
| --- | --- | --- |
| `pnpm --filter @blksails/pi-web-desktop test` | Rust 单测（模式判定/env 组装/进程树收尾/解包解析/外链/目录选择） | 全平台可跑 |
| `pnpm e2e:desktop:real` | 未打包态黑盒（真实 server + 收尾） | macOS 已验 |
| `pnpm e2e:desktop:packaged` | 打包态黑盒（含首启解包） | macOS 已验 |
| `pnpm e2e:desktop:nonode` | 缺随包 node 的失败路径 | macOS 已验 |
| `pnpm e2e:desktop:corrupt` | 载荷损坏 → `payload-corrupt` 错误页 | macOS 已验 |
| `pnpm e2e:runtime:conc` / `:recovery` | 共享运行时解包并发锁 / 崩溃恢复 | macOS 已验 |

Rust 单测覆盖面很广（例如 `stop_kills_grandchild_and_frees_port` 用真实子/孙进程验证进程树收尾、`ready_timeout_is_not_misclassified_as_early_exit` 钉住快照时序），是本壳最可靠的回归网。

---

## 相关链接

- 后端本身的构建/部署/CSP（桌面壳复用其 `dist/server.mjs`）→ [19 部署与运维（Web 服务端）](./19-deployment.md)
- CLI 启动器与共享运行时首启解包（同一套 `unpack.mjs` 语义）→ [18 CLI](./18-cli.md)
- 桌面专属与注入 env 的完整表 → [06 配置参考](./06-configuration.md)
- 首启解包错误码逐条自救 → [23 故障排查 / FAQ](./23-troubleshooting-faq.md)
- 后端受监管拉起在整体架构中的位置 → [03 系统架构](./03-architecture.md)
- Web 开发期的双进程启动（对照桌面 dev 模式）→ [01 快速开始](./01-quickstart.md)
