# Requirements Document

## Introduction

本特性在 pi-web 聊天界面引入交互式 Bang(`!`)Shell 命令:用户在输入框输入以 `!` 开头的文本时,系统不把它发给 LLM,而是作为 bash 命令在当前会话 agent 的工作目录执行,并将执行结果以一条专用「bash 卡片」消息呈现在聊天流中。`!!` 前缀表示执行但输出不进入 LLM 上下文。

该能力对应 pi 交互式 CLI(TUI)中已有的 bash 模式行为,目的是让 Web 用户无需离开聊天界面即可执行快速 shell 操作并让结果(可选)进入会话上下文。由于其本质是任意 shell 执行,属高危能力,因此**默认关闭**,仅由部署级开关显式启用。

底层 RPC 协议、RPC 通道与 pi agent 的 `bash` 能力均已就绪(见 Project Description 的调研结论),本特性聚焦于把该能力接入 pi-web 的 HTTP 层、前端提交链路、结果渲染与启用门控。

## Boundary Context

- **In scope**:
  - 前端输入框对 `!` / `!!` 前缀的识别与分流(不发给 LLM)。
  - 后端同步执行 bash 命令并返回结构化结果(`output` / `exitCode` / `cancelled` / `truncated` / `fullOutputPath`)。
  - 执行结果作为专用 bash 卡片在「当前会话」聊天流中展示。
  - `!`(进上下文)/ `!!`(不进上下文)的语义差异。
  - 默认关闭的启用开关,后端为权威门控,前端为体验联动。
  - 输入框的 bash 模式视觉提示。
- **Out of scope**(未来扩展,本特性不实现):
  - 刷新/重连后 bash 卡片的历史回放(`!` 的输出仍保留在 LLM 上下文,但卡片不重绘)。
  - bash 命令输出的逐行流式展示(结果一次性返回)。
  - 运行中 bash 命令的中止(abort)UI(后端可预留端点,但不接入界面)。
  - 在 Settings UI 中提供用户可写的启用开关(启用由部署级 env 控制)。
  - 命令白名单/沙箱化等更细粒度的安全策略。
- **Adjacent expectations**:
  - 依赖 pi agent RPC mode 已提供的 `bash` 请求与 `recordBashResult` 上下文写入行为;本特性不重新实现命令执行或上下文管理。
  - 依赖既有协议包中已定义的 `bash` 请求/响应 schema 与 `BashResultSchema`;本特性不修改协议契约。

## Requirements

### Requirement 1: Bang 前缀识别与分流

**Objective:** 作为 pi-web 用户,我希望以 `!` 开头的输入被当作 shell 命令而非聊天消息处理,以便我能直接在聊天框运行快速命令。

#### Acceptance Criteria

1. Where bash 能力在前端启用, when 用户提交以单个 `!` 开头(去除前导空白后)且去前缀后非空的文本, the PiChat 输入处理 shall 将其作为 bash 命令分流执行,且 shall not 通过聊天消息通道发送给 LLM。
2. Where bash 能力在前端启用, when 用户提交以 `!!` 开头的文本, the PiChat 输入处理 shall 将去除 `!!` 前缀后的内容作为 bash 命令执行,并标记该命令输出不进入 LLM 上下文。
3. When 用户提交的文本去除 `!`(或 `!!`)前缀并去除首尾空白后为空, the PiChat 输入处理 shall 不发起任何执行请求,且 shall 不向聊天流写入消息。
4. The PiChat 输入处理 shall 在判断 bash 前缀前对输入执行前导空白裁剪(trimStart),使 ` !cmd` 与 `!cmd` 行为一致。
5. Where bash 能力在前端启用, when 输入以 `!` 开头与以 `/` 开头的分流条件同时可被评估, the PiChat 输入处理 shall 优先按 bash 分支处理 `!` 前缀,使 `!` 与斜杠命令互不干扰。

### Requirement 2: Shell 命令执行与结果返回

**Objective:** 作为 pi-web 用户,我希望我的 bash 命令在当前会话 agent 的工作目录被执行并拿到完整结果,以便我能看到命令的输出与退出状态。

#### Acceptance Criteria

1. When 前端就一个会话提交 bash 命令, the pi-web 服务端 shall 将该命令转发给对应会话的 agent 执行,并以同步 HTTP 响应体返回结构化结果(包含输出文本、退出码、是否取消、是否截断,以及完整输出路径如适用)。
2. The pi-web 服务端 shall 在 agent 的当前会话工作目录上下文中执行该命令(由 agent 的 bash 能力决定工作目录),而不在独立的临时目录中执行。
3. When bash 命令执行成功返回, the PiChat shall 不通过 SSE 流承载该结果,而 shall 依据同步 HTTP 响应体获取结果。
4. If 携带 `excludeFromContext` 标记的命令被提交, the pi-web 服务端 shall 将该标记透传给 agent 的 bash 执行,使其输出不被写入 LLM 上下文。

### Requirement 3: 上下文语义(`!` 与 `!!`)

**Objective:** 作为 pi-web 用户,我希望能选择命令输出是否进入对话上下文,以便我既能让命令结果影响后续 LLM 推理,也能执行不污染上下文的临时命令。

