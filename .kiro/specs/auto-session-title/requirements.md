# Requirements Document

## Introduction

本特性在 `@blksails/pi-web-tool-kit` 提供一个**自动会话标题扩展**：作为强制注入每个会话的 pi 扩展，在 agent 完成应答时根据会话内容自动生成一个简短标题，并经已预埋的 `ctx.ui.setTitle → ambient.title` 链路展示在 Web 聊天界面上。用户无需手动命名会话，即可获得可辨识的标题；运营方可通过一组环境变量控制开关、触发模式（首轮一次 / 多轮更新）、生成策略与标题长度。

**调研已确认（pi SDK 0.79.6）**：标题展示链路端到端预埋（`extension_ui_request{method:"setTitle"}` → `ambient.title` → PiChat 渲染），本特性**零协议、零前端改动**；注入机制复用现有「扩展管理扩展」(`extension-install-agent-tools`) 的 `forcedExtensionPaths` + spawn env 模板；`pi.on("agent_end")`、`ctx.ui.setTitle`、`ctx.model` + pi-ai `completeSimple` 均可用。

## Boundary Context

- **In scope**：
  - 一个强制注入的 pi 扩展，在 `agent_end` 时生成并设置会话标题。
  - 两种触发模式：`once`（首轮总结一次）与 `refresh`（每轮更新）。
  - 两种生成策略：LLM 总结（默认）与启发式兜底（取首条用户消息截断）。
  - 一组 `PI_WEB_AUTO_TITLE_*` 环境变量用于开关与调参；总开关默认开启、模式默认 `once`。
  - 失败容错：任何生成失败都不得阻塞或中断会话。
  - **标题持久化为会话名**：经 `ctx.ui.setTitle` 设置的标题在 pi-web 一侧同时持久化为会话名，使其出现在「会话历史」列表并在冷恢复后保留（增量需求，见 Requirement 8）。
- **Out of scope**：
  - 不改动标题展示链路（协议 `setTitle`、react control-store、PiChat 渲染均已存在，按现状复用）。
  - 不提供用户手动改名 UI、跨会话标题历史等能力。
  - 不引入新的前端组件或新的 RPC 方法。
  - 不改动会话存储（session-store）的写接口与镜像机制，仅复用既有 `appendSessionInfo` → 镜像 → store 的链路。
- **Adjacent expectations**：
  - 依赖 pi SDK 提供 `agent_end` 事件、`ctx.ui.setTitle`、`ctx.model`；依赖主进程（pi-handler）与 runner（option-mapper）按既有 `forcedExtensionPaths` 约定注入扩展入口。
  - 标题一旦经 `ctx.ui.setTitle` 发出，其展示与生命周期由现有 ambient.title 链路负责，本特性不承担其渲染正确性。

## Requirements

### Requirement 1: 自动生成并设置会话标题

**Objective:** As a Web 聊天用户, I want 会话在 agent 完成应答后自动获得一个简短标题, so that 我无需手动命名即可辨识会话。

#### Acceptance Criteria

1. When agent 完成一轮应答（`agent_end` 事件触发）, the 自动标题扩展 shall 基于当前会话消息生成一个标题并经 `ctx.ui.setTitle` 设置。
2. When 标题被设置, the 自动标题扩展 shall 仅经 `ctx.ui.setTitle` 这一既有接口发出，不引入新的协议方法或前端组件。
3. If 当前会话尚无任何用户消息（无可总结内容）, then the 自动标题扩展 shall 跳过本次生成且不设置空标题。
4. The 自动标题扩展 shall 在标题中仅包含可读文本，不含换行、控制字符或工具调用原始负载。

### Requirement 2: 触发模式（once / refresh）

**Objective:** As a 运营方, I want 选择标题只在首轮生成一次还是随对话持续更新, so that 我可在「稳定省 token」与「标题跟随对话演进」之间权衡。

#### Acceptance Criteria

1. While 模式为 `once`, when 首个 `agent_end` 成功生成并设置标题, the 自动标题扩展 shall 在该会话后续 `agent_end` 不再重新生成或覆盖标题。
2. While 模式为 `once`, if 首轮标题生成失败, then the 自动标题扩展 shall 允许在后续 `agent_end` 重试，直至成功设置一次。
3. While 模式为 `refresh`, when 每个 `agent_end` 触发, the 自动标题扩展 shall 重新生成并更新标题。
4. Where 未显式配置模式, the 自动标题扩展 shall 采用 `once` 作为默认模式。

### Requirement 3: 生成策略（LLM 优先 + 启发式兜底）

**Objective:** As a 运营方, I want 优先用 LLM 产出高质量标题、并在不可用时有确定性兜底, so that 标题质量与可用性兼得。

#### Acceptance Criteria

