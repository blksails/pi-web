# Requirements Document

## Introduction

本特性为 pi-web 的 agent 作者提供一套「结构化提问」能力，对齐 Claude Code 的 AskUserQuestion 体验：当 agent 在多个合理方案之间无法从上下文推断用户意图时，可一次性向最终用户抛出 1–4 个问题，每题带一个短标签（header）、完整问题（question）、2–4 个**带描述副文本**的互斥/可多选选项，并可选地允许用户自由输入（Other）。用户在对话流内的一张富卡片上作答后，答案以结构化形式回到模型，供其继续推进。

关键约束是**零协议改动**：现有 `extension_ui_request` / `extension_ui_response` 协议帧不新增字段、不升 `protocolVersion`。能力经「约定式富载荷」实现——工具端把问题组编码进既有 `select` 请求的可承载字段，前端识别约定标记后渲染富卡片，作答经既有 `select` 应答字段回传。无法识别该约定的旧前端必须优雅降级为原生单选，仍可完成一次应答，绝不卡死会话。

## Boundary Context

- **In scope（用户/作者可观察）**:
  - agent 作者可用的富提问工具（发起 1–4 题、每题 2–4 个带描述选项、单选/多选、可选 Other 自由输入）。
  - 前端在对话流末尾内联渲染的富问答卡片（多题、单选 radio / 多选 checkbox、选项描述副文本、Other 输入框、提交/取消）。
  - 作答结果以结构化形式返回给模型（每题问题 → 选中项集合）。
  - 旧前端（不认约定标记）遇到该请求时的优雅降级行为。
  - 可复用的编码/解码约定，及其单测、stub 驱动的离线 e2e、示例 agent 作为交付物。
- **Out of scope**:
  - 修改 pi SDK 的 `ctx.ui`（新增 method 或改签名）。
  - 新增或修改 `extension_ui_request` / `extension_ui_response` 协议帧字段，或提升 `protocolVersion`。
  - 复活已废弃的 `ctx.ui.custom` 富交互桥。
  - ambient 类交互（notify / setStatus / setWidget 等）的任何改动。
- **Adjacent expectations**:
  - 依赖现有 extension UI 子协议链路（`extension_ui_request` 旁路 → SSE control 帧 → `/ui-response` 回传）保持现状可用。
  - 依赖前端既有 `PiInteraction` 内联交互卡片作为承载点；现有 select/confirm/input/editor 四类交互行为不得回归。

## Requirements

### Requirement 1: 富问题组发起（工具端）
**Objective:** 作为 pi-web 的 agent 作者，我希望有一个能一次性抛出多道带选项描述的结构化问题的工具，以便在方案决策场景让最终用户明确选择，而不是让模型自行臆测。

#### Acceptance Criteria
1. The AskUserQuestion 工具 shall 接受一个包含 1 至 4 个问题的问题组，每个问题包含一个短标签 header、一个完整问题文本 question、一个 2 至 4 项的选项列表、以及一个是否允许多选的标志 multiSelect。
2. The AskUserQuestion 工具 shall 要求每个选项同时提供一个简短标签 label 与一段说明其含义或代价的描述 description。
3. When 问题组中某题的 multiSelect 为真, the AskUserQuestion 工具 shall 允许该题的最终作答包含零个、一个或多个选中项。
4. Where 某题声明允许自由输入（Other）, the AskUserQuestion 工具 shall 使该题的最终作答可以是一段用户自定义文本而非预置选项。
5. If 问题组为空、题数超过 4、或任一题的选项数不在 2 至 4 之间, then the AskUserQuestion 工具 shall 拒绝该次调用并返回一条指明约束的错误结果，而不发起任何用户交互。

### Requirement 2: 富问答卡片渲染（前端）
**Objective:** 作为最终用户，我希望在对话流内看到一张可读的富问答卡片（含问题、选项及每个选项的说明），以便一次看清全部问题并作出明确选择。

