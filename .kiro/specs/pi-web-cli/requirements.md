# Requirements Document

## Introduction

本特性把 pi-web（现为只能在 monorepo 开发树内 `next dev` / `next start` 运行的 Next.js 应用）交付为一个**可全局安装、可用命令行参数启动的 CLI 程序 `pi-web`**。用户在任意目录执行 `pi-web [source] [options]` 即可拉起一个本地 Web 服务器并在浏览器中使用聊天界面；其中 agent source 由位置参数指定，省略时默认取当前工作目录。

CLI 的定位是**薄启动器**：它把命令行参数翻译为应用已识别的运行时配置（`loadConfig()` 已读取的 env），再拉起一份**自包含、可脱离开发树运行**的构建产物，不改动任何业务逻辑。本期范围为「本地可跑 + 参数」：构建后在本机以 `node <bin>` 或本地链接的 `pi-web` 命令即可运行，并通过 e2e 验证启动链路；不含真正的 npm publish 与 workspace 依赖内联发布。

## Boundary Context

- **In scope**：
  - 一个名为 `pi-web` 的可执行 CLI 入口，可被 `npm link` / `npm install -g`（本地 tarball）注册到 PATH。
  - 位置参数 `[source]`（agent source）与选项 `--port/-p`、`--host`、`--cwd`、`--agent-dir`、`--open`、`--stub`、`--watch`、`--help/-h`、`--version/-v`。
  - `--watch`：监视本地 agent source 目录，文件变化时重载活跃会话（复用既有 runner 热重载机制）。
  - 把上述参数映射为应用运行时配置，并启动内嵌 Web 服务器至「可接受请求」状态。
  - 一份脱离 monorepo 源码树即可运行的自包含构建产物（含应用运行时所依赖的、被外置的 agent SDK 与子进程入口）。
  - e2e 验证：CLI 启动 → 浏览器加载页面 → 选定/默认 agent source 激活会话 → 发送消息 → 收到流式回包（优先以确定性 stub agent 冒烟，再验真实子进程会话）。
- **Out of scope**：
  - 真正发布到公共 npm registry、workspace 依赖内联打包、版本号治理与 CI 发布流水线。
  - 容器镜像 / 系统服务 / 反向代理部署形态。
  - 对业务逻辑（会话引擎、协议、UI）的功能改动。
- **Adjacent expectations**：
  - 依赖应用既有的 `loadConfig()` 配置契约（`PI_WEB_DEFAULT_SOURCE`/`PI_WEB_DEFAULT_CWD`/`PI_WEB_AGENT_DIR`/`PI_WEB_STUB_AGENT` 等）。CLI 只填充这些配置入口，不新增业务配置语义。
  - 依赖既有 runner 热重载机制（监视源码 → 防抖 → 活跃会话 runner 空闲时重启 → 从持久化对话续上）。CLI 仅注入「启用开关 + 监视路径」，不重写重载逻辑；该机制当前以 dev 门控，`--watch` 需为其提供一个不依赖 `NODE_ENV` 的显式启用信号。
  - 依赖运行环境已安装 Node `>=22.19.0`；真实（非 stub）会话依赖本机 `~/.pi/agent` 凭据与可被解析的 agent source。
  - 有状态长连接（SSE + 子进程）特性不变，运行形态仍为单机长驻进程。

## Requirements

### Requirement 1: 全局 CLI 入口与 agent source 选择
**Objective:** 作为一名 pi-web 用户，我想在任意目录用一条 `pi-web` 命令启动应用并指定要运行的 agent，以便无需进入 monorepo 开发树即可使用。

#### Acceptance Criteria
1. The pi-web CLI shall 暴露一个可被加入系统 PATH 的可执行入口，使 `pi-web` 命令在任意工作目录下可被调用。
2. When 用户以位置参数提供 agent source（如 `pi-web ./my-agent` 或一个 git 来源），the pi-web CLI shall 以该来源作为会话默认 agent source。
3. When 用户未提供位置参数，the pi-web CLI shall 以当前工作目录作为默认 agent source。
4. When CLI 启动完成，the pi-web CLI shall 向用户输出实际监听的访问地址（含 host 与 port）。

### Requirement 2: 命令行选项映射为运行时配置
**Objective:** 作为一名 pi-web 用户，我想用命令行选项控制监听地址、工作目录与配置目录，以便适配不同运行场景。

#### Acceptance Criteria
1. When 用户提供 `--port`（或 `-p`），the pi-web CLI shall 使内嵌 Web 服务器监听该端口。
2. When 用户未提供 `--port`，the pi-web CLI shall 监听默认端口 3000。
3. When 用户提供 `--host`，the pi-web CLI shall 使服务器绑定该主机地址；未提供时默认绑定 `127.0.0.1`。
4. When 用户提供 `--cwd`，the pi-web CLI shall 以该目录作为会话工作目录。
5. When 用户提供 `--agent-dir`，the pi-web CLI shall 以该目录作为 pi 配置目录（供子进程读取凭据与设置）。
6. Where 用户提供 `--stub` 选项，the pi-web CLI shall 使会话运行于确定性 stub agent 模式（用于离线冒烟）。
7. The pi-web CLI shall 不在任何输出（含日志与错误信息）中回显 provider 凭据等敏感值。
8. When 指定或默认端口已被占用，the pi-web CLI shall 自动从该端口起递增选取首个空闲端口并使用，同时告知用户实际使用的端口。

