# Requirements Document

## Introduction

本特性交付 pi-web 后端的 **传输无关 RPC 通道**:一个 `PiRpcChannel` 接口(`send` / `onLine` / `close` / `health`)与其本地实现 `PiRpcProcess`(基于 `child_process.spawn`)。它是后端会话引擎与 agent 子进程之间唯一的双向通信枢纽,负责严格的 JSONL 成帧、stdout 三类消息(`response` / `event` / `extension_ui_request`)的分发、与包 `RpcClient` 对齐的命令方法封装,以及子进程生命周期(stderr 收集、exit 监听、错误传播、干净退出)管理。

通道对外是同一套 RPC JSONL 协议,因此无论上游给出的 spawnSpec 指向 bootstrap runner(`runRpcMode`)还是 `pi --mode rpc`(`node <pkg>/dist/cli.js --mode rpc`),通道实现完全复用。所有跨层协议类型(`RpcCommand` / `RpcResponse` / `AgentEvent` / `RpcExtensionUIRequest` / `RpcExtensionUIResponse` 等)以及 `SpawnSpec`(`{ cmd, args, cwd, env }`)由上游 `protocol-contract`(`@blksails/pi-web-protocol`)拥有并导出,本特性只经 `import type … from "@blksails/pi-web-protocol"` 消费,不重定义(单一事实来源)。

`PiRpcChannel` 接口是 §14.1① 明确要求"现在就预留"的接缝:`PiRpcProcess` 只是 `local` 实现,未来 e2b / ssh / device / websocket 都是同接口的另一实现。

## Boundary Context

- **In scope**:
  - `PiRpcChannel` 传输无关接口(`send(line)` / `onLine(cb)` / `close()` / `health()`)的定义。
  - `PiRpcProcess` 本地实现:按给定 spawnSpec(`{ cmd, args, cwd, env }`)spawn 子进程,`detached: false`。
  - 协议正确的 JSONL reader:只按 `\n` 切分、剥离尾随 `\r`、禁用 Node `readline`、缓冲跨 chunk 的不完整行、容忍空行、不在 JSON 字符串内含 `U+2028`/`U+2029` 时误切。
  - stdout 三类消息分发:`response`(按 `id` 关联待决 Promise)、`event`(广播给 listener)、`extension_ui_request`(挂起 + `respondExtensionUI(id, …)` 回复)。
  - 与包 `RpcClient` 对齐的命令方法封装(基于 `send` + 等待对应 `response`):`prompt`/`steer`/`followUp`/`abort`、`setModel`/`cycleModel`/`getAvailableModels`、`setThinkingLevel`、`getState`/`getMessages`/`getSessionStats`/`getCommands`、`compact`/`fork`/`clone`/`newSession`、`bash`/`abortBash`,加 `onEvent()` 与 `respondExtensionUI(id, …)`。
  - 子进程 stderr 收集、exit/错误监听与传播、关闭时的干净退出与待决请求拒绝。

- **Out of scope**:
  - 决定 spawn 什么(spawnSpec 的生成:源解析、入口探测、双模式判定、`cliPath` 定位)——归 `agent-source-resolver`。
  - 事件 → AI SDK UIMessage 流的翻译——归 `session-engine`。
  - 协议类型/schema 的定义与 zod 校验——归 `protocol-contract`(本特性消费其导出类型)。
  - 会话注册、生命周期计时、SSE 广播编排——归 `session-engine`。
  - 远程传输实现(e2b/ssh/device/websocket)——未来特性,仅由本接口预留接缝。

- **Adjacent expectations**:
  - 上游 `protocol-contract` 必须导出本特性消费的命令/响应/事件/扩展 UI 类型以及 `SpawnSpec` 类型(其拥有并导出);其形状变更会触发本特性重校验。
  - 上游 `agent-source-resolver` 必须按 `protocol-contract` 导出的 `SpawnSpec` 形状(`{ cmd, args, cwd, env }`)提供 spawnSpec 的值(resolver 产出值,protocol 拥有类型)。
  - 下游 `session-engine` 经 `onEvent()` 订阅事件、经命令方法发起命令、经 `respondExtensionUI` 回复扩展 UI 请求。

## Requirements

### Requirement 1: 传输无关 RPC 通道接口

