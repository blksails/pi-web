# Requirements Document

## Introduction

AIGC 这类"伪命令"(`/img-gen <提示>`、`/img-edit <提示>`)本质是直接发给 LLM 的 prompt——已验证"原样发送 → 走正常对话回合"可让 LLM 据 system prompt 理解并调用对应工具,且工具卡/结果/历史/显示全部成立。但它们**不出现在输入补全里**,用户必须凭记忆手敲完整命令名。

本特性提供一个**通用命令输入补全**机制:候选由 **agent 运行时动态声明**(不同 agent 自带自己的伪命令候选),用户在输入框敲 `/` 时列出这些候选,**选中只把文本填入输入框、绝不执行**,随后走正常发送把原文交给 LLM。它复用现有输入补全 UI 框架(`@` 引文件那套),与"命令执行"(`PiCommandPalette`,服务 `/clear` `/plugin` 等执行型命令)严格解耦。AIGC 的 `/img-gen`(→`image_generation`)、`/img-edit`(→`image_edit`)作为端到端验证。

## Boundary Context

- **In scope**:agent 声明 slash 补全候选的能力与传递通道;通用命令补全 provider(`/` 触发、纯填入);补全候选的展示、过滤、选中填入;per-agent gating;`/` 与执行型命令面板的共存协调;`aigcExtension` 声明 `/img-gen` `/img-edit` 候选;单元 + e2e 测试。
- **Out of scope**:命令执行(`PiCommandPalette` 的执行通道不改、不替代);修改外部 pi SDK(`@earendil-works/*`,不可改);LLM 对伪命令的理解(由 system prompt 负责,已具备);真出图所需的 provider 密钥。
- **Adjacent expectations / 前提**:依赖一条 **agent→server 的声明传递通道**——agent(pi extension)须经**现有** pi SDK API 把候选声明 push 到 server。该通道的技术可行性是本特性成立的前提,须在设计阶段最先验证;若现有 pi SDK 无法承载,则需换通道或降级为静态候选(见 Requirement 7)。同时依赖 `detoolspec-unify-builtin-tools` 的 `aigcExtension`、现有补全框架与 UI、`createPiWebHandler` 的 `completionProviders` 注入点。

## Requirements

### Requirement 1: Agent 动态声明 slash 补全候选

**Objective:** As an agent author, I want agent(及其扩展)能在运行时声明一组 slash 命令补全候选, so that 不同 agent 自带各自的伪命令补全而无需改前端或 app。

#### Acceptance Criteria
1. The 补全系统 shall 允许 agent 声明零个或多个 slash 补全候选,每个候选至少含命令名与插入文本(`insertText`),可含描述。
2. When 某会话的 agent 声明了候选, the 补全系统 shall 仅在该会话提供这些候选(候选随会话/agent,不泄漏到其他会话)。
3. While agent 未声明任何候选, the 补全系统 shall 对该会话不提供任何此类命令候选(`/` 触发返回空)。

### Requirement 2: 输入补全展示

**Objective:** As an end user, I want 敲 `/` 时看到该 agent 的命令候选, so that 不必凭记忆手敲完整命令名。

#### Acceptance Criteria
1. When 用户在输入框行首键入 `/` 及可选前缀, the 补全系统 shall 在输入区列出匹配前缀的、该会话 agent 声明的候选(命令名 + 描述)。
2. The 补全展示 shall 复用现有输入补全 UI(浮层/键盘导航/防抖),不引入并行的新输入框组件。
3. When 没有匹配候选, the 补全系统 shall 不展示该来源的候选项(不报错、不阻塞输入)。

### Requirement 3: 选中只填入、不执行

**Objective:** As an end user, I want 选中候选后只把命令填进输入框, so that 我能补全提示词再发送,且命令按"普通消息"被 LLM 处理。

#### Acceptance Criteria
1. When 用户选中一个命令候选, the 补全系统 shall 仅把该候选的 `insertText`(如 `/img-gen `)填入输入框,并把光标置于其后。
2. When 用户选中候选, the 补全系统 shall **不**触发任何命令执行(不调用 host-command / extension execute / 任何 RPC 命令通道)。
3. When 用户补全参数后提交, the 系统 shall 把输入框原文作为普通消息发送(走既有发送路径),由 LLM 处理。

### Requirement 4: Per-agent gating

**Objective:** As a framework maintainer, I want 命令候选随 agent 声明出现, so that 没有对应能力的 agent 不会冒出无意义的命令。

#### Acceptance Criteria
1. Where agent 未声明 `/img-gen`, the 补全系统 shall 不在该会话出现 `/img-gen` 候选。
2. The 候选可见性 shall 由 agent 声明决定,而非全局静态硬编码。

### Requirement 5: 与执行型命令共存

**Objective:** As an end user, I want 真命令(`/clear` `/plugin` 等)继续正常工作, so that 输入补全不破坏既有命令执行。

#### Acceptance Criteria
1. The 伪命令输入补全 shall 不改变执行型命令(`/clear` `/plugin` `/sandbox` `/mcp` 等)经命令面板的执行行为。
2. When 用户键入 `/` 时同时存在执行型命令与声明的伪命令候选, the 系统 shall 以明确、可预期的方式呈现(伪命令补全归输入补全、执行型命令归命令面板),不产生重复或冲突的双浮层。
3. The 伪命令候选 shall 不进入命令执行通道(不被当作 extension/builtin 命令执行)。

### Requirement 6: AIGC 端到端验证

**Objective:** As a user of aigc-agent, I want `/img-gen` `/img-edit` 出现在补全且可用, so that AIGC 命令既好发现又走正常生成流程。

#### Acceptance Criteria
1. The `aigcExtension` shall 声明 `/img-gen`(对应 `image_generation`)与 `/img-edit`(对应 `image_edit`)两个补全候选。
2. When 用户敲 `/img-gen`、从补全选中、补全提示词后提交, the 系统 shall 把原文作为普通消息发送,LLM 据 system prompt 调用 `image_generation`,工具卡与结果按现有方式显示并持久化(刷新后历史可载入)。
3. The 改动 shall 不要求修改 `image_generation` / `image_edit` 工具本身或其结果形态。

### Requirement 7: 前提验证、降级与测试

**Objective:** As a framework maintainer, I want 方案前提被先行验证并有降级路径,且以新鲜证据验证, so that 不在不可行的通道上空耗、且行为可回归。

#### Acceptance Criteria
1. The 设计阶段 shall 最先验证"agent 经现有 pi SDK API 把候选声明 push 到 server"的可行性;若不可行,the 设计 shall 给出替代通道或降级为静态候选的方案,而非假定可行。
2. The 实现 shall 不修改外部 pi SDK(`@earendil-works/*`);若候选传递需要新增能力,只能在 pi-web 自有的协议/服务/前端层完成。
3. The 特性 shall 以单元/集成测试覆盖:候选声明→provider 返回、选中只填入不执行、per-agent gating、与执行型命令共存。
4. When 经补全选中 `/img-gen` 并提交(stub provider), the e2e shall 验证走正常消息流、LLM 调用工具、结果显示与历史载入,且以新鲜运行输出为证据。
