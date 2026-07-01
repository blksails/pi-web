# Requirements Document

## Introduction

pi coding agent 支持在 agent 忙碌（正在处理某个轮次/turn）时把后续用户消息**排队**：`steering` 消息在当前 assistant 轮的工具调用结束后投递，`follow-up` 消息在 agent 全部工作结束后投递；用户还可把已排队消息**取回**编辑器继续修改。pi-web 的底层管道大部分已就绪——protocol 有 `streamingBehavior`（`"steer"｜"followUp"`）、`control:queue` 帧、`data-pi-queue`、`queue_update` 事件；server 有 `/steer`、`/follow_up` 路由与 `queue_update → data-pi-queue` 翻译；react 有 `PiClient.steer/followUp`、`usePiControls().steer/followUp` 与只读的队列快照。

但前端从未激活这套能力：`PiChat` 的输入区在忙时既不带 `streamingBehavior`、也不调用 `steer/followUp`，忙时提交会触发 pi SDK「streaming 时缺少 streamingBehavior」报错；已解码的队列快照也无任何组件消费/渲染；「取回」所需的 `clearQueue` 端点在 protocol/server/react 三层均未暴露。

本特性面向 pi-web 终端用户，目标是把 message queue 能力接线到前端并补齐取回回环：忙时按投递语义排队、可视化队列与 pending 计数、把已排队消息取回编辑器，从而与 pi 原生 TUI 的交互对齐。

## Boundary Context

- **In scope**：
  - 忙时提交按 `steering`（Enter）/ `follow-up`（Alt+Enter）语义排队（前端携带 `streamingBehavior` 或改调 `steer/followUp`）。
  - 队列可视化：展示已排队消息及其归类、pending 计数；空闲且队列为空时不占可见空间。
  - 取回已排队消息到编辑器：新增跨层 `clearQueue` 端点（protocol schema + server 路由 + react client）+ 前端取回交互（Esc / Alt+Up）。
  - 消除忙时提交的 pi SDK 报错。
  - 单元/集成测试与浏览器 e2e 覆盖上述用户可观测行为。
- **Out of scope**：
  - 修改 pi SDK 的排队/投递算法或 `steeringMode`/`followUpMode`（`one-at-a-time`｜`all`）投递策略——这些由 pi 子进程权威决定，前端只反映其发出的队列快照。
  - 忙时排队承载 attachment-store 引用附件（`att_…`）：`/steer`、`/follow_up` 端点（`SteerRequest`）仅支持 `message` + 内联图片，不接受 `attachmentIds`。
  - 队列中单条消息的独立删除/重排（当前队列快照仅为字符串数组，无稳定条目 id）。
- **Adjacent expectations**：
  - 依赖 pi 子进程通过 `queue_update` 事件持续推送权威队列快照，经 server 翻译为 `control:queue` / `data-pi-queue` 到达前端；本特性不改变该权威来源，只消费与触发。
  - 依赖既有会话就绪握手（session readiness）与 busy 权威快照（session-snapshot-authority）判定忙/闲状态。

## Requirements

### Requirement 1: 忙时按投递语义排队提交

**Objective:** 作为 pi-web 用户，我希望在 agent 忙碌时仍能继续输入并按「插话 / 跟进」语义把消息排队，以便无需等待当前轮次结束就能引导或补充任务。

#### Acceptance Criteria

1. While 会话处于 busy 状态, when 用户以默认提交键（Enter）提交一条非空消息, the PiChat 输入区 shall 以 `steering` 行为投递该消息（携带 `streamingBehavior="steer"` 或调用 steer 通道）并清空输入框。
2. While 会话处于 busy 状态, when 用户以跟进提交键（Alt+Enter）提交一条非空消息, the PiChat 输入区 shall 以 `follow-up` 行为投递该消息并清空输入框。
3. While 会话处于 idle 状态, when 用户以 Enter 或 Alt+Enter 提交非空消息, the PiChat 输入区 shall 发起常规 prompt（不排队，保持既有发送行为不变）。
4. While 会话处于 busy 状态, the PiChat 输入区 shall 允许提交（提交可用性不再因 busy 被阻断，仅要求会话就绪且存在可提交内容）。
5. While 会话处于 busy 状态, the PiChat 输入区 shall 同时保留中止（abort/Stop）能力，使排队提交与中止当前轮次并存。
6. When 用户在会话未就绪（session not ready）时尝试提交, the PiChat 输入区 shall 沿用既有就绪门控拒绝提交（本特性不放宽就绪门控）。

