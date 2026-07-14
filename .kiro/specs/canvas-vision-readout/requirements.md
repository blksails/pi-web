# Requirements Document

## Introduction

Canvas 工作台里，用户正看着一张图，想问它一个问题——「这只猫戴的什么帽子」。今天他做不到：
底部提示词输入栏的生成按钮**只会生成图**（按掩码 / 引用 / 变体 / 比例的优先级决策），
输入栏没有任何方式表达「我要提问，不是要改图」。想问一句，只能切回聊天框、手抄那张图的附件 id。

本特性在提示词输入栏里，于生成按钮旁增加一个独立的**「解读」按钮**：把输入框里的文字当作问题，
对当前工作图发起一次视觉识别，结论回流到对话记录中（因此可回放、可追问）。

识别能力本身已经存在（由 spec `image-vision-tool` 提供，且已装载进 Canvas 示例 agent）。
本特性只做 Canvas 侧的**入口**与**模型偏好**，不新增识别能力。

## Boundary Context

- **In scope**：提示词栏的解读按钮；把输入框文字作为问题、当前工作图作为识别对象；
  解读请求经与生成动作相同的对话通道发出，结论回流对话记录；提示词栏内可选视觉模型的清单与偏好；有偏好时不再打断用户询问模型。
- **Out of scope**：画廊卡片上的悬浮解读入口；把结论持久化进画廊资产的元数据；多图批量解读；
  经 Canvas 命令通道（不过对话）实现的解读。识别能力本身（模型调用、凭据解析、失败分类）
  由 `image-vision-tool` 拥有，本特性不重复实现，也不修改。
- **Adjacent expectations**：
  - 本特性**依赖** `image-vision-tool` 已提供的行为：调用方显式指定模型时不再提示选择；
    未指定时提示用户从可用视觉模型中选择；识别失败时返回可区分的失败原因而不中断会话。
  - 本特性**依赖**生成动作既有的决策与参数簇行为，且**不得改变**它们。
  - Canvas 内的可选视觉模型清单**与识别能力自身选择提示中的候选同源**（都是「已配置凭据
    且支持图像输入」的模型集合）。两处不应出现差异。
  - 解读入口**要求所用 agent 已装载识别能力**。前端无从探知 agent 装载了哪些工具
    （能力清单只声明命令，不声明工具），因此本特性**不承诺**在未装载时给出前端提示；
    它只承诺 Canvas 示例 agent 已装载该能力（见 5.3）。自定义 agent 若未装载，
    表现为模型无法调用该工具——这属于 agent 装配责任，不属本特性。

---

## Requirements

### Requirement 1: 提示词栏的解读入口

**Objective:** As a Canvas 用户，I want 在提示词栏里直接对当前图提问，so that 我不必切回聊天框手抄附件 id。

#### Acceptance Criteria

1. The Canvas 工作台 shall 在提示词输入栏中提供一个与生成按钮并列的「解读」按钮。
2. When 用户点击「解读」按钮 and 输入框中有文字，the Canvas 工作台 shall 以该文字作为问题、以当前工作图作为识别对象发起一次视觉识别。
3. When 用户点击「解读」按钮 and 输入框为空，the Canvas 工作台 shall 以一个默认问题发起识别，而不是拒绝操作。
4. When 解读请求已发出，the Canvas 工作台 shall 保留输入框中的文字，与生成按钮的既有行为一致。

> 说明：工作台是「打开某张图之后」的界面，当前工作图恒存在，因此不存在「无图」分支。

### Requirement 2: 结论回流对话记录

**Objective:** As a Canvas 用户，I want 解读结论出现在对话记录里，so that 我能回看它、并就它继续追问。

#### Acceptance Criteria

1. When 用户发起解读，the 系统 shall 经与生成动作相同的对话通道发出该请求。
2. When 识别完成，the 系统 shall 把结论呈现在对话记录中，使其可回放。
3. When 结论已进入对话记录，the 系统 shall 允许用户在后续提问中引用它而无需重复提供图像。
4. The Canvas 工作台 shall 不在自身界面内另建一个与对话记录并行的结论展示区。

### Requirement 3: 视觉模型偏好

**Objective:** As a Canvas 用户，I want 在提示词栏里一次设定用哪个模型看图，so that 每次解读不必被打断询问。

#### Acceptance Criteria

1. When 用户展开提示词栏中的视觉模型选择器，the Canvas 工作台 shall 列出可选的视觉模型，且清单中仅包含已配置凭据且支持图像输入的模型。
2. When 用户在提示词栏中选定一个视觉模型，the Canvas 工作台 shall 记住该偏好，使其对后续解读生效。
3. While 已设定视觉模型偏好，when 用户发起解读，the 系统 shall 直接使用该模型且不提示用户选择。
4. While 未设定视觉模型偏好，when 用户发起解读，the 系统 shall 沿用识别能力自身的行为，提示用户从可用视觉模型中选择。
5. If 可选视觉模型清单为空，then the Canvas 工作台 shall 在选择器中说明没有可用的视觉模型，而不是显示一个空下拉。
6. If 获取可选视觉模型清单失败，then the 系统 shall 保持解读功能可用（退化为由识别能力自身提示选择），而不是禁用解读按钮。

### Requirement 4: 与生成动作互不干扰

**Objective:** As a Canvas 用户，I want 解读不改变我熟悉的生成行为，so that 现有的二创流程不被打乱。

#### Acceptance Criteria

1. When 用户点击生成按钮，the Canvas 工作台 shall 维持既有的生成动作决策行为不变。
2. The 解读入口 shall 不参与生成动作的优先级决策。
3. When 用户发起解读，the Canvas 工作台 shall 不消费掩码、参考图或标注等仅供生成使用的输入。
4. Where 用户已绘制掩码或添加参考图，when 用户点击「解读」按钮，the Canvas 工作台 shall 仍然只对当前工作图提问，且保留这些输入供后续生成使用。

### Requirement 5: 容错与零回归

**Objective:** As a Canvas 用户，I want 解读出问题时不影响画布与对话，so that 一个新入口不会拖垮工作台。

#### Acceptance Criteria

1. If 识别失败，then the 系统 shall 按识别能力既有的失败表现呈现原因，且不中断会话、不破坏画布状态。
2. The 系统 shall 在引入解读入口后保持 Canvas 既有的生成、二创与画廊行为不变。
3. The Canvas 示例 agent shall 装载识别能力，使解读入口在开箱即用的示例中可用。
4. Where 模型偏好尚未就绪或获取失败，the Canvas 工作台 shall 仍允许用户发起解读。
