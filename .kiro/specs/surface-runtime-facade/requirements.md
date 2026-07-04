# Requirements Document

## Project Description (Input)
Surface App Runtime 契约 M-A:门面收口与对话桥落地。**权威依据:docs/surface-app-runtime-contract-v1.md**(以下称"契约");本 spec 只兑现契约 [生效] 条款,§13 未来扩展栏的 [预定形] 条款一律不实现(契约 §0 元规则:不为未来应用做设计)。上游 spec:agent-authoritative-surface(createSurface/useSurface/wireSurfaceBridge 已在 main)。

### 范围

① **ConversationBridge 门面**(契约 §4.5,packages/react):`useConversationBridge()` 作为应用面对对话桥的**唯一入口**,由 SlotHost 注入装配,应用面不再裸接三个 props。成员:
- `opChannel: "prompt" | "command" | "unavailable"` —— 契约 C3-4 降级次序的探测结果(Prompt 通道在→prompt;缺失但探针可用→command;皆无→unavailable),供 UI 可感知地呈现降级态(C3-4 MUST);
- `submitOp(op)` —— 内联 fence 组装器 `renderSurfaceOp`(标题行 + `surface-op` fence,泛化自 canvas `buildToolPrompt`;格式是约定 SHOULD 非协议),按 opChannel 走 Prompt 通道或降级 `run()`;
- `bringToConversation(refs, summary?)` —— ContextInjection(C3-2)注入门面,复用 attachment-bridge 既有引用注入机制;
- `onTurnEnd(cb)` —— TurnSync(C3-3)订阅门面,封装 syncSignal 边沿。

② **宿主 seam 能力对象化**(契约 §4.2 命名事故修复):SlotHost 注入集新增 `conversation` 能力对象(`submitUserMessage(text)` 等),与 upload/surface/state 同族;`onSubmitPrompt` 保留为过渡别名(deprecated,一个大版本),现有消费者零破坏。宿主保持领域无关:不知道消息内容是什么(§4.2 法则)。

③ **createSurface/useSurface 门面按"应用"重组导出**:agent 侧(tool-kit surface 子入口)与 UI 侧(react hooks)收口为清晰的应用面入口叙事(导出重组,不改实现语义);kernel 级内部件不出现在公开入口(呼应"库不是法"与封装边界惯例)。

④ **canvas 迁移为首个门面消费者**:CanvasWorkbench/CanvasGallery/CanvasPanel 弃裸 props(onSubmitPrompt/syncSignal 直连)改走 `useConversationBridge`;`buildToolPrompt` 的组装职责移交 `renderSurfaceOp`(canvas 保留领域决策 `decideGenerate` 与参数组装);"surface 不可用"提示升级为按 `opChannel` 三态呈现(C3-4)。

### 非目标(契约 §13 预定形,明令不做)

SurfaceAppConfig 声明字段(C1-1 投影权威)/ SurfaceJob 类型与 livePreview 迁移(C5-2 作业形制)/ C6 数据面与 Agent Routes / C2-4 生命周期 / C7-3 PreviewTelemetry;不改 pi 协议、不改 wireSurfaceBridge/wireStateBridge/粘性机制;不新增任何 SSE 帧或端点。

### 验收线

