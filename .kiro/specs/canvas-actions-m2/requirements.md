# Requirements Document

## Project Description (Input)
M2:canvas 动作链插件化 + 能力清单下发。依据 docs/canvas-extension-mechanism-design.md §3.3/§4/§8(M2 行)与 canvas-kit-m1/canvas-ui-m15 先例。工作目录=隔离 worktree .claude/worktrees/canvas-actions-m2(基线 main 0377b12)。

范围:① defineCanvasAction 评分制契约 + per-instance 注册表;6 内置生成动作(outpaint=100/inpaint=90/reference=80/variants=70/reframe=60/edit=10 兜底)自 decideGenerate if 链迁为插件,内置自举=回归线;② resolveAction 纯注册表函数,decideGenerate/buildToolPrompt 退役为兼容 re-export;③ 能力清单 agent 权威下发(CanvasCapability 切片并入 surface:canvas 快照,前端硬编码清单退 fallback,aigc-quick-settings 同源消费,退化契约);④ 前置小修:piweb_state 粘性登记;⑤ M1 留账两笔(ToolGestureEvent.natural 类型精确化、禁用工具 tooltip 诊断)。

已拍板(2026-07-06 用户确认):车道③保守不自动长按钮;canvas-op fence 维持 tool-kit 现约定零 protocol 包改动;M2 维持会话级单实例。

## Introduction

M1 已把 canvas 内核与 8 个舞台工具插件化(canvas-kit),M1.5 已把组件迁出宿主(canvas-ui)。但「生成什么、怎么生成」仍是封闭代码:动作决策是 canvas-workbench 内的 6 分支 if 链(`decideGenerate`),模型/尺寸清单硬编码在前端(`DEFAULT_MODEL_OPTIONS`/`RATIO_OPTIONS`),清单权威错放 UI 侧曾导致「16:9 选给 gpt-image 被网关拒」类问题。本特性把生成动作插件化为评分制动作链(`defineCanvasAction`),并把能力清单权威移回 agent 侧经 surface 快照下发;同时收两笔 M1 留账与一笔框架级前置小修(state 帧粘性登记,刷新丢画廊的根)。内置 6 动作自举迁移 = 行为回归线:决策结果、提示词形态、既有测试与 e2e 全部零变化。

## Boundary Context

- **In scope**:动作插件契约与 per-instance 注册(canvas-kit L2 扩展);6 内置动作自举迁移与决策器纯函数化;`decideGenerate`/`buildToolPrompt` 兼容退役;CanvasCapability 清单经 surface:canvas 快照下发与前端同源消费/退化;state 帧粘性登记(领域无关);ToolGestureEvent.natural 类型精确化;禁用工具 tooltip 诊断。
- **Out of scope**:M3 canvasPlugins 车道①②(webext/第三方插件包挂载)、注册表跨扩展命名空间、贴纸范例;canvas-kit 内核 L1 与 8 舞台工具行为变更;组件视觉/DOM 锚点变更;`@blksails/pi-web-protocol` 包任何改动(canvas-op fence 维持 tool-kit 现约定);多 Canvas 实例快照/偏好分桶(维持会话级单实例)。
- **Adjacent expectations**:会话桥(surface-runtime-facade 的 conversation 能力对象)与 `surface.run` 命令通道按现契约可用,本特性不改其接口;state 注入桥(state-injection-bridge)承载下行 state 帧,本特性只补服务端粘性登记缺口;模型清单既有来源(tool-kit 目录/关模型设置)继续作为 agent 侧生成清单的事实源,本特性不改清单管理本身;aigc-prompt-toolbar 的偏好 KV(aigc.model/size)读写契约不变。
- **已拍板决策(2026-07-06,用户确认)**:①车道③保守——capability.actions 中无前端插件声明的动作不自动生成按钮,仅供动作 match 避让;②canvas-op fence 不提为 protocol 级 schema;③多实例分桶推迟,M2 会话级单实例。

## Requirements

### Requirement 1: 生成动作插件契约(评分制动作链)

**Objective:** As a canvas 插件作者, I want 用一个对象字面量声明一个生成动作(何时适用、参数怎么构造、走哪条执行通道), so that 不修改工作台代码即可加入或压制动作链中的动作。

#### Acceptance Criteria

1. The canvas-kit 包 shall 提供生成动作的声明与注册能力:动作声明含唯一 id、按钮标签、评分制适用函数(返回数值分或不适用)、参数构造函数、执行通道声明(对话流或命令通道,二选一)。
2. When 多个已注册动作对同一决策输入返回数值分, the 动作决策器 shall 选取分值最高者作为当前动作。
3. When 动作的适用函数返回不适用, the 动作决策器 shall 将该动作从本次决策中排除。
4. When 注册与既有动作相同 id 的动作, the 注册表 shall 拒绝后注册者并记录诊断信息(与舞台工具注册先例一致)。
5. If 动作声明的适用函数或参数构造函数在决策/构造过程中抛错, then the 系统 shall 隔离该动作(视为不适用或禁用)并记录诊断信息,画布与决策流程不中断。
6. The 动作注册表 shall 按 Canvas 实例隔离:不同实例的注册互不影响,注册可退订。
7. The 动作的适用函数与参数构造函数 shall 为不依赖外部可变状态的纯函数(同输入同输出),可独立单元测试。

### Requirement 2: 内置动作自举与决策行为守恒

**Objective:** As a pi-web 维护者, I want 六个内置生成动作以插件形式自举注册并复现现有决策链, so that 插件机制被内置场景全量验证且用户可感知行为零变化。

#### Acceptance Criteria

