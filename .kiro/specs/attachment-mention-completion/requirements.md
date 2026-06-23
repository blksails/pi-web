# Requirements Document

## Introduction

本功能为「已上传/已有附件」提供基于触发符的 mention 补全能力。当前 attachment 系统只能通过上传按钮/拖放加入，并以 `attachmentIds` 数组随消息提交；用户无法在输入框里通过键入触发符来引用本会话中已经存在的附件。本功能复用现有 completion 框架（注册表 + 通用端点 + `PiWebHandlerOptions.completionProviders` 扩展点），新增一个 attachment provider，使用户在输入框键入触发符后即可补全并引用本会话已有附件；选中后插入一个可在提交期被解析的引用 token，提交时该 token 被解析为与现有附件引用注入一致的规范标记，从而让 agent 能够像对待新上传附件一样识别并使用被引用的附件。新 provider 与现有 file-provider 并存，互不干扰。

## Boundary Context

- **In scope**:
  - 列出当前会话已有的附件（来源含 `upload` 与 `tool-output`）作为补全候选
  - 通过触发符 `@`、令牌类型 `attachment`（token 形如 `@attachment:<id>`）发起补全，与 file-provider 在同一触发符下按类型分组并存
  - 按附件名做查询过滤/收敛
  - 候选项展示附件名与可区分的副信息（类型/大小），使用户能与文件候选区分
  - 选中后在输入框插入 attachment 引用 token
  - 提交期把 attachment 引用 token 解析为与现有 reference-injection 一致的规范引用标记，使 agent 可据此使用该附件
  - 严格按 `sessionId` 隔离，仅暴露当前会话的附件
- **Out of scope**:
  - 在用户消息气泡中把被 mention 的附件重新渲染为缩略图/图片预览（沿用既有上传附件的展示路径，不在本功能内新增气泡内联渲染）
  - 上传新附件、删除附件、跨会话检索附件
  - 候选浮层中渲染真实图像缩略图（候选以文本 label + detail 呈现；图像预览渲染为可选增强，不作为本功能的强制验收项）
- **Adjacent expectations**:
  - 依赖 `AttachmentStore.listBySession(sessionId)` 提供本会话附件描述符
  - 依赖现有 completion 框架的注册表、`triggers` 端点、`completion` 查询端点与提交期 resolve 流程
  - 解析后的引用标记格式须与现有 `attachment-bridge` 的 reference-injection 输出保持一致，以复用下游 agent/tool 识别逻辑
  - 不改变 file-provider 的既有行为与既有上传/提交（`attachmentIds`）流程

## Requirements

### Requirement 1: 附件候选发现与列举
**Objective:** 作为输入消息的用户，我希望在输入框里能看到本会话已有的附件作为补全候选，以便引用它们而无需重新上传。

#### Acceptance Criteria
1. When 用户在某会话的输入框键入触发符 `@` 并发起补全查询, the Attachment Mention Provider shall 返回该会话通过 `listBySession` 取得的已有附件作为补全候选。
2. The Attachment Mention Provider shall 仅包含 `origin` 为 `upload` 或 `tool-output` 的本会话附件，不包含其它会话的附件。
3. When 当前会话不存在任何附件, the Attachment Mention Provider shall 返回空候选集合而不报错。
4. While 补全查询正在进行, the Completion Service shall 将 attachment 候选归入类型为 `attachment` 的分组返回。

### Requirement 2: 触发符补全与多 provider 并存
**Objective:** 作为用户，我希望 attachment 补全与现有文件补全在同一触发符下并存且互不干扰，以获得一致直观的引用体验。

#### Acceptance Criteria
1. The Attachment Mention Provider shall 注册为触发符 `@`、令牌类型 `attachment` 的 completion provider。
2. When 用户以触发符 `@` 发起补全, the Completion Service shall 并发分发到所有匹配该触发符的 provider 并将结果按类型分组合并返回。
3. The Completion Service shall 在 `triggers` 端点继续暴露触发符 `@`，且其暴露行为不因新增 attachment provider 而退化。
4. The Attachment Mention Provider shall 不改变 file-provider 的候选、token 形态与解析行为。

