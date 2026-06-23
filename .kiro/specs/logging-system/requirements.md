# Requirements Document

## Introduction

日志系统(logging-system)为 pi-web 提供一套**统一的、跨运行环境的日志能力**：让 agent source、pi extension、webext 三类组件通过同一个日志库输出结构化日志；让用户在 settings UI 中配置日志行为（开关、级别、按组件过滤、输出目标）；并在会话界面提供一个独立的日志面板（logs slot），实时查看与检索日志。

系统覆盖两个运行环境：agent source 与 pi extension 运行在 Node.js 子进程，webext 运行在浏览器 React。日志需从子进程汇聚到主进程、再经会话流推送到浏览器面板，同时支持按需拉取历史日志。

> 术语：`namespace`（命名空间）是每条日志的来源标识（如 `agent:hello`、`ext:pi-probe`、`webext:demo`、`core:sse`），用作面板过滤与按组件开关的 key。`级别` 取值 `debug` / `info` / `warn` / `error`，严重度递增。

## Boundary Context

- **In scope（本特性负责）**：
  - 一个可被三类组件引用的统一日志库（同构 API）。
  - agent source / pi extension（Node 子进程）与 webext（浏览器）的日志产出接缝。
  - 日志从子进程到浏览器面板的实时传输，以及历史日志的按需拉取。
  - 会话界面中的独立日志面板（查看 / 按级别过滤 / 按命名空间过滤 / 文本搜索 / 自动滚动）。
  - settings UI 中的日志配置域（启用、级别、按命名空间开关、输出目标、面板默认级别），并持久化。
  - 收编内核现有零散的告警/错误输出钩子，统一经日志库产出。
- **Out of scope（本特性不负责）**：
  - 修改上游 `@earendil-works/pi-coding-agent`（pi SDK）。pi extension 不依赖 pi SDK 新增 API，改为直接引用本项目日志库。
  - 跨会话的日志聚合分析、远程日志上报、第三方日志后端（如 ELK）集成。
  - agent 业务消息流（message_update 等）本身的改动；日志通道与业务消息流相互独立。
- **Adjacent expectations（对相邻系统的预期）**：
  - 复用既有会话流（实时控制帧）与既有配置 UI 框架（静态 schema + 自定义控件）作为承载，不为日志另起一套传输或配置框架。
  - 日志传输不得破坏既有业务消息流与既有控制帧（如 ui-rpc、stats、notifications）的回归行为。

## Requirements

### Requirement 1: 统一日志库（同构）
**Objective:** 作为 pi-web 各组件的开发者，我想要一个可在 Node 与浏览器两种环境下引用的统一日志库，以便用一致的 API 输出日志而无需关心运行环境差异。

#### Acceptance Criteria
1. The 日志库 shall 导出 `createLogger({ namespace, level })`，返回提供 `debug` / `info` / `warn` / `error` 四个方法及 `child(namespace)` 派生方法的 Logger 实例。
2. When 调用任一日志方法, the 日志库 shall 产出一条包含级别、命名空间、消息、可选结构化数据与时间戳的结构化日志条目。
3. When 调用 `child(subNamespace)`, the 日志库 shall 返回一个命名空间为父子拼接（如 `agent:hello:tool`）的新 Logger，且继承父级配置。
4. While 运行在 Node 子进程环境, the 日志库 shall 将日志条目序列化为单行 JSON 并写入子进程标准输出，作为与主进程约定的日志通道。
5. While 运行在浏览器环境, the 日志库 shall 将日志条目写入浏览器侧的内存环形缓冲并派发给订阅方，而不写入标准输出。
6. The 日志库 shall 保证浏览器构建产物中不包含任何仅限 Node 的模块引用（如文件系统模块），以免污染浏览器打包。
7. If 当前级别配置高于某条日志的级别, the 日志库 shall 丢弃该条日志且不产出任何条目。

### Requirement 2: agent source 与 pi extension 日志接入
**Objective:** 作为 agent 作者或扩展作者，我想要在我的代码中直接打日志，以便排查 agent 与扩展的运行问题。

#### Acceptance Criteria
1. The agent 运行时 shall 通过 agent 上下文向 agent source 暴露一个 Logger 实例，其命名空间标识当前 agent。
2. When agent source 调用其上下文上的 Logger 方法, the 日志系统 shall 将该日志经子进程日志通道汇聚到主进程。
3. The pi extension shall 能够直接引用本项目日志库创建 Logger，而不依赖 pi SDK 暴露日志 API。
4. When pi extension 调用其 Logger 方法, the 日志系统 shall 将该日志与 agent source 日志走相同的子进程日志通道汇聚。
5. If 子进程同时输出日志通道数据与既有 RPC 协议消息, the 主进程 shall 正确区分二者，仅将日志条目路由到日志处理，且不破坏既有 RPC 消息分流。

### Requirement 3: 日志实时传输到浏览器
**Objective:** 作为查看会话的用户，我想要在 agent / 扩展产生日志时近实时地看到它们，以便实时跟踪运行情况。

#### Acceptance Criteria
1. When 主进程从子进程日志通道收到一条日志条目, the 会话服务 shall 通过既有会话流向浏览器推送一条日志控制帧。
2. When 浏览器会话连接收到日志控制帧, the 浏览器客户端 shall 将其中的日志条目追加到客户端日志存储。
3. The 日志控制帧 shall 与既有业务消息流及其他控制帧（如 ui-rpc、stats、notifications）相互独立，且不改变它们的行为。
4. While 浏览器日志存储已达到容量上限, the 浏览器客户端 shall 以环形缓冲方式淘汰最旧条目，保留最新条目且不无限增长内存。