1. While 策略为 `llm`, when 生成标题, the 自动标题扩展 shall 调用模型对会话内容做一次性总结以产出标题。
2. While 策略为 `llm`, if 模型不可用、调用失败或返回空结果, then the 自动标题扩展 shall 回退到启发式方式（取首条用户消息文本并按长度上限截断）生成标题。
3. While 策略为 `heuristic`, when 生成标题, the 自动标题扩展 shall 仅用启发式方式生成而不调用模型。
4. Where 未显式配置策略, the 自动标题扩展 shall 采用 `llm`（带启发式兜底）作为默认策略。
5. Where 配置了专用的总结模型, the 自动标题扩展 shall 使用该模型；否则 shall 使用会话当前模型（`ctx.model`）。

### Requirement 4: 标题长度约束

**Objective:** As a Web 聊天用户, I want 标题保持简短, so that 它能在界面标题区域完整展示而不溢出。

#### Acceptance Criteria

1. When 生成的标题超过配置的字数上限, the 自动标题扩展 shall 将其截断至上限以内。
2. Where 未显式配置字数上限, the 自动标题扩展 shall 采用约 24 字作为默认上限。
3. When 截断标题, the 自动标题扩展 shall 不在单词或字符中间留下半个字符（按字符边界截断），并去除首尾空白。

### Requirement 5: 总开关与强制注入门控

**Objective:** As a 运营方, I want 用一个总开关启用或停用自动标题, so that 我可在生产环境按需开启而无需修改用户 agent 代码。

#### Acceptance Criteria

1. While 总开关开启, the pi-web 主进程 shall 解析自动标题扩展入口路径并经 spawn env 下发给 agent 子进程，使其作为强制注入扩展对每个会话生效。
2. While 总开关关闭, the pi-web 主进程 shall 不下发自动标题扩展入口，从而该扩展不注入、不生成标题。
3. Where 未显式配置总开关, the pi-web 主进程 shall 视为开启（默认开）。
4. If 自动标题扩展入口路径无法解析（异常布局）, then the pi-web 主进程 shall 跳过注入且不阻塞会话创建。
5. When 收到下发的扩展入口环境变量, the runner shall 将该路径加入 `forcedExtensionPaths`，使扩展豁免用户 agent 的扩展白名单声明。

### Requirement 6: 可配置参数

**Objective:** As a 运营方, I want 通过环境变量调整自动标题的行为, so that 我能在不改代码的前提下适配不同部署。

#### Acceptance Criteria

1. The 自动标题扩展 shall 支持经 `PI_WEB_AUTO_TITLE_MODE` 配置触发模式（`once` / `refresh`）。
2. The 自动标题扩展 shall 支持经 `PI_WEB_AUTO_TITLE_STRATEGY` 配置生成策略（`llm` / `heuristic`）。
3. The 自动标题扩展 shall 支持经 `PI_WEB_AUTO_TITLE_MODEL` 配置总结所用模型。
4. The 自动标题扩展 shall 支持经 `PI_WEB_AUTO_TITLE_MAX_LEN` 配置标题字数上限。
5. The pi-web 主进程 shall 支持经 `PI_WEB_AUTO_TITLE` 配置总开关（默认开）。
6. If 某配置项缺失或取值非法, then the 自动标题扩展 shall 回退到该项的默认值且不抛错。

### Requirement 7: 失败容错，不阻塞会话

**Objective:** As a Web 聊天用户, I want 自动标题永远不打断我的对话, so that 标题功能的任何异常都不影响正常使用。

#### Acceptance Criteria

1. If 标题生成过程中发生任何异常（模型错误、超时、解析失败等）, then the 自动标题扩展 shall 捕获该异常并放弃本次标题设置，不向用户暴露错误、不中断会话。
2. While 标题正在异步生成, the 自动标题扩展 shall 不阻塞 `agent_end` 后续流程或下一轮用户输入。
3. The 自动标题扩展 shall 在缺少模型、缺少消息或配置异常等任一前置条件不满足时静默跳过，而非报错。

### Requirement 8: 标题持久化为会话名（出现在会话历史）

**Objective:** As a Web 聊天用户, I want 自动生成的标题成为会话历史列表里的会话名并在重开后仍在, so that 我能在历史中按内容辨识并找回会话，而不是看一串会话 ID。

#### Acceptance Criteria

1. When 经 `ctx.ui.setTitle` 设置标题, the pi-web runner shall 在可写会话管理器上持久化该标题为会话名（`appendSessionInfo`），使其经既有镜像链路落入会话存储。
2. When 标题被持久化为会话名, the pi-web runner shall 仍保留原有的标题展示行为（继续发出 setTitle 帧驱动 `ambient.title`），二者并存互不替代。
3. While 模式为 `refresh`, when 每次 `setTitle` 触发, the pi-web runner shall 每次都更新会话名（追加式，最新生效）。
4. When 用户在会话历史列表查看一个已设置过标题的会话, the 会话历史 shall 显示该标题而非会话 ID。
5. When 会话经冷恢复（重开/刷新 URL）重新载入, the 会话历史 shall 仍显示此前持久化的会话名。
6. If 持久化会话名过程中发生任何异常, then the pi-web runner shall 捕获该异常并放弃本次持久化，不影响标题展示、不中断会话。
