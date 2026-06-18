# Requirements Document

## Introduction

当 pi agent 在一次对话回合中因 provider/流式错误失败时(例如 "Connection error."),Web UI 用户当前**看不到任何错误提示**:助手气泡为空、像"无话可说",用户无法判断是"模型没回应"还是"出错了",更看不到原因。根因在会话翻译层:承载真实错误的运行时事件(`message_end` 的 `stopReason:"error"`+`errorMessage`、`agent_end` 的 `willRetry`、`auto_retry_end` 的 `finalError`)要么被丢弃、要么被翻成正常结束,既有的错误翻译分支还用硬编码文案丢弃了真实 `errorMessage`。

本特性要把真实的 provider/流式错误在**重试耗尽或不可重试**时翻译为**用户可见的错误**(携带真实错误信息),并确保前端能呈现;同时在重试过程中给出可感知的反馈,且不把用户主动中止误报为错误。受众是 Web UI 的对话用户与排障者。

## Boundary Context

- **In scope**:
  - 会话翻译层(pi 运行时事件 → 前端消息流)对**错误类事件**的翻译:把终态 provider/流式错误映射为用户可见错误并携带真实错误信息。
  - 重试过程中的用户可感知反馈,以及"重试耗尽/不可重试"与"重试中"的区分。
  - 确保前端在收到终态错误时呈现用户可见的错误(而非空助手气泡)。
  - 上述行为的单元/集成测试。
- **Out of scope**:
  - 修改 pi SDK 本身、重试策略、provider 选择或鉴权/网络配置。
  - 错误文案的多语言本地化、错误分类学(taxonomy)细分。
  - 重新设计通知/toast 系统或聊天布局。
  - 工具执行错误(tool 输出错误)既有呈现路径的改动。
- **Adjacent expectations**:
  - 依赖 pi 运行时事件已携带的错误信息字段(`errorMessage` / `stopReason` / `willRetry` / `finalError`)。
  - 依赖前端既有的错误/呈现面(助手消息错误呈现、会话错误快照或通知面之一),不新增独立错误中心。

## Requirements

### Requirement 1: 终态错误对用户可见

**Objective:** 作为 Web UI 对话用户,我希望当一次对话回合最终失败时能看到明确的错误提示,以便我知道"是出错了而不是模型没回应"。

#### Acceptance Criteria
1. When 一次对话回合因 provider/流式错误失败且不会再重试(重试耗尽或不可重试), the 会话翻译层 shall 产出一个用户可见的错误信号(而非正常结束)。
2. When 终态错误被产出, the Web UI shall 向用户呈现一个可见的错误提示(而非仅空白助手气泡)。
3. While 一次对话回合最终失败, the Web UI shall 不把该回合呈现为"已正常完成"。
4. The 会话翻译层 shall 在助手消息已开始流式输出后又发生终态错误时,仍产出用户可见的错误信号并妥善收尾该消息(不残留半开状态)。

### Requirement 2: 保留真实错误信息

**Objective:** 作为排障者,我希望错误提示包含来自运行时的真实错误信息,以便我能据此定位原因(如连接失败、鉴权失败)。

#### Acceptance Criteria
1. When 终态错误被产出, the 会话翻译层 shall 在错误信号中携带来自运行时事件的真实错误信息(如 `errorMessage` / `finalError`)。
2. If 运行时事件未提供具体错误信息, then the 会话翻译层 shall 使用一个明确的回退文案,且该回退仅在确无真实信息时使用。
3. The 会话翻译层 shall 不使用恒定的硬编码文案覆盖或丢弃运行时提供的真实错误信息。
4. When 错误信息呈现给用户, the Web UI shall 展示该真实错误信息(在所选呈现面内,允许必要的截断但不得替换为无意义占位)。

### Requirement 3: 重试过程的用户反馈

**Objective:** 作为对话用户,我希望在系统自动重试时能感知"正在重试",以便我理解为何尚无最终结果。

#### Acceptance Criteria
1. While 系统正在对失败回合自动重试, the Web UI shall 向用户给出"正在重试"的可感知反馈。
2. When 自动重试最终成功, the 会话翻译层 shall 不产出终态错误信号,且正常呈现成功结果。
3. The 会话翻译层 shall 把"重试中的瞬时失败"与"重试耗尽/不可重试的终态错误"区分对待,仅后者触发 Requirement 1 的终态错误。

### Requirement 4: 区分用户中止与错误

**Objective:** 作为对话用户,我希望我主动中止(停止)对话不会被当成错误提示,以便中止与真实故障在体验上清晰可辨。

#### Acceptance Criteria
1. When 用户主动中止了一次对话回合, the 会话翻译层 shall 将其翻译为"已中止",而非终态错误信号。
2. While 一次回合被用户中止, the Web UI shall 不向用户呈现错误提示。
3. The 会话翻译层 shall 保持中止语义与错误语义在产出信号上彼此独立、不混淆。

### Requirement 5: 兼容与回归

**Objective:** 作为维护者,我希望错误呈现的改动不破坏既有的正常对话与事件翻译,以便现有功能与测试保持稳定。

#### Acceptance Criteria
1. While 一次对话回合正常成功, the 会话翻译层 shall 维持既有的成功结束翻译行为不变(不产出错误信号)。
2. The 会话翻译层 shall 保持除错误类事件外的其它事件(文本/思考/工具/步骤边界/队列/压缩等)的翻译行为不变。
3. The 本特性 shall 附带可运行的单元/集成测试,覆盖:终态错误产出用户可见错误并携带真实信息、重试中反馈、重试成功不报错、用户中止不报错、正常成功不报错。
4. The 测试 shall 以新鲜运行证据(实际运行输出)证明上述行为通过。