1. The 系统 shall 将扩图、局部重绘、参考图编辑、多变体、重构图、整图编辑六个内置动作以动作插件形式提供并在工作台默认注册。
2. When 给定任意决策输入组合, the 新动作决策器 shall 产出与迁移前 `decideGenerate` 相同的动作种类与参数内容(含优先级压制关系:扩图 > 局部重绘 > 参考图 > 多变体 > 重构图 > 整图编辑兜底)。
3. While 决策输入无任何特殊条件(无扩图、无掩码、无参考图、变体数不足、提示词非空或未指定尺寸), the 动作决策器 shall 兜底选择整图编辑动作。
4. When 工作台呈现生成按钮, the 按钮标签 shall 显示当前决策动作的标签,文案与迁移前一致。
5. When 内置动作经对话流通道执行, the 提交的提示词内容(标题行与参数围栏块) shall 与迁移前 `buildToolPrompt` 产出一致。
6. The 六个内置动作的适用函数与参数构造 shall 各自具备独立单元测试,覆盖全部决策分支与优先级压制关系。

### Requirement 3: 既有公开面兼容退役(零破坏)

**Objective:** As a 既有消费者(宿主转发层、示例、测试), I want `decideGenerate`/`buildToolPrompt` 等公开导出继续可用且语义不变, so that 既有代码与测试零改动。

#### Acceptance Criteria

1. The canvas-ui 包 shall 保留 `decideGenerate`、`buildSurfaceOp`、`buildToolPrompt` 及其关联类型的公开导出,行为与迁移前一致,并标注兼容一个大版本的退役说明。
2. The 宿主(packages/ui)转发层、examples、既有单元测试 shall 零改动保持通过。
3. When 相关包新增公开导出, the 包出口 shall 走显式清单纪律(禁全量转发),出口快照测试同步更新。

### Requirement 4: 能力清单 agent 权威下发

**Objective:** As a 使用 Canvas 的用户, I want 模型/尺寸/动作清单由 agent 侧权威下发, so that 界面呈现的选项与 agent 真实能力一致,不再出现选中网关不支持组合的失败。

#### Acceptance Criteria

1. The agent 侧 canvas surface 扩展 shall 在装配期确定性生成能力清单(可用模型、可用尺寸、支持的命令动作白名单)并作为 surface:canvas 快照的一部分下发,不新增帧种。
2. When 快照含能力清单, the 工作台与快捷设置 shall 以下发清单为准渲染模型与尺寸选项(同一来源消费)。
3. Where 下发清单为某模型声明了受支持尺寸集, the 工作台 shall 仅呈现该模型支持的尺寸选项。
4. If surface 不可用或快照缺失能力清单, then the 工作台 shall 退回内置默认清单,且命令通道动作全部不参与决策与呈现(仅对话流通道可用)。
5. The capability 动作白名单中无对应前端插件声明的动作 shall 不自动生成任何 UI 按钮,仅供已声明动作的适用函数判断避让。
6. When 用户在下发清单生效期间选择模型与尺寸, the 生成请求 shall 使用所选值且不被前端硬编码清单覆盖。
7. The 能力清单的下发、消费与退化路径 shall 具备单元/集成测试覆盖。

### Requirement 5: 状态快照刷新回放(粘性登记)

**Objective:** As a 用户, I want 刷新页面或短暂断线后画廊与能力清单仍然在场, so that 不因重连丢失已生成内容的视图。

#### Acceptance Criteria

1. When 浏览器刷新或流重连, the 服务端 shall 向新订阅者回放每个状态键的最新快照帧(含 surface:canvas)。
2. When agent 侧删除某状态键, the 服务端 shall 清理该键的回放登记,后续重连不再回放已删除键。
3. The 回放登记机制 shall 领域无关:服务端不解析快照内容,所有状态键一体受益。
4. When 用户在画廊有图的会话中刷新页面, the 画廊 shall 在重连后无需新一轮生成即恢复显示既有图片。

### Requirement 6: M1 留账收尾(类型精确化与禁用诊断可见)

**Objective:** As a canvas 插件作者与使用者, I want 手势事件坐标类型更精确、被禁用的工具能看懂原因, so that 开发期减少无谓判空、使用期理解工具不可用的缘由。

#### Acceptance Criteria

1. The canvas-kit shall 精确化手势事件自然坐标(natural)的类型表达,使坐标必然存在的相位/命中组合在类型层不再可空;既有内置工具行为零变化。
2. If 考古证实所有相位均无法保证坐标存在, then the 设计 shall 以档案化裁定关闭该留账并保持现类型不变。
3. When 某工具因注册冲突或回调抛错被禁用, the 工具轨 shall 在该工具项上以悬停提示呈现诊断原因。
4. While 工具无诊断信息, the 工具轨呈现 shall 与现状一致(不出现额外提示元素)。

### Requirement 7: 回归与验收线

**Objective:** As a pi-web 维护者, I want 全量回归与端到端证据, so that 插件化与清单下发不破坏既有行为。

#### Acceptance Criteria

1. The packages/ui、canvas-ui、canvas-kit、tool-kit 的既有单元测试 shall 零改动全绿(仅出口快照测试允许随新增导出联动更新)。
2. The canvas 相关 6 条浏览器 e2e shall 零改动全绿。
3. The workspace typecheck shall 全绿。
4. The 新增行为(动作决策全分支、六内置动作适用函数、能力下发/消费/退化、快照回放) shall 具备新增单元/集成测试并全绿。
5. When 本特性合入, the canvas-kit 内核内部模块 shall 仍不出现在包公开出口(封装静态断言保持通过)。
