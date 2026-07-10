# Implementation Plan

> 排序即风险控制：本迁移原地替换、无并存壳、无回滚开关。任务 4 的 macOS 全链是**关键闸门**，未跑绿前不得铺其他平台（任务 6 起）。Electron 残留保留至任务 9 才删，在此之前作为行为对照的活参考。

## ⚠ 已知的自动化覆盖盲区（独立 reviewer 认定，须在收口前决断）

下列 EARS 条目**当前只有本机手工验证，无自动化证据**，且 Req 10.5 要求的「不依赖图形界面的自动化测试」对它们实质空白：

| 需求 | 内容 | 现状 |
|---|---|---|
| 1.6 | macOS Dock 激活重开窗口 | `main.rs` 有 `RunEvent::Reopen`，但 `cargo test` 无法驱动真实 Tauri runtime 事件 |
| 1.7 | 非 macOS 窗口全关即退出 | 同上；且本机为 macOS，该分支未被执行过 |
| 3.5 | 错误页「重试」按钮 | 需 GUI 交互；macOS 无 WebDriver |
| 3.6 | 错误页「退出」按钮 | 同上 |

任务 6.1 的 Linux WebDriver e2e **只测 `pick_directory`，不测 `retry`/`quit`**，故即便它跑通也不能根治该盲区。须明确裁定这是永久性盲区（接受）还是待办（补 WebDriver 用例）。

## 1. 骨架与编排层纯函数（Foundation）

- [x] 1.1 建立 Tauri Rust crate 骨架并使其可编译
  - 在 `desktop/src-tauri/` 建 `Cargo.toml`、`build.rs`、`tauri.conf.json`、`src/main.rs` 最小入口
  - `Cargo.toml` 依赖：tauri `2.11.5`（约束 `>=2.11.1` 以规避 GHSA-7gmj-67g7-phm9）、**`tauri-plugin-dialog` v2**（任务 5.1 用）、**`tauri-plugin-opener` v2**（任务 4.1 用），并在 `main.rs` 预留 `.plugin()` 注册位
  - `tauri.conf.json` 必须**一次配齐**下列各项，否则 `tauri build` 会成功但产出空壳，且只有任务 4.7 才捕获得到：
    - `productName: pi-web`（使 Linux 可执行名不含 `@`）、`withGlobalTauri: true`、`frontendDist` 指向 `src-tauri/frontend/`
    - **`bundle.externalBin: ["binaries/node"]`** —— 随包 JS 运行时。任务 2.2 的「node 落在主可执行同目录」这一路径假设正是由它成立
    - **`bundle.resources`** —— 把自包含产物 `dist/` 整目录纳入随包资源
    - **`bundle.targets`** —— macOS `dmg`、Windows `nsis`、Linux `appimage`
  - 放置 `icons/icon.png`（**必须是 RGBA PNG**，缺失或格式错会使 `tauri::generate_context!` 在编译期 panic）
  - 把原 `desktop/static/loading.html` 迁为 `src-tauri/frontend/index.html`（同时承载加载态与错误态）
  - 定义 `src/types.rs`：`RuntimeMode`、`ServerStartError`（三态判别式）、`ReadyError`、`ArtifactPaths`、`ResolveError`；并在 crate 根**预声明各模块桩**（`mod runtime_mode; mod external_link; mod startup_error; mod ready_probe; ...`），使任务 1.3–1.6 只填各自文件、不争用根文件
  - ★**实现期实测发现**：`bundle.externalBin` 与 `bundle.resources` 的路径在 **`cargo build` 期**（而非仅 `tauri build`）即被 `tauri-build` 校验存在，缺失则报 `resource path ... doesn't exist` 并中止编译。因此本任务只负责**写配置**，其编译验证必须推迟到任务 2.1（取得 sidecar）与一次 `pnpm build:dist`（产出 `dist/`）之后
  - 观察完成：备齐 `binaries/node-<本机 triple>` 与 `dist/` 后，`cargo build` 成功产出可执行文件，`cargo test` 可运行
  - _Requirements: 9.9_