### Requirement 4: 日志历史拉取
**Objective:** 作为用户，我想要在重连或日志量较大时仍能获取近期历史日志，以便不因实时推送丢帧而漏看日志。

#### Acceptance Criteria
1. The 会话服务 shall 在主进程侧以环形缓冲保留每个会话近期的日志条目。
2. When 浏览器客户端请求某会话的历史日志, the 会话服务 shall 返回该会话当前保留的日志条目集合。
3. Where 提供了级别或数量等过滤参数, the 会话服务 shall 仅返回满足过滤条件的日志条目。
4. While 单个会话的日志数量超过主进程保留上限, the 会话服务 shall 以环形缓冲淘汰最旧条目，保留最新条目。
5. When 浏览器客户端在连接建立或重连后加载历史日志, the 浏览器客户端 shall 将历史日志与实时推送日志合并展示且不产生重复条目。

### Requirement 5: 日志面板（logs slot）
**Objective:** 作为用户，我想要在会话界面有一个独立的日志面板，以便集中查看、过滤和搜索日志。

#### Acceptance Criteria
1. The 会话界面 shall 提供一个独立于业务消息区与既有面板的日志面板区域，可被定位与断言（带稳定的可识别标记）。
2. When 客户端日志存储新增日志条目, the 日志面板 shall 展示新增条目，按时间顺序排列并标明级别与命名空间。
3. Where 用户选择了某个级别过滤, the 日志面板 shall 仅显示级别不低于所选级别的日志条目。
4. Where 用户选择了某个命名空间过滤, the 日志面板 shall 仅显示该命名空间（含其子命名空间）的日志条目。
5. Where 用户输入了搜索文本, the 日志面板 shall 仅显示消息文本匹配该搜索文本的日志条目。
6. While 日志面板处于自动滚动状态且有新日志到达, the 日志面板 shall 自动滚动到最新条目；While 用户已向上滚动浏览历史, the 日志面板 shall 暂停自动滚动以免打断阅读。

### Requirement 6: 日志配置（settings UI）
**Objective:** 作为用户，我想要在 settings 中配置日志行为，以便控制日志的开关、详尽程度、来源与输出方式。

#### Acceptance Criteria
1. The settings UI shall 提供一个独立的"日志"配置分组，可在设置页中打开并保存。
2. The 日志配置 shall 包含：全局启用开关、全局级别、按命名空间的启用开关、输出目标（控制台 / 文件 / 面板可见性）、面板默认级别。
3. When 用户保存日志配置, the 配置服务 shall 将配置持久化到约定的配置文件，并对未知字段保持保留（不丢失既有数据）。
4. While 全局启用开关为关闭, the 日志系统 shall 不产出任何日志条目。
5. While 某命名空间的开关为关闭, the 日志系统 shall 丢弃该命名空间产生的日志条目。
6. When 日志配置中的级别被调整并保存, the 日志系统 shall 按新级别过滤后续日志（高于新级别的日志被丢弃）。
7. The 日志配置表单 shall 使用前端静态 schema 渲染，按命名空间的开关使用自定义控件呈现，且不依赖后端注入的动态表单 schema。

### Requirement 7: 文件输出与轮转
**Objective:** 作为用户，我想要把日志写入文件，以便在界面之外留存与排查。

#### Acceptance Criteria
1. Where 文件输出被启用, the 日志系统 shall 将 Node 端日志按配置的路径追加写入日志文件。
2. Where 文件输出被启用且配置了文件大小或数量上限, the 日志系统 shall 在达到上限时进行轮转，保留最近的文件且不无限增长磁盘占用。
3. While 文件输出被禁用, the 日志系统 shall 不创建或写入任何日志文件。
4. If 日志文件写入失败, the 日志系统 shall 不影响 agent 会话的正常运行，并以非致命方式处理该错误。

### Requirement 8: 收编内核现有日志钩子
**Objective:** 作为维护者，我想要把内核中零散的告警/错误输出统一到日志库，以便所有日志走同一套配置、面板与传输。

#### Acceptance Criteria
1. The 日志系统 shall 将内核现有的告警/错误回调（如补全注册表、附件桥、会话流错误处理）改为经日志库产出，使用各自的命名空间。
2. When 内核内部产生告警或错误, the 日志系统 shall 使其遵循统一的日志配置（启用、级别、命名空间开关）。
3. The 收编改造 shall 不改变内核既有功能的对外可观察行为，仅改变其日志的产出路径。

### Requirement 9: 非功能与边界约束
**Objective:** 作为维护者，我想要日志系统在引入新能力的同时不破坏既有行为，以便安全合入。

#### Acceptance Criteria
1. The 日志系统 shall 不改变既有业务消息流、ui-rpc、stats、notifications 等既有控制帧的对外可观察行为。
2. While 日志量较大, the 日志系统 shall 通过环形缓冲与级别过滤限制内存与传输开销，且不使会话界面无响应。
3. The 日志系统 shall 提供端到端可验证路径：agent 产生日志 → 日志面板显示 → 在 settings 调整级别/开关后产出相应变化。
4. The 日志系统 shall 通过隔离构建运行其端到端测试，且不污染开发服务器的共享构建产物。

## Priority（实现分期，用于 tasks 排序，不改变需求范围）

- **P0 核心闭环**：Requirement 1、2、3、5、6（基础字段：启用 / 级别 / 命名空间开关 / 面板可见性）。端到端跑通"打日志 → 面板看到 → 配置调级别/开关生效"。
- **P1 增强收编**：Requirement 4（REST 历史拉取 + 主进程环形缓冲）、Requirement 7（文件输出与轮转）、Requirement 8（收编内核钩子）。
