# Requirements Document

## Introduction

本特性在**不修改 pi SDK 原码**的前提下，补全 `ctx.ui.custom` 从 agent 子进程到浏览器前端的端到端链路。

现状：pi-web 的 `ctx.ui.custom` 链路端到端是断的，断点在 pi SDK 内部——RPC 模式下 pi SDK 的 `custom()` 是空操作（直接返回 `undefined`，不发任何帧），而前端的注册式渲染器（`registerCustomUi` / `CustomUiRenderer` / `CustomUiDataPart`）早已完整实现却成为"孤儿"，从未有数据喂入。`unified-command-result-layer` 的 Req 6.3 误把"pi SDK 桥接 custom"当成外部依赖假设；实际上 pi SDK 永不会做（custom 是不可跨进程序列化的 TUI 组件 factory）。

本特性由 pi-web 自己补全桥接：在 pi-web 掌控的 runner 接缝处委托/拦截，把 agent 的自定义 UI 意图转成可序列化的 `CustomUiPayload`，复用前端已就绪的注册式渲染器渲染。并提供若干 demo 自定义组件与示例 agent 演示，配单测与 e2e。

面向的角色：
- **Agent 作者**：希望在 web 聊天界面里渲染自己的富交互/展示组件，而不只是文本。
- **pi-web 维护者**：希望桥接层不改 pi 原码、向后兼容、可随 pi 版本升级回归。
- **最终用户**：在聊天流中看到 agent 推送的自定义组件。

## Boundary Context

- **In scope**：pi-web 侧的 custom 桥接（runner 委托/拦截 + 把空 `custom` 替换为会发可序列化帧的实现）；主进程把该帧翻译成前端可消费的形态；前端接收接线（复用现有注册式渲染器）；agent 侧表达 `{component, props}` 的可序列化约定与类型支持；若干 demo 自定义组件 + 示例 agent；单测 + e2e。
- **Out of scope**：修改 pi SDK 原码；接管 `unified-command-result-layer` 的 host 命令通道（本特性仅修正其 Req 6.3 的错误假设说明）；`ctx.ui` 的其它方法（`select`/`confirm`/`input`/`notify`/`setStatus` 等已工作的通道不在改动范围，仅要求不被破坏）；agent 推送的组件代码本身的跨进程传输（约定只传"注册名 + 可序列化 props"，组件实现由前端预注册提供）。
- **Adjacent expectations**：依赖 pi SDK 仍把 uiContext 的绑定权交给 pi-web 传入的 runtime（即 `runRpcMode` 仍经 `session.bindExtensions` 绑定 uiContext）；依赖前端注册式渲染器（`CustomUiPayloadSchema` 契约：`{ component: string, props?: unknown }`）保持现状。若 pi SDK 未来变更绑定方式，本特性需在升级时回归。

## Requirements

### Requirement 1: Agent 推送自定义 UI

**Objective:** 作为 agent 作者，我希望在工具/扩展代码中调用 `ctx.ui.custom` 推送一个自定义组件（注册名 + 可序列化 props），以便在聊天界面渲染富展示/交互内容而非纯文本。

#### Acceptance Criteria
1. When agent 在 RPC 模式下调用 `ctx.ui.custom` 并提供合法的自定义 UI 描述（注册名 + 可序列化 props），the pi-web 自定义 UI 桥接 shall 产生一条携带该描述的输出，并最终送达前端渲染。
2. The pi-web 自定义 UI 桥接 shall 仅承载可序列化的 `{ component, props }` 描述，不要求传输组件实现本身。
3. Where agent 提供 props，the pi-web 自定义 UI 桥接 shall 将 props 原样透传至前端组件，不增删字段。
4. If agent 调用 `ctx.ui.custom` 但未按约定提供可序列化描述，the pi-web 自定义 UI 桥接 shall 安全忽略该调用且不使 agent 子进程崩溃。

### Requirement 2: 端到端送达并渲染

**Objective:** 作为最终用户，我希望 agent 推送的自定义组件出现在聊天流中并正确显示其内容，以便获得超出纯文本的交互体验。