- [x] 1.2 迁移桌面工作区的工具链与忽略规则
  - 改写 `desktop/package.json`：保留包名 `@blksails/pi-web-desktop` 与 workspace 成员身份，移除 `electron`/`electron-builder`/`esbuild` 依赖，**新增 `@tauri-apps/cli` devDependency**（任务 4.1/4.7/6.2/7.1 均依赖它），scripts 改为驱动 tauri CLI
  - 在 `.gitignore` 增加 `desktop/src-tauri/target/`
  - 观察完成：`pnpm install` 通过；`pnpm --filter @blksails/pi-web-desktop exec tauri --version` 能解析出 tauri CLI；`git status` 不显示 `target/`
  - _Requirements: 9.9_

- [x] 1.3 (P) 实现运行模式判定纯函数 + 单测
  - 依「是否打包态」为主判据，叠加显式开发开关：未打包且 `PI_WEB_DESKTOP_DEV_URL` 非空 → dev；打包态 → packaged；否则 → unpackaged
  - 空白（仅空格）的 dev url 不得判为 dev
  - 观察完成：`cargo test` 覆盖四分支——unpackaged+devUrl → dev；packaged 优先于 devUrl；无 devUrl → unpackaged；空白 devUrl → 非 dev
  - _Requirements: 1.1, 1.2, 1.3_
  - _Boundary: desktop/src-tauri/src/runtime_mode.rs_

- [x] 1.4 (P) 实现外链放行判定纯函数 + 单测
  - **先校验 scheme 再校验 host**：仅非回环 `http`/`https` 放行外开；回环（`127.0.0.1`/`localhost`/`::1`，注意 `[::1]` 需剥方括号）拒绝；非 `http(s)` scheme（`file:`/`javascript:`/`data:`）拒绝；非法 URL 拒绝且不 panic
  - 观察完成：`cargo test` 覆盖上述四类共至少 7 个用例，全部返回预期决策
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 10.5_
  - _Boundary: desktop/src-tauri/src/external_link.rs_

- [x] 1.5 (P) 实现启动失败三态可读描述纯函数 + 单测
  - 消费 `ServerStartError` 三态，产出用户可读文案：无可用端口（含起始端口）、后端早退（含退出码与 stderr 尾部）、就绪超时（含等待时长）
  - 后端早退且无任何 stderr 输出时仍须产出可读文案，不得出现空描述
  - 观察完成：`cargo test` 覆盖三态各一例 + 「早退无 stderr」一例，断言文案分别包含退出码、时长、端口起点
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: desktop/src-tauri/src/startup_error.rs_

- [x] 1.6 (P) 实现端口选取与就绪探针 + 契约单测
  - `find_free_port`：从起始端口递增最多 20 次；TCP `connect` 成功=被占，出错或 `1000ms` 超时=空闲；`0.0.0.0`/`::` 探测时映射为 `127.0.0.1`；全占返回「无」
  - `wait_for_ready`：轮询 `GET /`，**任何 HTTP 响应即视为就绪**（不看状态码）；轮询间隔 `300ms`，总超时 `60_000ms`，单次请求超时 `2_000ms`；经注入的 `is_exited` 闭包感知子进程退出并立即返回 `Aborted`
  - 这是与 `bin/pi-web.mjs` 的唯一契约同步点，取值须严格对齐 design 的「就绪与端口契约」表
  - 观察完成：`cargo test` 覆盖——全占端口返回「无」；`0.0.0.0` 映射生效；起一个本地 server 返回 500 也判就绪；`is_exited` 为真 → `Aborted`；不起 server 且短超时 → `Timeout`
  - _Requirements: 2.1, 2.2, 2.4, 8.2, 10.5_
  - _Boundary: desktop/src-tauri/src/ready_probe.rs_

## 2. 随包 JS 运行时（sidecar）

