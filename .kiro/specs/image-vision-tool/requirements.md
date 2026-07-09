# Requirements Document

## Introduction

pi-web 的 agent 目前**看不见已落库的图**。用户在聊天框上传的图片会被物化成图像内容直接送给主模型，
但一旦图片落库（AIGC 生成图、Canvas 图、工具产出图），它在对话上下文里只剩一个
`[attachment id=att_… type=… name=…]` 的文本标记 —— 模型读得到 id，读不到像素。
要让模型重新看一眼，用户只能重新上传。

本特性给 agent 一个显式的图像理解能力，两个入口共用一套行为：

- **`image_vision` 工具** —— 由 LLM 在推理中自主调用（"我需要看看那张图"）。
- **`/img_vision` 命令** —— 由用户主动触发（"帮我看看这张图里有什么"）。

识别请求会交给一个**支持图像输入的模型**处理，并把**文字结论**返回给发起方。
可用模型来自用户既有的模型配置：任何被配置为支持图像输入、且凭据可用的模型都自动成为候选，
无需为本特性单独维护模型清单。

## Boundary Context

- **In scope**：从附件引用解析图像；列举并选择可用的视觉模型；交互式选择与无 UI 降级；
  执行图像理解并返回文字结论；工具与命令两个入口；全链路 fail-soft。
- **Out of scope**：把图像字节内联回主模型上下文供其「亲自复看」；视觉相关的设置面板表单；
  图像**生成/编辑**能力（已由既有 AIGC 能力承担）；结构化输出（JSON schema 约束）与
  OCR / 目标检测预设。以上留待后续里程碑。
- **Adjacent expectations**：本特性**依赖**既有附件能力提供「按引用取回图像字节」与
  「列举当前会话内的附件」；**依赖**既有模型配置提供「哪些模型支持图像输入」及其凭据状态。
  本特性**不拥有**附件的存储、生命周期与签名分发，也**不修改**对话流协议与前端渲染行为。

---

## Requirements

### Requirement 1: 图像来源解析

**Objective:** As an agent，I want 通过附件引用或缺省规则定位一张图，so that 我无需用户重新上传就能指定要看的图像。

#### Acceptance Criteria

1. When 调用方提供了一个指向已落库图像的附件引用，the 视觉识别工具 shall 取回该图像的内容用于本次识别。
2. When 调用方省略了图像参数，the 视觉识别工具 shall 选取当前会话中最近的一张图像作为识别对象。
3. If 提供的附件引用不存在，then the 视觉识别工具 shall 返回失败结果并说明该引用无法解析。
4. If 提供的附件引用指向的不是图像内容，then the 视觉识别工具 shall 返回失败结果并说明该附件不是图像。
5. If 图像参数被省略且当前会话不含任何图像，then the 视觉识别工具 shall 返回失败结果并说明会话内没有可识别的图像。

### Requirement 2: 可用视觉模型清单

**Objective:** As a user，I want 候选模型自动来自我既有的模型配置，so that 我新增一个支持看图的模型后无需改动代码即可使用。

#### Acceptance Criteria

1. The 视觉识别工具 shall 仅将**支持图像输入**的模型列为候选。
2. The 视觉识别工具 shall 仅将**凭据可用**的模型列为候选，凭据不可用的模型不得出现在候选清单中。
3. Where 用户在模型配置中新增了一个支持图像输入的模型，the 视觉识别工具 shall 在下次调用时把它列入候选清单。
4. If 不存在任何满足条件的候选模型，then the 视觉识别工具 shall 返回失败结果并说明没有可用的视觉模型。

### Requirement 3: 交互式模型选择

**Objective:** As a user，I want 在每次识别时挑选用哪个模型看图，so that 我能按任务在质量与成本之间取舍。

#### Acceptance Criteria

1. While 交互式界面可用 and 调用未显式指定模型，when 识别被触发，the 视觉识别工具 shall 提示用户从候选清单中选择一个模型。
2. When 调用显式指定了模型，the 视觉识别工具 shall 直接使用该模型且不提示用户选择。
3. If 用户取消了模型选择，then the 视觉识别工具 shall 中止本次识别并返回表示「已取消」的失败结果。
4. If 调用显式指定的模型不在候选清单中，then the 视觉识别工具 shall 返回失败结果并说明该模型不可用。

### Requirement 4: 无交互界面时的降级

**Objective:** As an operator，I want 在无人值守场景下识别不被弹窗阻塞，so that 自动化流程不会挂起。

#### Acceptance Criteria

1. While 交互式界面不可用，when 识别被触发，the 视觉识别工具 shall 不等待用户输入。
2. While 交互式界面不可用 and 调用显式指定了模型，the 视觉识别工具 shall 使用该指定模型。
3. While 交互式界面不可用 and 调用未指定模型 and 已配置默认视觉模型，the 视觉识别工具 shall 使用该默认模型。
4. While 交互式界面不可用 and 调用未指定模型 and 未配置默认视觉模型，the 视觉识别工具 shall 使用候选清单中的第一个模型。
5. If 交互式界面不可用且候选清单为空，then the 视觉识别工具 shall 返回失败结果并说明没有可用的视觉模型。

### Requirement 5: 执行识别并返回结论

**Objective:** As an agent，I want 拿到一段关于图像的文字结论，so that 我能据此继续推理而不必把图像塞进上下文。

#### Acceptance Criteria

1. When 识别对象与模型均已确定，the 视觉识别工具 shall 使用所选模型，就调用方提出的问题对该图像产出文字结论。
2. When 识别成功，the 视觉识别工具 shall 把文字结论作为结果返回给发起方。
3. When 识别成功，the 视觉识别工具 shall 在结果中标明实际使用的模型。
4. The 视觉识别工具 shall 不把图像字节写入对话历史。
5. If 模型调用失败或超时，then the 视觉识别工具 shall 返回失败结果并说明失败原因。
6. When 调用方发出中止信号，the 视觉识别工具 shall 停止本次识别并返回表示「已中止」的失败结果。

### Requirement 6: 用户命令入口

**Objective:** As a user，I want 主动敲一个命令来看某张图，so that 我不必先说服 LLM 去调用工具。

#### Acceptance Criteria

1. Where 视觉识别能力被装载，the 系统 shall 提供一个用户可触发的 `/img_vision` 命令。
2. When 用户触发 `/img_vision`，the 视觉识别命令 shall 执行与 `image_vision` 工具一致的识别流程。
3. When 识别完成，the 视觉识别命令 shall 经交互式界面把结论呈现给用户。
4. The 视觉识别命令 shall 不依赖助手消息流来呈现结果。
5. The 视觉识别命令 shall 在模型选择、降级顺序与失败表现上与 `image_vision` 工具保持一致。

### Requirement 7: 容错与零回归

**Objective:** As a user，I want 识别功能出问题时不影响正在进行的对话，so that 一个可选能力不会拖垮整个会话。

#### Acceptance Criteria

1. If 识别过程中发生任何错误，then the 视觉识别工具 shall 返回结构化的失败结果而不是中断会话。
2. The 视觉识别工具 shall 在失败结果中携带可区分的失败原因，使调用方能分辨「无图」「无模型」「已取消」「已中止」「调用失败」。
3. The 系统 shall 在装载视觉识别能力后保持既有对话流行为不变。
4. Where 视觉识别能力未被装载，the 系统 shall 表现得与该能力不存在时完全一致。