#### Acceptance Criteria

1. When 用户以单个 `!` 前缀执行命令, the pi-web 系统 shall 使该命令的输出进入当前会话的 LLM 上下文(由 agent 的 `recordBashResult` 行为完成)。
2. When 用户以 `!!` 前缀执行命令, the pi-web 系统 shall 使该命令的输出不进入当前会话的 LLM 上下文。
3. The pi-web 系统 shall 不自行重复实现上下文写入逻辑,而 shall 依赖 agent 既有的上下文记录行为来满足上述两条语义。

### Requirement 4: 结果在聊天流中的展示

**Objective:** 作为 pi-web 用户,我希望命令及其输出在聊天流中以可辨识的方式显示,以便我能清楚区分命令、输出与退出状态。

#### Acceptance Criteria

1. When bash 命令返回结果, the PiChat shall 在当前会话聊天流中追加一条表示所执行命令的用户侧消息,以及一条承载执行结果的专用 bash 卡片。
2. The bash 卡片 shall 展示所执行的命令文本与命令输出。
3. If 命令的退出码为非零, the bash 卡片 shall 以可视化方式(如标红)标示该失败状态并展示退出码。
4. If 命令输出被截断, the bash 卡片 shall 显示输出已截断的提示。
5. When 命令以 `!!`(不进上下文)方式执行, the bash 卡片 shall 以可辨识标记表明该输出未进入上下文。
6. The bash 卡片 shall 以同步可读的方式渲染输出文本,使其内容在渲染后即可被读取与断言(不依赖异步语法高亮)。

### Requirement 5: 启用开关与安全门控

**Objective:** 作为 pi-web 的部署/运维者,我希望 bash 能力默认关闭且由我通过部署配置显式开启,以便在不可信或多用户环境中杜绝任意命令执行风险。

#### Acceptance Criteria

1. The pi-web 系统 shall 在未进行任何显式配置时默认禁用 bash 能力(secure by default)。
2. While bash 能力在服务端处于禁用状态, when 收到 bash 执行请求, the pi-web 服务端 shall 拒绝执行并以「资源不存在」(HTTP 404)响应,而不泄露该端点是否存在。
3. Where 部署者通过服务端权威开关启用 bash 能力, the pi-web 服务端 shall 允许执行 bash 请求。
4. The pi-web 系统 shall 以服务端开关为安全权威:即使前端体验开关被开启,只要服务端开关关闭,bash 执行请求 shall 仍被拒绝(404)。
5. While 前端体验开关处于关闭状态, when 用户提交以 `!` 开头的文本, the PiChat shall 将其作为普通聊天消息发送给 LLM,而不作为 bash 命令处理。
6. The 服务端权威开关 shall 仅在服务端读取,且 shall 不依赖可由浏览器整体读取的运行时环境变量;前端体验开关 shall 通过构建期内联的方式提供给前端。
7. The pi-web 系统 shall 不在用户可写的 Settings 界面中提供该启用开关;若需在界面呈现启用状态,则 shall 以只读方式展示。

### Requirement 6: 输入框 bash 模式视觉提示

**Objective:** 作为 pi-web 用户,我希望在输入 `!` 前缀时输入框给出明显提示,以便我在按下回车前就知道这条输入会被当作 shell 命令执行。

#### Acceptance Criteria

1. While bash 能力在前端启用, when 输入框当前文本去除前导空白后以单个 `!` 开头, the 输入框 shall 进入可视化的 bash 模式(如改变边框/强调色并显示「BASH」标识)。
2. While bash 能力在前端启用, when 输入框当前文本以 `!!` 开头, the 输入框 shall 以可辨识标识表明当前为「不进上下文」的 bash 模式。
3. When 输入框文本不再以 `!` 开头, the 输入框 shall 退出 bash 模式视觉提示并恢复常规外观。
4. While 前端体验开关处于关闭状态, the 输入框 shall 不因 `!` 前缀而进入 bash 模式视觉提示。

### Requirement 7: 错误处理与边界条件

**Objective:** 作为 pi-web 用户,我希望在命令失败、被拒绝或异常时得到清晰反馈,以便我能理解发生了什么而不至于困惑。

#### Acceptance Criteria

1. If 前端体验开关开启但服务端权威开关关闭,导致 bash 请求被拒绝(404), the PiChat shall 向用户给出可见的错误反馈,而不静默丢弃。
2. If bash 执行请求因网络或服务端错误失败, the PiChat shall 向用户给出可见的错误反馈。
3. When 命令被报告为已取消(cancelled), the bash 卡片 shall 以可辨识方式表明该命令未正常完成。
4. The PiChat shall 在发起 bash 执行后清空输入框,使用户可继续输入下一条内容。

## Non-Functional / Operational Notes

- **安全**:启用 bash 即开放任意命令执行;该风险须在部署文档(硬化清单)中明确告知,并强调默认关闭语义。
- **可发现性**:两个启用相关的环境变量须在配置文档中登记,说明各自作用域(服务端权威 / 前端体验)与默认值(关闭)。
- **测试性**:所有用户可见行为须可通过单元测试、后端集成测试与浏览器 e2e(开/关两档)验证。