- [x] 2.1 (P) 实现 sidecar 二进制获取脚本与校验和锁文件
  - 新建 `desktop/node-sidecar.lock.json`：记录 Node 版本（`v22.22.0`）与四个 target triple 对应**官方压缩包**的期望 sha256（`aarch64-apple-darwin`/`x86_64-apple-darwin`/`x86_64-unknown-linux-gnu`/`x86_64-pc-windows-msvc`）
  - 新建 `scripts/fetch-node-sidecar.mjs`：按 triple 下载官方压缩包 → 比对**入库** sha256（**不信任上游 `SHASUMS256.txt`**，因其与二进制同源）→ 解压取 `bin/node` → `strip`（省约 21MB）→ 重命名为 `node-<triple>` 放入 `desktop/src-tauri/binaries/`（该目录 gitignored）
  - 幂等：目标文件已存在且能报出正确版本则跳过下载（不比对 strip 后二进制的哈希——它与压缩包无关）
  - ★**实现期实测发现**：macOS 上 `strip` 会使 Node 官方二进制内嵌的代码签名失效，内核随即以 **SIGKILL(137)** 拒绝执行它。必须紧接着 ad-hoc 重签名（`codesign --force --sign -`）。这不改变「未签名分发」现状——ad-hoc 签名只让二进制自洽可执行，不涉及开发者身份
  - 产出后须**自检**（对本机 triple 执行 `--version`），使「产出了一个跑不起来的二进制」当场失败，而非留到壳启动时
  - **校验和不匹配时必须打印期望值与实际值并以非零码退出**，使 CI 构建随之失败
  - 在 `.gitignore` 增加 `desktop/src-tauri/binaries/`（防止 86MB 的二进制误入库）
  - 观察完成：本机执行 `node scripts/fetch-node-sidecar.mjs --target aarch64-apple-darwin` 产出 `binaries/node-aarch64-apple-darwin` 且 `--version` 输出 `v22.22.0`；篡改 lock 中的 sha256 后重跑，脚本非零退出；`git status` 不显示 `binaries/`
  - _Requirements: 5.1, 9.3, 9.4_
  - _Boundary: scripts/fetch-node-sidecar.mjs, desktop/node-sidecar.lock.json_

- [x] 2.2 (P) 实现产物入口与 sidecar 路径推导 + 单测
  - `resolve_artifact`：dev → 不拉起后端；packaged → `resource_dir()/dist/server.mjs`；unpackaged → 构建产物布局入口（e2e 经 `PI_WEB_DESKTOP_SERVER_JS` 覆盖）
  - **硬约束**：返回的入口必须位于产物根，其父目录即子进程 cwd（否则 `packages/server` 的路径解析回退失效）
  - **易错点**：sidecar node 落在**主可执行同目录**（`current_exe()` 的父目录，macOS 为 `Contents/MacOS/`），而 `dist/` 落在 `resource_dir()`（macOS 为 `Contents/Resources/`）—— 两者路径来源不同，不可混用。Windows 上 node 文件名为 `node.exe`
  - packaged 态缺 `resource_dir` → 返回明确错误而非 panic
  - 观察完成：`cargo test` 覆盖——packaged 入口拼接正确；`node_bin` 等于 exe 同目录下的 `node`（Windows `node.exe`）；dev 返回「不拉起」；packaged 缺 resource_dir → `MissingResourceDir`
  - _Requirements: 1.2, 1.3, 5.2, 5.3, 10.5_
  - _Boundary: desktop/src-tauri/src/resolve_artifact.rs_
  - _Depends: 1.3_

## 3. 后端受监管拉起与进程树收尾

- [x] 3.1 实现后端 spawn 与环境变量注入
  - 用 `std::process::Command` spawn 随包 node 执行 `server.mjs`，cwd 设为入口所在的产物根；**不得使用 `tauri_plugin_shell` 的 Command**（它不暴露进程组，`kill()` 触不到 pi runner 孙进程）
  - POSIX 下以 `process_group(0)` 使子进程成为进程组组长，为整组收尾做准备
  - 注入环境变量：恒有 `PORT`（实际选中端口）、`HOSTNAME=127.0.0.1`、`PI_WEB_AUTOSTART=1`、`PI_WEB_DEFAULT_CWD`、`PI_WEB_NODE_BIN`（随包 node 的**绝对路径**，供 pi runner 孙进程复用）；有默认源时注入 `PI_WEB_DEFAULT_SOURCE`
  - **永不注入 `PI_WEB_AGENT_DIR`**，使会话落 `~/.pi/agent` 与 CLI 共享；亦不再注入 `ELECTRON_RUN_AS_NODE`
  - ★**实现期实测发现**：子进程必须**继承**父进程环境（不可 `env_clear()`）——否则丢失 `HOME`，server 与 pi runner 无法定位 `~/.pi/agent`，且丢失 `PATH`。正确做法是继承后覆盖特定键、并 `env_remove` 掉须剥除的键
  - 排空子进程 stdout 避免管道缓冲填满阻塞；stderr 尾部保留上限 4096 字节供诊断
  - 观察完成：`cargo test` 断言 spawn 出的子进程 env 含 `PI_WEB_NODE_BIN` 与 `HOSTNAME=127.0.0.1`，且**不含** `PI_WEB_AGENT_DIR`
  - _Requirements: 2.3, 5.2, 5.3, 5.5, 8.1_
  - _Boundary: desktop/src-tauri/src/server_supervisor.rs_