**Objective:** 作为后端会话引擎,我想要一个传输无关的 `PiRpcChannel` 接口,以便本地子进程与未来 e2b/ssh/device/websocket 传输都遵循同一契约、上层无需改动。

#### Acceptance Criteria

1. The `PiRpcChannel` 接口 shall 暴露发送一行原始 JSONL 文本的能力、注册按行接收回调的能力、关闭通道的能力,以及查询通道健康状态的能力。
2. When 上层注册一个按行接收回调, the `PiRpcChannel` 接口 shall 在每收到一条完整的 stdout 行时以该行文本调用回调。
3. The `PiRpcChannel` 接口 shall 不在其类型签名中暴露任何本地进程、管道或 `child_process` 专有概念。
4. Where 本地传输被选用, the `PiRpcProcess` 实现 shall 实现 `PiRpcChannel` 接口的全部成员且行为与契约一致。
5. The `PiRpcChannel` 接口 shall 以可被独立 mock 替换的方式定义,使上层命令封装可在不启动真实进程的情况下被测试。

### Requirement 2: 本地子进程启动与配置

**Objective:** 作为后端会话引擎,我想要 `PiRpcProcess` 按上游给定的 spawnSpec 启动本地子进程,以便无需依赖全局 `pi`、且 spawn 目标完全由上游决定。

#### Acceptance Criteria

1. When `PiRpcProcess` 被创建并给定一个 spawnSpec(包含命令、参数、工作目录、环境变量), the `PiRpcProcess` shall 以该规格 spawn 子进程,并将其 stdin/stdout/stderr 接为管道。
2. The `PiRpcProcess` shall 以 `detached: false` 启动子进程,使父进程退出时子进程被连带清理。
3. The `PiRpcProcess` shall 不在内部决定或推断 spawn 目标(命令/参数/cwd/env),而是完全采用传入的 spawnSpec。
4. If spawn 子进程失败(命令不存在或无法执行), then the `PiRpcProcess` shall 传播一个可被上层观察到的错误,且不进入"已就绪"状态。

### Requirement 3: 协议正确的 JSONL 成帧

**Objective:** 作为后端会话引擎,我想要协议正确的 JSONL reader,以便严格遵循 pi 的 JSONL 语义、避免 Node `readline` 在特殊字符处误切。

#### Acceptance Criteria

1. The `PiRpcProcess` 的 stdout reader shall 仅以换行符 `\n` 作为行边界进行切分,且不使用 Node `readline`。
2. When 一行文本以回车符 `\r` 结尾(CRLF), the stdout reader shall 在切分后剥离该尾随 `\r`,得到不含 `\r` 的行内容。
3. When stdout 数据分多个 chunk 到达且某行被拆分在 chunk 边界, the stdout reader shall 缓冲不完整片段并在后续 chunk 补齐后输出该完整行。
4. When 一行 JSON 字符串内部包含 `U+2028` 或 `U+2029` 字符, the stdout reader shall 不在这些字符处切行,而是将其作为该行内容的一部分保留。
5. When stdout 中出现空行(仅 `\n` 或仅 `\r\n`), the stdout reader shall 跳过该空行而不向上层分发,且不报错。
6. When 单个 chunk 中包含多条以 `\n` 分隔的完整行, the stdout reader shall 按出现顺序逐行依次分发。

### Requirement 4: stdout 三类消息分发

**Objective:** 作为后端会话引擎,我想要 `PiRpcProcess` 把 stdout 的三类消息分别处理,以便命令有响应、事件被广播、扩展 UI 请求能挂起等待回复。

#### Acceptance Criteria

1. When 一条解析后的 stdout 消息属于命令响应类(带关联 `id`), the `PiRpcProcess` shall 依据该 `id` 兑现对应的待决 Promise,并将该响应作为兑现值。
2. When 一条解析后的 stdout 消息属于事件类, the `PiRpcProcess` shall 将该事件广播给所有经 `onEvent()` 注册的监听器。
3. When 一条解析后的 stdout 消息属于扩展 UI 请求类, the `PiRpcProcess` shall 将该请求登记为待决项(按其 `id`)并通知上层,等待经 `respondExtensionUI(id, …)` 提供回复。
4. When 上层针对某个待决扩展 UI 请求调用 `respondExtensionUI(id, …)`, the `PiRpcProcess` shall 把对应回复经 `send` 写入子进程 stdin,并将该请求从待决登记中移除。
5. If 收到的响应 `id` 没有对应的待决请求, then the `PiRpcProcess` shall 丢弃该响应并记录可观察的诊断信息,而不崩溃。
6. If 一行 stdout 内容无法解析为合法消息, then the `PiRpcProcess` shall 跳过该行并记录可观察的诊断信息,而不中断后续行的处理。