1. **行为回归**:现有 canvas 全部单测(packages/ui/test/canvas/*)与浏览器 e2e canvas 闭环零改动全绿(别名兼容保证);
2. **契约条款可测映射**:C3-4 三态降级(opChannel 单测:三种注入组合 → 三态 + submitOp 分道)/ C3-1 通道法(prompt 态下 submitOp 产出经 conversation.submitUserMessage 的用户消息,fence 含 tool/params)/ §4.2 分层(迁移后 canvas 组件 grep 无裸 `onSubmitPrompt` 消费;宿主代码 grep 无 fence/领域词);
3. **新增单测**:ConversationBridge 三成员 + renderSurfaceOp 纯函数(标题行/fence/参数省略规则对齐 buildToolPrompt 现语义);
4. **降级 e2e**:无 surface 的 agent source 下 canvas 面板呈现 unavailable 态不崩(衔接 SES-U2)。

## Introduction

本 spec 兑现 Surface App Runtime 契约(docs/surface-app-runtime-contract-v1.md)的 M-A 里程碑:把对话桥的三个宿主裸注入项(提交回调、轮末信号、控制面访问)收口为应用面的统一门面 `useConversationBridge`,把宿主的会话提交能力从事件回调形态更名为能力对象形态,并让 canvas 作为首个消费者完成迁移验证。目标读者是 surface 应用面开发者(门面使用方)与宿主维护者(注入方);对最终用户唯一可见的变化是 canvas 在通道降级时呈现更准确的三态提示。所有行为以契约 [生效] 条款为规范依据,条款号在各验收标准中标注。

## Boundary Context

- **In scope**:对话桥门面(通道探测/操作提交/上下文注入/轮末订阅)、操作消息组装器、宿主 `conversation` 能力对象注入与 `onSubmitPrompt` 过渡别名、surface 门面导出重组、canvas 迁移与降级三态呈现。
- **Out of scope**:契约 §13 全部 [预定形] 条款(SurfaceAppConfig 投影权威、SurfaceJob 作业形制与 livePreview 迁移、C6 数据面/Agent Routes、C2-4 生命周期、C7-3 PreviewTelemetry);pi 协议与 SSE 帧/端点的任何改动;wireSurfaceBridge/wireStateBridge/粘性帧机制的任何改动;canvas 组件迁出宿主 ui 包(属 canvas-kit-m1 spec);`decideGenerate` 动作链插件化。
- **Adjacent expectations**:上游 spec agent-authoritative-surface 已交付 createSurface/useSurface/wireSurfaceBridge 且在 main 稳定;宿主既有的提交通道(用户敲字同道)、轮末信号(busy→idle 边沿)与附件引用注入机制继续按现状工作,本 spec 只包装不重造;canvas-kit-m1 spec 与本 spec 并行,以本契约为规范依据,二者不得产生冲突的 canvas 改动。

## Requirements

### Requirement 1: 对话桥统一门面
**Objective:** As a surface 应用面开发者, I want 经由单一门面获得对话桥的全部能力, so that 我不再裸接多个宿主注入项、接线方式统一且不易出错

#### Acceptance Criteria
1. The Runtime SDK shall 提供 `useConversationBridge()` 门面,作为应用面访问对话桥(操作消息、上下文注入、轮末同步)的唯一入口(契约 §4.5)。
2. The 门面 shall 暴露且仅暴露四个成员:`opChannel`(通道探测结果)、`submitOp`(操作提交)、`bringToConversation`(上下文注入)、`onTurnEnd`(轮末订阅)。
3. When 应用面在插槽宿主环境中使用门面, the Runtime SDK shall 从宿主注入集自动装配桥能力,应用面无需直接引用提交回调、轮末信号等裸注入项。
4. If 门面在无宿主注入的环境(如独立渲染或测试)中使用, the Runtime SDK shall 返回 `opChannel = "unavailable"` 的降级门面而非抛出异常。

### Requirement 2: 操作通道探测与降级次序
**Objective:** As a surface 应用面开发者, I want 门面自动探测操作消息的可用通道并严格按契约次序降级, so that 应用面不必自行判断宿主能力,也不可能跳级违章(契约 C3-4 MUST)

#### Acceptance Criteria
1. While 宿主已注入会话提交能力(Prompt 通道在), the 门面 shall 报告 `opChannel = "prompt"`。
2. While 会话提交能力缺失 and 控制面命令探针返回可用, the 门面 shall 报告 `opChannel = "command"`。
3. While 会话提交能力与控制面命令皆不可用, the 门面 shall 报告 `opChannel = "unavailable"`。
4. When 应用面在 `opChannel = "prompt"` 时调用 `submitOp`, the 门面 shall 将操作组装为结构化用户消息并经宿主会话通道提交,使该操作以用户消息身份进入对话历史(契约 C3-1)。
5. When 应用面在 `opChannel = "command"` 时调用 `submitOp` and 该操作声明了控制面等价命令, the 门面 shall 将操作降级为控制面命令执行(LLM 不在环,效果仍经状态面回流)。
6. If 应用面在 `opChannel = "command"` 时调用 `submitOp` and 该操作未声明控制面等价命令, the 门面 shall 拒绝执行并以调用方可观察的方式报告失败(不得静默丢弃)。
7. If 应用面在 `opChannel = "unavailable"` 时调用 `submitOp`, the 门面 shall 拒绝执行并以调用方可观察的方式报告失败(不得静默丢弃)。
8. The 门面 shall 不提供绕过降级次序、由应用面直接指定通道的手段。

### Requirement 3: 操作消息组装器
**Objective:** As a surface 应用面开发者, I want 一个统一的操作消息组装器, so that 各应用面产出格式一致的操作消息,且组装逻辑可脱离宿主独立验证

#### Acceptance Criteria
1. The Runtime SDK shall 提供操作消息组装器 `renderSurfaceOp`:输入操作描述(标题、工具名、参数表),输出由可读标题行与操作代码块组成的消息文本(格式为运行时约定 SHOULD,非协议;契约 C3-1)。
2. The 组装器 shall 对空缺参数省略不输出,参数省略语义与现行 canvas 组装行为对齐。
3. The 组装器 shall 为纯函数:相同输入恒产生相同输出且无副作用。
4. When `submitOp` 经 Prompt 通道提交操作, the 提交的消息 shall 含可读标题行与工具/参数信息,使用户在对话历史中可理解该操作的来源与内容(契约 §4.1 身份语义)。

### Requirement 4: 上下文注入门面
**Objective:** As a surface 应用面开发者, I want 一个把制品引用与摘要带入对话的门面, so that surface 状态进入 LLM 上下文只走这道唯一正门(契约 C3-2 MUST)

#### Acceptance Criteria
1. When 应用面在 `opChannel = "prompt"` 时调用 `bringToConversation(refs, summary?)`, the 门面 shall 复用宿主既有的附件引用注入机制,把制品引用连同可选摘要作为用户消息提交进对话流。
2. Where 调用时提供了摘要, the 提交的消息 shall 以摘要为消息文本;Where 未提供摘要, the 门面 shall 使用可识别的默认文本(具体措辞在设计阶段确定)。
3. If 应用面在 `opChannel` 非 `"prompt"` 时调用 `bringToConversation`, the 门面 shall 拒绝执行并以调用方可观察的方式报告失败(上下文注入本质依赖对话通道,无降级路径)。
4. The 门面 shall 不提供除 `bringToConversation` 之外任何把 surface 状态送入 LLM 上下文的手段。

### Requirement 5: 轮末同步订阅门面
**Objective:** As a surface 应用面开发者, I want 以订阅回调的方式感知对话轮结束, so that 我可以在轮末收敛物化视图并清理临时叠层,而无需理解宿主信号的实现形态(契约 C3-3 MUST)

#### Acceptance Criteria
1. When 宿主报告一轮对话结束(繁忙→空闲边沿), the 门面 shall 调用所有经 `onTurnEnd` 注册且未退订的回调。
2. The `onTurnEnd` shall 返回退订函数;When 应用面调用退订函数后宿主再次报告轮末, the 门面 shall 不再调用该回调。
3. If 宿主未注入轮末信号(降级环境), the 门面 shall 接受注册但不触发回调,且不抛出异常。

### Requirement 6: 宿主会话能力对象化与过渡别名
**Objective:** As a pi-web 宿主维护者, I want 会话提交能力以能力对象形态注入插槽, so that 注入命名反映真实语义(能力而非事件回调),同时现有消费者零破坏(契约 §4.2)

#### Acceptance Criteria
1. The 宿主 shall 向插槽组件注入 `conversation` 能力对象,其 `submitUserMessage(text)` 使传入文本与用户手动输入同道进入对话流。
2. The 宿主 shall 同时保留 `onSubmitPrompt` 注入项作为过渡别名,标记为 deprecated,其行为与 `conversation.submitUserMessage` 完全一致。
3. The 过渡别名 shall 保留至少一个大版本后方可移除。
4. When 既有插槽消费者仅使用 `onSubmitPrompt`, the 系统 shall 保持其行为与本 spec 实施前完全一致(零破坏)。
5. The 宿主注入层 shall 保持领域无关:不含任何操作消息格式、领域词汇或应用面内容的知识(契约 §4.2 法则)。

### Requirement 7: surface 门面导出重组
**Objective:** As an agent 侧与应用面开发者, I want surface 相关公开入口按"应用面开发"叙事收口, so that 我能从清晰的入口找到全部所需门面,而内部装配件不外泄

#### Acceptance Criteria
1. The agent 侧工具包 shall 经专一入口导出 agent 侧 surface 门面(createSurface 及其类型),UI 侧 SDK shall 经其公开入口一并导出 `useSurface` 与 `useConversationBridge`。
2. The 公开入口 shall 不导出仅供宿主内部装配使用的部件。
3. The 导出重组 shall 不改变任何既有公开 API 的行为语义;If 既有导入路径需要变更, the 系统 shall 保留兼容导出至少一个大版本。

### Requirement 8: Canvas 迁移为首个门面消费者
**Objective:** As a Canvas 应用面维护者, I want canvas 组件改走对话桥门面并按三态呈现降级, so that 门面在真实应用面得到验证,且用户能准确感知通道降级(契约 C3-4 MUST)

#### Acceptance Criteria
1. The Canvas 组件 shall 经 `useConversationBridge` 获取对话桥能力,迁移后不再直接消费提交回调与轮末信号裸注入项。
2. The Canvas shall 保留领域决策(生成动作选择与参数组装)在应用面,消息组装职责移交 SDK 组装器(契约 §4.2 分层)。
3. When 迁移完成后 canvas 提交生成操作, the 产出的操作消息文本 shall 与迁移前语义等价,现有 canvas 单元测试与端到端闭环零改动通过。
4. While `opChannel = "prompt"`, the Canvas shall 照常经对话流提交生成操作。
5. While `opChannel = "command"`, the Canvas shall 以用户可感知的方式呈现"操作不进入对话、LLM 不在环"的降级态(契约 C3-4:②与①语义不同,必须可感知)。
6. While `opChannel = "unavailable"`, the Canvas shall 呈现不可用提示且仅保留本地工具,面板不崩溃。
7. When 在未提供 surface 能力的 agent 源下打开 canvas 面板, the 面板 shall 呈现 unavailable 态并保持可用的本地功能(降级端到端验证)。