- [x] 3.2 实现启动失败的判别式分类（就绪超时与后端早退不得混淆）
  - 无空闲端口 → 返回「无可用端口」且**不 spawn 任何进程**
  - 就绪探针失败时：**必须先快照子进程的退出状态，再调用 stop()** —— 否则 stop 杀掉仍存活的 server 会把「就绪超时」误判成「后端早退」。这是 Electron 侧已踩过并修复的坑，是本任务最易出错处
  - 已退出 → 「后端早退」（带退出码与 stderr 尾部）；仍存活 → 「就绪超时」（带等待时长）
  - 任何失败返回前，其 spawn 的进程树必须已被收尾，不留孤儿
  - 观察完成：`cargo test` 覆盖三态——无空闲端口时断言未产生任何子进程；令 server 立即退出 → 得到「后端早退」且携带退出码；令 server 挂起不响应 + 短超时 → 得到「就绪超时」**而非**「后端早退」
  - _Requirements: 2.5, 2.6, 2.7, 10.5_
  - _Boundary: desktop/src-tauri/src/server_supervisor.rs_

- [x] 3.3 实现幂等的进程树收尾
  - POSIX：对进程组组长发**负 pid** 的 SIGTERM，3 秒宽限期后升级 SIGKILL；Windows：`taskkill /PID <pid> /T /F`
  - 幂等：取走并置空持有的子进程句柄，重复调用直接返回、不 panic、不挂起
  - 子进程在收尾前已自行退出 → 跳过终止动作
  - 观察完成：`cargo test` 断言——收尾后 server **及其派生的孙进程**均不存活；先前占用的端口可被重新绑定；连续两次调用收尾不 panic
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.5_
  - _Boundary: desktop/src-tauri/src/server_supervisor.rs_

## 4. macOS 全链闸门（窗口、编排、三条黑盒 e2e）

> **本组全部跑绿前，不得开始任务 6 及之后的其他平台工作。**

- [x] 4.1 实现窗口创建、加载页与就绪后导航
  - 窗口以随包 `index.html`（加载页）建立，**先于任何后端动作**，从而任何分支下都不出现空白窗口
  - 后端就绪后导航至回环 URL
  - 新窗/导航请求经外链判定：放行者交系统默认浏览器，其余一律拒绝且不在应用内开新窗
  - 观察完成：本机 `cargo run` 启动后窗口立即显示加载页；手工令后端可用时窗口切换到回环 UI
  - _Requirements: 1.4, 1.5, 7.1_
  - _Boundary: desktop/src-tauri/src/window.rs_
  - _Depends: 1.4_

- [x] 4.2 实现生命周期编排与退出收尾
  - `setup`：建窗 → 判运行模式 → dev 直接导航到开发地址且**不拉起后端**；否则解析路径 → 受监管拉起 → 成功则导航、失败则呈现错误
  - 退出请求：阻止一次退出 → 收尾后端进程树 → 放行退出；以布尔标志防重入
  - ★**实现期实测发现**：必须额外捕获 **SIGTERM/SIGINT** 并转调 `app.exit(0)`。tao 不处理这些信号，进程被直接终止 → `ExitRequested` 与 `Drop` 都不跑 → server 与 pi runner 成孤儿、端口不释放（已实测复现）。macOS 无 WebDriver，黑盒 e2e 只能经信号退出，故这是必需路径
  - macOS：无窗口时经 Dock 激活重开窗口；非 macOS：窗口全关即退出应用
  - 观察完成：本机启动后关闭窗口，`ps` 确认无残留 node 进程且端口已释放；macOS 上关窗后点 Dock 图标可重开
  - _Requirements: 1.1, 1.6, 1.7, 4.1_
  - _Boundary: desktop/src-tauri/src/main.rs_