### Requirement 3: 候选项展示与区分
**Objective:** 作为用户，我希望在补全浮层中能识别每个 attachment 候选并将其与文件候选区分开，以便选对目标。

#### Acceptance Criteria
1. The Attachment Mention Provider shall 为每个候选提供以附件名为内容的显示标签。
2. The Attachment Mention Provider shall 为每个候选提供包含可区分信息（如类型与大小）的副信息字段。
3. Where 候选属于类型 `attachment`, the Completion Service shall 在分组信息中标识该类型，使前端可与 `file` 分组分别呈现。

### Requirement 4: 查询过滤与结果收敛
**Objective:** 作为用户，我希望随着我输入更多字符，候选会按附件名收敛到更相关的结果，以便快速定位目标附件。

#### Acceptance Criteria
1. When 用户在触发符后输入查询字符串, the Attachment Mention Provider shall 按附件名对候选进行匹配过滤。
2. When 查询字符串为空, the Attachment Mention Provider shall 返回本会话的全部附件候选（受统一上限约束）。
3. The Completion Service shall 对合并后的候选应用框架统一的结果数量上限。

### Requirement 5: 选中与令牌插入
**Objective:** 作为用户，我希望选中某个 attachment 候选后输入框中插入一个可被后续解析的引用，以便提交时被正确识别。

#### Acceptance Criteria
1. When 用户选中一个 attachment 候选, the Completion UI shall 在输入框中以附件 id 插入形如 `@attachment:<id>` 的引用 token。
2. The Attachment Mention Provider shall 使插入的 token 符合框架的 `<触发符><类型>:<id>` 令牌文法，以便提交期被识别为 completion 引用而非普通文本。

### Requirement 6: 提交期解析为规范附件引用
**Objective:** 作为用户，我希望提交含有 attachment 引用 token 的消息后，被引用的附件能被 agent 正确识别和使用，效果与新上传的附件一致。

#### Acceptance Criteria
1. When 提交的消息文本包含 `@attachment:<id>` 引用 token, the Completion Service shall 按令牌类型 `attachment` 分发到 Attachment Mention Provider 进行提交期解析。
2. When Attachment Mention Provider 解析一个有效且属于当前会话的附件 id, the Attachment Mention Provider shall 将该 token 改写为与现有 reference-injection 一致的规范附件引用标记（含 id、类型、名称）。
3. If 引用的附件 id 不存在或不属于当前会话, then the Attachment Mention Provider shall 不阻断消息发送，并按框架降级策略保留原始 token 文本。
4. If 提交期解析过程发生错误, then the Completion Service shall 保留原始 token 文本并继续发送消息。

### Requirement 7: 会话隔离与安全
**Objective:** 作为用户，我希望补全与引用解析严格限定在当前会话范围内，以避免泄露或误引用其它会话的附件。

#### Acceptance Criteria
1. The Attachment Mention Provider shall 仅基于当前会话的 `sessionId` 列举与解析附件。
2. If 引用 token 指向不属于当前会话的附件 id, then the Attachment Mention Provider shall 拒绝将其解析为有效附件引用。
3. The Attachment Mention Provider shall 不在候选或解析结果中暴露其它会话附件的存在或元数据。

### Requirement 8: 端到端验证
**Objective:** 作为维护者，我希望该功能具备可重复的端到端验证，以确认从触发到引用的完整链路可用且不破坏既有补全行为。

#### Acceptance Criteria
1. The 端到端测试 shall 验证：当会话已有附件时，键入触发符 `@` 能在 `completion` 查询结果中返回类型为 `attachment` 的候选。
2. The 端到端测试 shall 验证：选中 attachment 候选后插入的 token 形如 `@attachment:<id>`。
3. The 端到端测试 shall 验证：提交包含该 token 的消息后，token 被解析为规范附件引用标记。
4. The 端到端测试 shall 验证：在同一触发符下 file-provider 的既有候选与解析行为不发生退化。