### Requirement 3: 内嵌 Web 服务器启动与就绪
**Objective:** 作为一名 pi-web 用户，我想 CLI 启动后服务立即可用，以便打开浏览器即可开始会话。

#### Acceptance Criteria
1. When CLI 进程启动，the pi-web CLI shall 启动内嵌 Web 服务器并使其进入可接受 HTTP 请求的就绪状态。
2. While 服务器处于就绪状态，the pi-web CLI shall 正常处理会话相关请求（页面加载、会话创建、流式响应），其行为与开发树内运行时一致。
3. When 用户在终端发送中断信号（如 Ctrl+C），the pi-web CLI shall 停止 Web 服务器并退出进程。
4. If 从指定/默认端口起的一段连续端口范围均被占用（无可用端口），then the pi-web CLI shall 输出可读的错误信息并以非零状态码退出。

### Requirement 4: 自包含、可脱离开发树运行的构建产物
**Objective:** 作为一名运维/分发者，我想 CLI 运行所需的全部产物自包含，以便它脱离 monorepo 源码树后仍能完整运行会话。

#### Acceptance Criteria
1. The pi-web CLI shall 依赖一份自包含构建产物，使其在不存在 monorepo 源码树与开发依赖的环境中仍能启动并提供页面。
2. While 处理真实（非 stub）会话，the pi-web CLI shall 能成功拉起 agent 子进程运行时（含被应用运行时外置的 agent SDK 及其传递依赖、以及运行用户 agent 入口所需的载入器）。
3. The pi-web CLI shall 随产物提供页面所需的静态资源与公共资源，使页面样式与脚本正确加载。
4. If 构建产物缺失（用户尚未执行构建），then the pi-web CLI shall 输出可读的提示，告知需先执行构建命令，并以非零状态码退出。

### Requirement 5: 帮助、版本与参数错误处理
**Objective:** 作为一名首次使用者，我想通过 `--help` 了解用法、通过 `--version` 查看版本，并在参数错误时得到清晰反馈，以便快速正确使用。

#### Acceptance Criteria
1. When 用户提供 `--help`（或 `-h`），the pi-web CLI shall 输出包含用法、位置参数与全部选项说明的帮助文本，并以零状态码退出。
2. When 用户提供 `--version`（或 `-v`），the pi-web CLI shall 输出 CLI 版本号并以零状态码退出。
3. If 用户提供未知选项或非法选项取值，then the pi-web CLI shall 输出可读的错误信息（指明出错选项）并以非零状态码退出，且不启动服务器。

### Requirement 6: 浏览器自动打开（可选特性）
**Objective:** 作为一名用户，我想加 `--open` 让 CLI 启动后自动打开浏览器，以便省去手动复制地址的步骤。

#### Acceptance Criteria
1. Where 用户提供 `--open` 选项，when 服务器进入就绪状态，the pi-web CLI shall 用系统默认浏览器打开实际访问地址。
2. While 未提供 `--open`，the pi-web CLI shall 仅输出访问地址而不打开浏览器。
3. If 自动打开浏览器失败，then the pi-web CLI shall 继续保持服务器运行并提示用户手动访问地址，而不因此终止进程。

### Requirement 7: 非侵入与 e2e 可验证
**Objective:** 作为一名维护者，我想 CLI 能力以非侵入方式叠加，并有 e2e 证据证明启动链路可用，以便不破坏既有功能且可回归。

#### Acceptance Criteria
1. The pi-web CLI shall 不改变应用既有的 `next dev` / `next start` 开发与运行行为。
2. When 通过 CLI 以 stub 模式启动并完成一次「打开页面 → 激活默认 agent source → 发送消息 → 接收流式回包」流程，the pi-web CLI shall 使该流程成功完成，作为可重复的 e2e 冒烟证据。
3. While 以非 stub 模式运行且本机凭据与 agent source 可用，the pi-web CLI shall 支持「选定 agent source → 发送 prompt → 接收真实子进程流式回复」的闭环。

### Requirement 8: Watch 模式 — agent source 变化时重载会话
**Objective:** 作为开发 agent 的用户，我想用 `--watch` 让 CLI 在 agent source 文件变化时自动重载会话，以便改完 agent 代码即时生效，无需重启进程或新建会话。

#### Acceptance Criteria
1. Where 用户提供 `--watch` 选项，the pi-web CLI shall 监视所选 agent source 目录下的源码文件变化。
2. When 被监视的 agent source 源码文件发生变化，the pi-web CLI shall 触发活跃会话的 agent 运行时在空闲时重载，并保留当前会话的对话上下文。
3. While 未提供 `--watch`，the pi-web CLI shall 不监视文件变化（默认行为与既有 dev 门控不变）。
4. If 所选 agent source 为 git 来源而非本地目录，then the pi-web CLI shall 跳过文件监视并提示 watch 仅适用于本地目录。

### Requirement 9: CLI 确定 source 时直接进会话
**Objective:** 作为用 CLI 启动的用户，我想 CLI 既然已确定 agent source 就直接进入会话界面，而非再显示选源页让我点一次，以便少一步直接开始。

#### Acceptance Criteria
1. When 经 CLI 启动（agent source 已确定），the pi-web 应用 shall 在首次加载时直接用该 source 创建会话并进入会话界面，不显示选源页。
2. While 未经 CLI 启动（未设自动进会话信号），the pi-web 应用 shall 仍显示选源页（默认行为不变）。
3. Where 已进入自动创建的会话，the pi-web 应用 shall 仍允许用户经「切换源」返回选源页。