### Requirement 5: 命令方法封装

**Objective:** 作为后端会话引擎,我想要一组与包 `RpcClient` 对齐的命令方法,以便以类型化、按 `id` 关联响应的方式驱动会话,而无需手写帧。

#### Acceptance Criteria

1. The `PiRpcProcess` shall 暴露与 `RpcClient` 对齐的命令方法:`prompt`、`steer`、`followUp`、`abort`、`setModel`、`cycleModel`、`getAvailableModels`、`setThinkingLevel`、`getState`、`getMessages`、`getSessionStats`、`getCommands`、`compact`、`fork`、`clone`、`newSession`、`bash`、`abortBash`。
2. When 一个期望响应的命令方法被调用, the `PiRpcProcess` shall 生成唯一的关联 `id`、经 `send` 写入命令帧,并返回一个在对应响应到达时兑现的 Promise。
3. The `PiRpcProcess` shall 使用上游 `protocol-contract` 导出的命令/响应类型作为这些方法的输入与输出类型,而不重新定义协议类型。
4. While 一个命令的响应尚未到达, the `PiRpcProcess` shall 保持该命令的 Promise 待决,且不阻塞其他命令或事件的处理。
5. The `PiRpcProcess` shall 暴露 `onEvent()` 用于订阅事件,以及 `respondExtensionUI(id, …)` 用于回复扩展 UI 请求。

### Requirement 6: 子进程生命周期与错误传播

**Objective:** 作为后端会话引擎,我想要 `PiRpcProcess` 管理子进程生命周期并传播错误,以便关闭时干净退出、无僵尸进程,且异常可被上层观察。

#### Acceptance Criteria

1. The `PiRpcProcess` shall 持续收集子进程 stderr 输出,并使其可被上层用于诊断。
2. When 子进程退出, the `PiRpcProcess` shall 发出一个携带退出码/信号的可观察信号,并拒绝所有仍待决的命令 Promise。
3. When 上层调用 `close()`, the `PiRpcProcess` shall 终止子进程、关闭 stdin、停止分发后续行,并使所有待决命令以"通道已关闭"理由被拒绝。
4. While 子进程已退出或通道已关闭, the `health()` shall 报告通道为不健康/不可用状态。
5. If 子进程异常崩溃, then the `PiRpcProcess` shall 将崩溃作为可观察错误传播给上层,而不静默吞掉。
6. When `close()` 完成后, the `PiRpcProcess` shall 不遗留运行中的子进程(无僵尸进程)。

### Requirement 7: 可测试性与验证(硬性)

**Objective:** 作为项目维护者,我想要本通道具备完整的单元/集成/e2e 测试,以便以新鲜运行证据证明 JSONL 成帧、消息分发与生命周期行为正确。

#### Acceptance Criteria

1. The 单元测试 shall 覆盖 JSONL 成帧:分片到达跨 chunk 拼接、CRLF 尾随 `\r` 剥离、JSON 字符串内含 `U+2028`/`U+2029` 不被误切、空行容错,且每项断言可独立验证。
2. The 单元测试 shall 覆盖响应与 `id` 关联:命令方法发出帧后,对应 `id` 的响应到达时其 Promise 被正确兑现;无对应 `id` 的响应被安全丢弃。
3. The 单元测试 shall 覆盖扩展 UI 子协议:`extension_ui_request` 被挂起为待决项,`respondExtensionUI(id, …)` 经 stdin 写出回复并清除待决项。
4. The 集成测试 shall 对真实 `pi --mode rpc`(或等价 stub 进程)spawn,发送 `prompt` 并收到 `agent_end` 事件。
5. The e2e 测试 shall 完成完整一轮:spawn → prompt → 收集 `text_delta`/工具相关事件 → `abort` 生效 → `close()` 干净退出且无僵尸进程。
6. The 测试套件 shall 以单一命令运行全部单元/集成/e2e 测试并产出可验证结果。