#### Acceptance Criteria
1. When agent 推送的自定义 UI 描述命中前端已注册的组件名，the pi-web 前端 shall 在聊天界面渲染对应组件并以该描述的 props 驱动其内容。
2. When 同一会话中 agent 连续多次推送自定义 UI，the pi-web 前端 shall 按推送顺序分别渲染每一次，互不覆盖前一次的结果。
3. The pi-web 前端 shall 在不引入用户可感知的额外交互步骤的前提下完成自定义组件的展示（推送即渲染，无需用户点击确认）。

### Requirement 3: 未注册与非法输入的安全降级

**Objective:** 作为最终用户，我希望即使 agent 推送了前端未知或损坏的自定义 UI，界面也不崩溃，以便聊天会话保持可用。

#### Acceptance Criteria
1. If agent 推送的自定义 UI 描述的组件名在前端注册表中不存在，the pi-web 前端 shall 渲染一个可识别的降级占位（含未注册组件名提示）而不抛错或中断聊天流。
2. If 送达前端的自定义 UI 描述不符合 `{ component, props }` 契约，the pi-web 前端 shall 忽略该描述且不渲染异常内容。
3. While 自定义 UI 渲染或降级发生，the pi-web 前端 shall 保持聊天流中其它消息与控件正常可交互。

### Requirement 4: 跨会话生命周期持续有效

**Objective:** 作为 agent 作者，我希望自定义 UI 推送在新建会话、切换会话、fork 会话之后仍然有效，以便能力在整个会话生命周期内稳定可用。

#### Acceptance Criteria
1. When 用户在同一 agent 进程内新建会话后 agent 再次调用 `ctx.ui.custom`，the pi-web 自定义 UI 桥接 shall 仍然产生输出并送达前端渲染。
2. When 用户切换或 fork 会话后 agent 再次调用 `ctx.ui.custom`，the pi-web 自定义 UI 桥接 shall 仍然产生输出并送达前端渲染。
3. The pi-web 自定义 UI 桥接 shall 在会话重绑定（rebind）发生后保持其拦截/委托对新会话同样生效。

### Requirement 5: 不改 pi SDK 且向后兼容

**Objective:** 作为 pi-web 维护者，我希望桥接完全在 pi-web 自有代码内实现且不破坏既有能力，以便随 pi 版本升级时易于回归、无副作用。

#### Acceptance Criteria
1. The pi-web 自定义 UI 桥接 shall 不修改 pi SDK（`@earendil-works/pi-coding-agent`）的任何源文件。
2. While 自定义 UI 桥接生效，the pi-web shall 保持 `ctx.ui` 既有方法（`select`/`confirm`/`input`/`notify`/`setStatus` 等）的行为不变。
3. While 自定义 UI 桥接生效，the pi-web shall 不破坏既有的事件流、控制帧与现有渲染器（含 attachment、Tier1–4 web 扩展等）的行为。
4. If agent 从不调用 `ctx.ui.custom`，the pi-web shall 表现得与未引入本特性时一致（零额外可见副作用）。

### Requirement 6: Demo 组件与示例 agent

**Objective:** 作为 agent 作者，我希望有可运行的示例展示 `ctx.ui.custom` 的用法与效果，以便据此实现自己的自定义 UI。

#### Acceptance Criteria
1. The pi-web shall 提供至少两个可注册的 demo 自定义组件，覆盖纯展示型与含 props 数据驱动型两类。
2. The pi-web shall 提供一个示例 agent，其在收到提示时调用 `ctx.ui.custom` 推送上述 demo 组件。
3. The pi-web shall 在示例文档（`examples/README.md` 或等价处）登记该示例并说明如何运行与验证。
4. When 运行该示例 agent 并触发推送，the pi-web 前端 shall 渲染出对应 demo 组件，且未注册的组件名走降级占位。

### Requirement 7: 质量门（单测 + e2e）

**Objective:** 作为 pi-web 维护者，我希望本特性有自动化测试覆盖，以便回归可证、变更可控。

#### Acceptance Criteria
1. The pi-web shall 提供单元/集成测试，覆盖桥接的发帧、主进程翻译、前端渲染与降级路径。
2. The pi-web shall 提供端到端测试，验证从 agent 调用 `ctx.ui.custom` 到前端渲染出 demo 组件的完整链路。
3. The pi-web shall 提供测试验证跨会话（新建/切换/fork 后重绑定）自定义 UI 仍然有效。
4. While 运行既有测试套件，the pi-web shall 不因本特性引入回归失败。
5. The pi-web shall 在隔离构建目录中运行 e2e，不污染共享构建产物。
