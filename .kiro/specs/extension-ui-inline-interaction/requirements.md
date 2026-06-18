# Requirements Document

## Introduction

当前扩展 UI 的四类交互（confirm 确认 / select 选择 / input 输入 / editor 编辑）以模态弹窗形式呈现：弹窗居中遮挡界面、强制打断、应答后即消失不留痕。本特性将这四类交互改造为**对话消息流末尾的内联卡片**，使交互嵌入对话上下文、弱打断、并在应答后保留只读结果留痕；同时统一应用于富聊天与基础聊天两个装配组件。改造仅覆盖交互类呈现层，不改变扩展 UI 的请求/响应协议契约，也不改变非交互（ambient）能力与建议（Suggestion）组件的行为。

## Boundary Context

- **In scope**：confirm / select / input / editor 四类交互的内联呈现、应答回传、应答后终态留痕、多请求 FIFO 串行处理、可达性与弱打断语义、应答失败保留与重试、会话视图内的留痕生命周期；在富聊天与基础聊天两个装配中以一致方式提供。
- **Out of scope**：非交互（ambient）能力 notify / status / widget / title / 编辑器文本注入的行为变更；建议（Suggestion）组件的行为或布局变更；交互留痕的跨会话/持久化保存；扩展 UI 请求或响应结构（协议契约）的任何变更。
- **Adjacent expectations**：依赖既有扩展 UI 请求队列（FIFO）与回传通道持续提供请求投递与应答回传能力；依赖宿主聊天装配提供对话消息流容器以承载内联交互卡。

## Requirements

### Requirement 1: 交互请求的内联呈现
**Objective:** As a 使用聊天界面的最终用户, I want agent 发起的交互请求内联出现在对话流中而非模态弹窗, so that 我能在对话上下文中理解并响应请求且不被强制打断。

#### Acceptance Criteria
1. When agent 发起 confirm / select / input / editor 任一交互请求, the 扩展交互界面 shall 在对话消息区末尾以内联卡片呈现该请求。
2. While 存在待处理交互请求, the 扩展交互界面 shall 不以模态遮罩或全屏浮层方式呈现该请求。
3. When 交互请求内联呈现, the 扩展交互界面 shall 展示该请求的标题或描述文本与对应的可操作控件。
4. The 扩展交互界面 shall 对 confirm、select、input、editor 四类交互方式均提供内联呈现。

### Requirement 2: 四类交互的应答与回传
**Objective:** As a 最终用户, I want 在内联卡中对每类交互作出应答并将结果回传给 agent, so that agent 能据我的选择继续工作。

#### Acceptance Criteria
1. When 用户在 confirm 卡点击「批准」, the 扩展交互界面 shall 以确认通过的语义回传响应。
2. When 用户在 confirm 卡点击「拒绝」, the 扩展交互界面 shall 以确认否决的语义回传响应。
3. When 用户在 select 卡选定某选项并提交, the 扩展交互界面 shall 以所选选项的值回传响应。
4. When 用户在 input 卡输入文本并提交, the 扩展交互界面 shall 以输入文本回传响应。
5. When 用户在 editor 卡（含可选预填文本）编辑并提交, the 扩展交互界面 shall 以编辑后文本回传响应。
6. When 用户在 select / input / editor 卡点击「取消」, the 扩展交互界面 shall 以取消的语义回传响应。
7. The 扩展交互界面 shall 使每次应答携带与原请求匹配的请求标识，以保证响应与请求一一对应。

### Requirement 3: 应答后的终态留痕
**Objective:** As a 最终用户, I want 应答后该交互卡保留为只读结果而非消失, so that 我能回顾我已经做过的决定。

#### Acceptance Criteria
1. When 用户成功应答某交互请求, the 扩展交互界面 shall 将该卡保留为只读终态而不移除。
2. When confirm 被批准或拒绝, the 扩展交互界面 shall 在终态分别显示「已批准」或「已拒绝」。
3. When select 被提交, the 扩展交互界面 shall 在终态显示所选择的值。
4. When input 被提交, the 扩展交互界面 shall 在终态显示已提交的输入值。
5. When editor 被提交, the 扩展交互界面 shall 在终态显示已提交状态，并对过长文本以折叠或省略方式展示。
6. When 交互被取消, the 扩展交互界面 shall 在终态显示「已取消」。
7. While 某交互卡处于终态, the 扩展交互界面 shall 不再接受对该卡的进一步输入或再次提交。