#### Acceptance Criteria
1. When 前端收到一个携带富问题组约定标记的交互请求, the 富问答卡片 shall 解析出结构化问题组并在对话流末尾内联渲染，而非以纯字符串单选列表呈现。
2. The 富问答卡片 shall 为每个问题显示其 header 与 question，并为每个选项同时显示其 label 与 description。
3. While 某题的 multiSelect 为假, the 富问答卡片 shall 以单选控件（同题选项互斥）呈现该题选项。
4. While 某题的 multiSelect 为真, the 富问答卡片 shall 以多选控件呈现该题选项，允许用户选中任意数量（含零个）选项。
5. Where 某题允许自由输入（Other）, the 富问答卡片 shall 提供一个文本输入入口，供用户提交预置选项之外的自定义答案。
6. If 富问题组包含多道问题, then the 富问答卡片 shall 在同一张卡片内使用各题 header 作为 Tabs，一次展示当前题，并在切换时保留各题作答状态，允许用户逐题作答后一次性提交。
7. While 富问题组包含多道问题, the 富问答卡片 shall 在首题显示“下一步”、在中间题显示“上一步”和“下一步”、在末题显示“上一步”和“提交答案”，且仅末题的提交动作回传整组答案。

### Requirement 3: 作答回传与结构化结果
**Objective:** 作为 agent 作者，我希望用户的作答以「问题 → 选中项」的结构化形式回到模型，以便工具逻辑无需解析自由文本即可据此推进。

#### Acceptance Criteria
1. When 用户在富问答卡片上提交作答, the 富问答卡片 shall 经既有 extension UI 应答链路回传一份可被工具端还原为「每题问题 → 选中标签集合（及可能的自由输入文本）」的结果。
2. When 工具端收到回传的作答, the AskUserQuestion 工具 shall 将其还原为结构化结果并作为工具执行结果返回给模型。
3. If 用户在富问答卡片上选择取消, then the AskUserQuestion 工具 shall 返回一个明确表示「用户已取消」的结果，且不包含任何臆造的选项答案。
4. While 一次作答尚未提交, the 富问答卡片 shall 阻塞该工具调用的继续执行，直到收到用户的提交或取消。

### Requirement 4: 旧前端优雅降级
**Objective:** 作为运维者/集成方，我希望尚未升级到本特性的旧前端在遇到富问题组时仍能完成一次作答，以便升级过程不会卡死任何在用会话。

#### Acceptance Criteria
1. When 一个不识别富问题组约定标记的前端收到该交互请求, the 该前端 shall 仍以原生单选交互呈现该请求并允许用户完成一次应答，而不使会话卡死。
2. When 旧前端以原生单选方式应答, the AskUserQuestion 工具 shall 能将该应答识别为「未获得富作答」的降级情形并返回一个可被模型理解的结果，而不抛出未捕获错误。
3. The 富问答卡片 shall 仅对携带约定标记的请求启用富渲染分支，对不携带该标记的既有 select / confirm / input / editor 请求保持原有渲染与行为不变。

### Requirement 5: 零协议改动与依赖边界
**Objective:** 作为 pi-web 维护者，我希望本特性不触碰协议契约与 pi SDK，以便避免连锁的版本升级与跨仓协调成本。

#### Acceptance Criteria
1. The AskUserQuestion 特性 shall 不新增或修改 `extension_ui_request` / `extension_ui_response` 协议帧的字段，也不提升 `protocolVersion`。
2. The AskUserQuestion 特性 shall 不修改 pi SDK 的 `ctx.ui` 接口（不新增 method、不改签名），仅复用其既有 `select` 请求/应答字段承载富载荷。
3. The AskUserQuestion 特性 shall 不复活或引入 `ctx.ui.custom` 富交互桥。
4. The AskUserQuestion 特性 shall 不改变 ambient 类交互（notify / setStatus / setWidget / setTitle 等）的既有行为。

### Requirement 6: 交付物与可验证性
**Objective:** 作为团队，我希望本特性附带可复用的编解码约定、自动化测试与可运行示例，以便能以新鲜证据证明端到端闭环成立并供后续 agent 作者参照。

#### Acceptance Criteria
1. The AskUserQuestion 特性 shall 提供一份工具端与前端共享的编码/解码约定，使二者对富载荷标记与结构的理解保持单一权威、不各自硬编码。
2. The AskUserQuestion 特性 shall 提供覆盖富卡片渲染（单选、多选、选项描述、Other 输入、提交/取消）的前端单元测试。
3. The AskUserQuestion 特性 shall 提供一个 stub 驱动、无 LLM 成本的 node 级 e2e，证明「工具发起富问题组 → 富作答回传 → 工具续跑得到结构化结果」的完整闭环（参照现有 `extension_ui` select 闭环 e2e 的驱动方式）。
4. The AskUserQuestion 特性 shall 提供一个可运行的示例 agent，演示以本工具发起结构化提问并据用户作答推进。