- [x] 4.3 实现启动失败呈现与重试/退出命令
  - 失败时导航回随包页并呈现区分三类失败的可读文案（消费任务 1.5 的描述函数）
  - 提供 `retry`（重跑完整拉起流程）与 `quit`（退出应用）两个命令
  - **两个命令必须在 `permissions/lifecycle.toml` 中声明 `allow-retry`/`allow-quit` 并加入 capability**，否则从远端页面调用会被 ACL 拒绝（报 `not allowed. Plugin not found`）
  - `capabilities/default.json` 与任务 5.1 共写：**本任务只向 `permissions` 数组追加 `allow-retry`/`allow-quit` 两条**，其余键（`remote.urls`、`allow-pick-directory`）归任务 5.1 所有，不得改动
  - 观察完成：人为把入口指向不存在的 `server.mjs` 启动，窗口显示含退出码的可读错误；点「重试」重新执行拉起；点「退出」应用退出
  - _Requirements: 3.1, 3.5, 3.6_
  - _Boundary: desktop/src-tauri/src/main.rs, desktop/src-tauri/frontend/index.html, desktop/src-tauri/permissions/lifecycle.toml, desktop/src-tauri/capabilities/default.json_

- [x] 4.4 搭建黑盒 e2e 共用基础设施与一次性前提
  - 新建 `e2e/desktop/shared.mjs`：起 mock OpenAI provider（本地 SSE，回固定 token）、建临时 agent 目录（默认模型指向 mock）、启动桌面二进制、探测其拉起的回环端点、经 HTTP API 完成一次真实会话、断言 mock provider 被调用、端口释放探测、进程树断言、清理
  - **本任务一次性备齐 4.5–4.7 并行组的全部共享前提**，使并行组内无人再写共享资源：
    - 断言自包含产物 `dist/server.mjs` 存在（由 `pnpm build:dist` 产出），缺失时打印该命令并非零退出。该产物不由本 spec 拥有，三条 e2e 只读消费
    - 取本机 triple 的 sidecar（`pnpm desktop:sidecar`），并将其**拷到未打包可执行同目录**（`target/debug/`）。unpackaged 模式下 `resolve_artifact` 同样从可执行同目录取 node，故 4.5/4.6 与 4.7 一样需要它就位；`binaries/` 是 gitignored，干净检出下为空
  - 不依赖 Playwright `_electron`（Tauri 下无等价物），全部经进程与 HTTP 观察
  - ★**实现期实测发现**：孤儿进程检查**不可用** `pgrep -f <子串>` —— 它按命令行子串匹配，会命中任何命令行里碰巧含该串的进程（实测命中了跑 e2e 的 shell 自己，造成假阳性）。须按**可执行文件绝对路径前缀**匹配
  - ★**实现期实测发现**：进程表清理**晚于**端口释放，孤儿检查须与端口释放一样给收敛窗口（剥空 PATH 时 runner 退出更慢）
  - 观察完成：`node -e` 直接调用该模块的会话辅助函数，对一个手工启动的 server 能完成一次会话并返回 token；删除 `dist/` 后调用，得到指明 `pnpm build:dist` 的非零退出；`target/debug/node --version` 输出 `v22.22.0`
  - _Requirements: 10.6_
  - _Boundary: e2e/desktop/shared.mjs_
  - _Depends: 2.1, 2.2_

- [x] 4.5 (P) 实现未打包真实会话黑盒 e2e
  - 启动未打包二进制（经 `PI_WEB_DESKTOP_SERVER_JS` 指向构建产物入口）→ 断言回环端点可用 → 经该端点完成一次经 mock provider 的真实会话 → 断言 mock provider 被调用至少一次
  - 观察完成：`node e2e/desktop/desktop-real.mjs` 全部断言通过并以 0 退出
  - _Requirements: 10.1, 10.6_
  - _Boundary: e2e/desktop/desktop-real.mjs_
  - _Depends: 4.4_