### Requirement 2: 队列可视化与 pending 计数

**Objective:** 作为 pi-web 用户，我希望看到当前有哪些消息在排队以及排队总数，以便确认自己的输入已被接受且了解待处理进度。

#### Acceptance Criteria

1. When 前端收到非空队列快照（`steering` 或 `followUp` 数组非空）, the 队列展示区 shall 显示各待投递消息条目及其归类（`steering` 与 `follow-up` 可区分）。
2. While 存在已排队消息, the 队列展示区 shall 显示 pending 计数（`steering` 与 `followUp` 合计条数）。
3. When 队列快照变为空, the 队列展示区 shall 隐藏队列条目与 pending 计数。
4. While 会话空闲且队列为空, the 队列展示区 shall 不占用可见布局空间（不得出现空白占位区域）。
5. The 队列展示区 shall 暴露稳定的 `data-*` 标记（用于断言 pending 计数与队列条目存在性），以支持自动化验收。

### Requirement 3: 取回已排队消息到编辑器

**Objective:** 作为 pi-web 用户，我希望把已排队但尚未投递的消息取回输入框，以便在投递前继续修改或撤回它们。

#### Acceptance Criteria

1. The pi-web 命令通道 shall 提供「清空队列」端点，清空 agent 当前排队消息并返回被清空的 `steering` 与 `followUp` 文本；该端点契约在 protocol 层定义。
2. While 存在已排队消息且输入框为空, when 用户触发取回（Esc 或 Alt+Up）, the PiChat 输入区 shall 调用清空队列端点，将返回的已排队文本回填到输入框，并使队列展示区随后清空。
3. While 存在已排队消息且输入框已有未提交文本, when 用户触发取回, the PiChat 输入区 shall 将取回文本追加到现有文本之后（以换行分隔），不得覆盖或丢弃用户已输入内容。
4. When 清空队列端点返回多条已排队文本, the PiChat 输入区 shall 按稳定顺序（先 `steering` 后 `followUp`，各自保持原有先后）以换行连接后回填。
5. If 队列为空, when 用户按 Esc, the PiChat 输入区 shall 不调用清空队列端点，且保持既有 Esc 行为（例如关闭补全弹层）不变。
6. If 清空队列端点调用失败, the PiChat 输入区 shall 提示错误且不修改输入框现有内容（避免丢失文本）。

### Requirement 4: 忙时提交错误防护

**Objective:** 作为 pi-web 用户，我希望忙时提交不再触发底层报错，以便排队功能稳定可用。

#### Acceptance Criteria

1. While 会话处于 busy 状态, when 用户提交消息, the pi-web 前端 shall 始终附带排队行为（`steer` 或 `followUp`），使 pi SDK 不因 streaming 时缺少 `streamingBehavior` 而报错。
2. If 忙时排队投递失败, the PiChat 输入区 shall 呈现可见错误反馈，且不静默丢弃用户输入。

### Requirement 5: 附件/补全链路的退化与回归防护

**Objective:** 作为 pi-web 用户，我希望排队功能不破坏既有的补全与附件体验，以便日常发送不受影响。

#### Acceptance Criteria

1. While 会话处于 busy 状态, when 用户提交含 `@` 补全 token 的消息, the pi-web 前端 shall 沿用既有补全解析链路处理该排队消息（与空闲提交一致）。
2. While 会话处于 busy 状态, if 用户提交时带有 attachment-store 引用附件（`att_…`）, the PiChat 输入区 shall 避免静默丢弃该附件——阻止该次排队并提示用户附件需在会话空闲时发送。
3. When 会话处于 idle 状态, the PiChat 输入区 shall 保持既有 prompt 提交链路（含附件引用、内联图片、补全解析）行为不变。

### Requirement 6: 契约一致性与可验证性

**Objective:** 作为 pi-web 维护者，我希望新增的取回端点遵循既有协议约定并具备完整测试证据，以便安全演进契约。

#### Acceptance Criteria

1. The 清空队列端点 shall 在 protocol 层以显式 schema 定义请求/响应，遵循既有 REST DTO 与 `protocolVersion` 契约约定。
2. The 本特性 shall 提供单元/集成测试覆盖忙时 `steer`/`follow-up` 提交分支、队列快照消费与取回端点行为。
3. The 本特性 shall 提供浏览器端到端测试，覆盖「忙时排队 → 队列可视化 → 取回回填」的完整用户回环。