### Requirement 4: 多请求 FIFO 串行处理
**Objective:** As a 发起交互的扩展作者, I want 多个交互请求按发起顺序逐个被应答, so that 我的交互逻辑获得确定、有序的响应。

#### Acceptance Criteria
1. While 队列中存在多个待处理请求, the 扩展交互界面 shall 仅将最早入队的请求呈现为可应答（active）状态。
2. While 当前 active 请求尚未应答, the 扩展交互界面 shall 不允许对其后排队的请求进行应答。
3. When 当前 active 请求被应答, the 扩展交互界面 shall 将下一个排队请求提升为 active。
4. The 扩展交互界面 shall 按应答先后顺序保留各留痕卡，并使 active 卡位于既有留痕之后（最新位置）。

### Requirement 5: 可达性与弱打断
**Objective:** As a 使用辅助技术或键盘的最终用户, I want 新交互请求被无障碍告知且可键盘操作，同时不被强制锁定焦点, so that 我既能及时获知请求又能自由选择何时响应。

#### Acceptance Criteria
1. When 新的 active 交互请求出现, the 扩展交互界面 shall 通过非打断优先级的实时播报区域向辅助技术告知该请求。
2. When 新的 active 交互请求出现, the 扩展交互界面 shall 将该卡滚动至可见区域。
3. When 新的 active 交互请求出现, the 扩展交互界面 shall 将键盘焦点置于该卡的首个可操作控件。
4. While 存在 active 交互请求, the 扩展交互界面 shall 不锁定焦点，允许用户离开该卡继续在输入框输入。
5. The 扩展交互界面 shall 为每张交互卡提供分组语义与可访问名称。

### Requirement 6: 留痕的会话内生命周期
**Objective:** As a 最终用户与操作者, I want 明确交互留痕是会话视图内的临时记录, so that 刷新后不会残留过期或可误触的请求。

#### Acceptance Criteria
1. While 聊天视图持续存续, the 扩展交互界面 shall 保留本次视图存续期内已应答交互的留痕。
2. If 页面刷新或聊天视图重新挂载, then the 扩展交互界面 shall 不恢复此前的交互留痕。
3. The 扩展交互界面 shall 不将交互留痕写入对话消息历史或持久化存储。

### Requirement 7: 应答失败与重试
**Objective:** As a 最终用户, I want 应答提交失败时不丢失该请求并能重试, so that 网络或后端瞬时故障不会导致交互卡顿或丢失。

#### Acceptance Criteria
1. If 交互应答提交失败, then the 扩展交互界面 shall 保留该交互卡为可应答状态。
2. If 交互应答提交失败, then the 扩展交互界面 shall 显示可读的错误信息。
3. When 用户在失败后再次提交, the 扩展交互界面 shall 重新尝试回传该响应。
4. While 某次应答提交进行中, the 扩展交互界面 shall 禁用该卡的提交与动作控件以防重复提交。

### Requirement 8: 范围边界与优雅降级
**Objective:** As a 集成聊天装配的开发者, I want 本改造仅影响交互类呈现而不波及其他能力, so that 既有非交互能力、建议组件与协议契约保持稳定。

#### Acceptance Criteria
1. Where 宿主未提供扩展 UI 能力, the 扩展交互界面 shall 不渲染任何交互卡且不报错。
2. The 扩展交互界面 shall 不改变 notify / status / widget / title / 编辑器文本注入等非交互（ambient）能力的现有行为。
3. The 扩展交互界面 shall 不改变建议（Suggestion）组件的现有行为与布局。
4. The 扩展交互界面 shall 在富聊天与基础聊天两个装配组件中以一致方式提供内联交互呈现。
5. The 扩展交互界面 shall 不引入对扩展 UI 请求或响应结构（协议契约）的任何变更。