- [x] 4.6 (P) 实现「无系统 Node」黑盒 e2e（不可降级）
  - 从 PATH 剥除所有含 `node`/`node.exe` 的目录，**先断言 `which node` 确已失效**，再启动应用
  - 真实会话跑通即证明 server 与 pi runner 孙进程用的是随包 node 而非系统 node
  - 应用退出后轮询断言先前端口已释放（证明进程树已收尾）
  - **本项不得以任何形式降级为「假定可用」**——它是随包 JS 运行时这一整条设计的唯一端到端证据
  - 观察完成：`node e2e/desktop/desktop-no-node.mjs` 全部断言通过并以 0 退出
  - _Requirements: 5.4, 10.1, 10.2, 4.5_
  - _Boundary: e2e/desktop/desktop-no-node.mjs_
  - _Depends: 4.4_

- [x] 4.7 (P) 实现已打包产物黑盒 e2e
  - `dist/` 与 sidecar 由任务 4.4 备齐（**本任务不得重跑 `build:dist`**——它会覆盖并行的 4.5/4.6 正在读的 `dist/`）；本任务只跑 `tauri build`（写 `target/` 与 `binaries/`，并行同伴不读这两处）产出实际 `.app`
  - 启动**打包二进制**（走 packaged 分支，靠 `resource_dir()` 定位 `dist/`）跑真实会话
  - 这是唯一能捕获「`bundle.resources` 未纳入 `dist/`」或「sidecar 落盘位置推导错误」这类仅在打包形态暴露的回归的验证
  - 观察完成：`node e2e/desktop/desktop-packaged.mjs` 全部断言通过并以 0 退出；`.app/Contents/MacOS/` 下存在 `node`，`.app/Contents/Resources/dist/` 下存在 `server.mjs`
  - _Requirements: 10.1, 10.3_
  - _Boundary: e2e/desktop/desktop-packaged.mjs_
  - _Depends: 4.4_

## 5. 原生目录选择能力桥

- [x] 5.1 实现目录选择命令与最小授权配置
  - `pick_directory` 命令：调用原生「选择文件夹」对话框，仅回传被选目录的**绝对路径字符串**；取消/无选择/异常一律回传「无结果」且不使 IPC reject；异常记 stderr
  - 返回类型静态保证不回传目录内容或任何文件系统元数据
  - 归一化逻辑抽为不依赖 Tauri 运行时的纯函数以便单测
  - **可测接缝**：读到非空 `PI_WEB_DESKTOP_STUB_PICK_DIR` 时直接返回该路径、不弹对话框（该 env 不出现在任何随包默认环境中）
  - 在 `permissions/pick-directory.toml` 声明 `allow-pick-directory` 并加入 capability；capability 的 `remote.urls` **仅含 `http://127.0.0.1:*`**（不含 `localhost`，收窄 DNS 重绑定攻击面）；**不授予** `dialog:allow-open`/`shell:allow-execute`/`fs:*`
  - 观察完成：`cargo test` 覆盖归一化四分支（选中→路径 / 取消→无 / 空选择→无 / 错误→无且不 panic）与「stub env 缺失时走真实对话框分支」
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 8.3, 8.4, 8.5, 10.5_
  - _Boundary: desktop/src-tauri/src/dialog.rs, desktop/src-tauri/permissions/pick-directory.toml, desktop/src-tauri/capabilities/default.json_

- [x] 5.2 (P) 改造前端能力桥访问器 + 单测
  - `getPiWebDesktopBridge()` 内部改为：优先读 `window.piWebDesktop`（向后兼容旧壳）→ 否则检测 `window.__TAURI__` 并合成同形状的桥（`pickDirectory` 经全局 `invoke('pick_directory')`）→ 否则返回「无」
  - **公开接口 `PiWebDesktopBridge` 形状不变**，唯一消费方 `components/chat-app.tsx` 与 `components/agent-source-picker.tsx` 零改动
  - **不得 import 任何 `@tauri-apps/*` npm 包**——远端回环页面无法加载随包模块，只能用 `withGlobalTauri` 暴露的全局
  - `pickDirectory` 的 rejection 必须被吞掉并 resolve 为「无结果」，对齐「不 reject」语义
  - 观察完成：`vitest` 覆盖四例——无注入 → 无；`window.piWebDesktop` 存在 → 透传；仅 `window.__TAURI__` 存在 → 合成桥且 `pickDirectory` 可调；`invoke` reject → resolve 为「无结果」。浏览器态下「浏览文件夹」按钮不渲染
  - _Requirements: 6.1, 6.7_
  - _Boundary: lib/app/desktop-bridge.ts, test/desktop-bridge.test.ts_

## 6. 铺开其余平台

> 前置闸门：任务 4 全部跑绿。

- [ ] 6.1 搭建 Linux WebView e2e 并复验严格 CSP 下的 IPC
  - 在 Linux 上以 `tauri-driver` + WebKitWebDriver + xvfb 驱动真实 WebView
  - 断言页面内 `window.__TAURI__` 存在 → 经合成桥调用目录选择 → 在 stub env 下返回该路径
  - 本项覆盖 macOS 因缺少 WebView 驱动而测不到的「渲染层经桥拿到路径」这条路径，同时是 **Windows/Linux 的 WebView 在严格 CSP 下 IPC 是否仍可用的唯一自动化证据**（macOS 的 WKWebView 走 messageHandlers 不受 `connect-src` 约束，其余平台机制不同）
  - 若 IPC 被页面 CSP 拦截，兜底为在桌面态放行 `ipc:` 到 pi-web server 的 `connect-src`（仅桌面壳加载时生效，不影响浏览器部署）
  - 观察完成：Linux 环境下 WebDriver 套件跑绿，日志中可见目录选择返回 stub 路径
  - ⚠ **状态：脚本已实现，但未在 Linux 上运行验证**（本次实现环境为 macOS，`tauri-driver` 不支持 macOS）。在 macOS 上执行该脚本会以退出码 2 明确拒绝，不会假装通过。须在 Linux CI 上跑通后方可视为达标
  - _Requirements: 10.1, 10.4_
  - _Boundary: e2e/desktop/webdriver/wdio.conf.mjs, e2e/desktop/webdriver/bridge.e2e.mjs_
  - _Depends: 5.1, 5.2_

- [ ] 6.2 验证 Windows 与 Linux 打包目标
  - 前置：各平台先 `pnpm build:dist`，再 `pnpm desktop:sidecar --target <该平台 triple>` 取 sidecar
  - 为 `x86_64-unknown-linux-gnu` 与 `x86_64-pc-windows-msvc` 各跑 `tauri build`，产出 AppImage 与 nsis 安装包
  - Linux 需先装构建依赖：`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - 断言 Linux 可执行文件名为 `pi-web`（不含会被 AppImage 拒绝的字符）
  - 观察完成：两平台各产出一个安装包文件；在对应平台上启动安装后的应用能完成一次真实会话
  - ⚠ **状态：未完成**。本次实现环境为 macOS，无法产出或运行 Windows/Linux 安装包。
    已验证的是 CI 矩阵的**核心机制**：`node scripts/fetch-node-sidecar.mjs --target x86_64-apple-darwin`
    正确取到 x64 sidecar（并因异架构而跳过执行自检），且 `cargo build --target x86_64-apple-darwin --release`
    交叉编译成功 —— 证明「按 target triple 取匹配 sidecar + 交叉编译」这条路成立。
    Windows/Linux 的实际打包与运行须由任务 7.1 的 CI 矩阵真实跑通后方可视为达标
  - _Requirements: 9.1, 9.9_
  - _Depends: 4.7_

## 7. 发布流水线改造

- [ ] 7.1 改造 GitHub 发布工作流为按目标架构的矩阵
  - 保留「构建/打包分离」：`dist/` 与平台无关，仍在 Ubuntu 上构建一次并作为 artifact 分发给各矩阵分支
  - 矩阵**按 target triple 展开**（而非仅按 OS）：`macos-latest`×`aarch64-apple-darwin`、`macos-latest`×`x86_64-apple-darwin`、`ubuntu-22.04`×`x86_64-unknown-linux-gnu`、`windows-latest`×`x86_64-pc-windows-msvc`
  - 每分支：**`rustup target add <triple>`**（CI runner 是干净的；`macos-latest` 是 arm64，构建 `x86_64-apple-darwin` 必须先补该 target，`tauri-action` 不代办）→ 取 `dist` artifact → 为该 triple 取 sidecar（校验和失败即构建失败）→ `tauri-action` 传 `args: --target <triple>`
  - `fail-fast: false`，使单平台失败不阻断其余平台
  - 拆为三个 job：`package`（产出 artifact，**不**上传 Release）→ `smoke`（macOS 上对已打包产物跑真实会话冒烟）→ `release`（仅 tag 触发时下载 artifact 并附加到对应 Release）。`workflow_dispatch` 触发时只产出工作流产物、不附加 Release
  - Linux 分支安装构建依赖：`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - 观察完成：`workflow_dispatch` 手动触发一次，四个矩阵分支全绿、产出四个安装包工作流产物、且未创建或修改任何 GitHub Release
  - ⚠ **状态：工作流已改造并通过 YAML 结构校验（四 target triple 矩阵 / fail-fast:false / package→smoke→release 三段分离 / sidecar 校验前置于 tauri build），但未在真实 GitHub Actions 上运行**。须实际触发一次 `workflow_dispatch` 跑通后方可视为达标
  - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.7, 9.8_
  - _Boundary: .github/workflows/desktop-release.yml_
  - _Depends: 4.7, 6.2_

## 8. 迁移动机的实测验收

- [x] 8.1 实现内存、冷启动与包体的实测脚本
  - **空闲常驻内存**：启动 → 会话就绪 → 空闲 30 秒 → 汇总**应用进程树全部进程**的 RSS（Electron 是多进程，只测主进程会系统性低估它，构成不公平对比）
  - **冷启动**：从进程 spawn 到 server 首次收到 `GET /`（由 server 侧打点）。该口径两侧完全一致且不依赖 WebDriver
  - **包体**：四个安装包各自的字节数，并单列随包 node 的贡献值
  - 三项测量均需一个可启动的打包产物，故依赖 macOS 打包链已跑通
  - 观察完成：`node scripts/measure-desktop-baseline.mjs` 对当前分支产出三组数值并写入 JSON
  - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - _Boundary: scripts/measure-desktop-baseline.mjs_
  - _Depends: 4.7_

- [ ] 8.2 产出迁移前后对比并按阈值裁定
  - 在 Electron 壳（`main` 分支）与 Tauri 壳（本分支）各跑一次实测脚本，同口径对比
  - 写入 `.kiro/specs/electron-to-tauri/evidence/baseline-comparison.md`，包体对比中显式计入随包 node 的贡献（实测：单个二进制 strip 前 107MB / strip 后 86MB / 压缩态约 35MB）
  - **裁定**：以 macOS arm64 安装包为基准，若 Tauri 安装包体积 > Electron 安装包体积 × 0.75，判定「净收益不显著」→ **停止并交回决策者**，不得默认继续
  - 报告中不得以「新方案理论上更轻」一类论证替代任何一项实测数值
  - 观察完成：对比文档存在，含 RSS / 冷启动 / 四平台包体的前后数值与裁定结论
  - ⚠ **状态：macOS arm64 部分已完成并达标（0.35 ≤ 0.75 阈值），但 Req 11.3 要求的三平台数值未满足** —— Windows/Linux 的包体、内存、冷启动均未实测（依赖任务 6.2 与 7.1）。故本任务整体未完成
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - _Depends: 8.1, 7.1_

## 9. 清理 Electron 残留

- [x] 9.1 删除 Electron 实现与其专属测试
  - 删除 `desktop/src/*.ts`（8 文件）、`desktop/build.mjs`、`desktop/electron-builder.yml`、`desktop/tsconfig.json`、`desktop/static/`
  - 删除 `test/desktop/*.test.ts`（7 文件，其行为契约已逐条迁入 Rust 单测）与 `e2e/desktop/desktop-directory-picker.mjs`（其覆盖已迁入任务 6.1 的 WebDriver e2e）
  - 更新根 `package.json` 的 `e2e:desktop:*` 脚本指向改造后的黑盒脚本，新增 `e2e:desktop:webdriver`、`desktop:sidecar`、`desktop:baseline`
  - 观察完成：仓库内 `grep -ri electron` 在 `desktop/`、`test/`、`e2e/` 下无生产代码命中；`pnpm -r typecheck` 与全量单测跑绿；三条黑盒 e2e 仍全绿
  - _Requirements: 10.1_
  - _Depends: 8.2_
