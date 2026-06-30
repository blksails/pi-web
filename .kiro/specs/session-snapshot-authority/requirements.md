# Requirements Document

## Introduction

pi-web 当前的会话状态被劈成两半、无人同时拥有：前端 `useChat`（AI SDK 黑盒）按不透明的 `status` 时序推断 `busy`、`stats` 走 REST + SSE 双源 merge、协议 `type` 字符串散在 5 处无对齐导致孤儿渲染器。正确性在这些缝里运行时涌现，唯一可信裁判是 Chrome 人眼，导致每次改动都要反复试错复检。

本特性把会话状态收口为「**服务端唯一权威 `SessionSnapshot`（粘性可重放）+ 前端纯投影 + 闭合协议契约**」，使正确性塌缩成两个可单测的纯函数 —— `reduce(agent 事件序列) → SessionSnapshot` 与 `project(snapshot) → DOM`，从而把验证从「运行时跨两半涌现、只能 Chrome 复检」变为「单测可判定」。

本特性面向 pi-web 框架开发者；其「用户可观测行为」即框架对外的帧契约、REST/组件状态语义与开发期类型/测试保障。

## Boundary Context

- **In scope**：会话状态的权威来源与广播（lifecycle/busy/turn/stats/model/title）、晚订阅的状态收敛、前端对该权威状态的纯投影、协议产出物（data part）类型的单一真相源与契约保障、以及覆盖上述的离线/浏览器 e2e。
- **Out of scope**：`useChat` 内部消息累积逻辑（继续由 AI SDK 拥有，仅消费其 `messages`）；新增任何会话业务能力（fork、附件、AIGC 等）；既有 `session-readiness-handshake` 的就绪握手语义（本特性在其上泛化，不改其判定锚点）。
- **Adjacent expectations**：依赖既有 `session-engine`（RPC 通道、事件翻译）、`protocol-contract`（帧 schema）、`session-readiness-handshake`（粘性 lifecycle 帧、就绪锚点）。本特性期望它们提供的事件源与帧 schema 保持稳定；新增的 `session-state` control 帧对未升级的旧消费者必须可安全忽略。

## Requirements

### Requirement 1: 服务端权威会话快照

**Objective:** 作为 pi-web 框架开发者，我希望服务端持有并对外暴露单一权威的会话状态，以便所有消费者读到同一份真相、不再各自重建。

#### Acceptance Criteria
1. The Session Engine shall 维护单一权威会话状态 `SessionSnapshot`，至少覆盖 `lifecycle`、`busy`、`turn`、`stats`、`model`、`title` 六个字段。
2. When 上述任一权威字段发生变更，the Session Engine shall 广播一个 `control:"session-state"` 帧，其载荷为变更后的完整快照。
3. While 会话存活，the Session Engine shall 保证「最近一次广播的快照」与「服务端当前权威状态」一致（不存在已变更但未广播的字段）。
4. The Session Engine shall 允许在不发起额外 RPC 往返的前提下同步读取当前权威快照。
5. If 某权威字段尚无确定值，the Session Engine shall 在快照中以「未知/缺省」表示，而非编造默认值。

### Requirement 2: busy 权威化（扩展命令不卡死）

**Objective:** 作为 pi-web 框架开发者，我希望「忙碌」是服务端权威字段而非时序推断，以便扩展命令等不发结束事件的路径不再永久卡 busy。

#### Acceptance Criteria
1. When 一个 agent 轮次开始，the Session Engine shall 将权威快照的 `busy` 置为 `true`。
2. When 一个 agent 轮次以任意方式结束（正常结束、中止、错误、或本地扩展命令执行完成），the Session Engine shall 将权威快照的 `busy` 置为 `false`。
3. If 一次交互由本地扩展命令（不产生 `agent_end` 事件）驱动，the Session Engine shall 仍在该命令完成时将 `busy` 置为 `false`，使会话不进入永久忙碌。
4. The Session Engine shall 不依赖「是否收到某结束事件」的缺席来推断 `busy`。

### Requirement 3: stats 单一权威来源

**Objective:** 作为 pi-web 框架开发者，我希望会话用量统计来自单一权威来源，以便前端不再双源 merge 与轮询。

#### Acceptance Criteria
1. When 会话用量统计更新，the Session Engine shall 通过权威快照（`session-state` 帧的 `stats` 字段）对外暴露最新值。
2. The Web Client shall 仅从权威快照派生展示用的 `stats`，不再合并独立的 REST 来源。
3. While 一个轮次进行中或结束后，the Web Client shall 不依赖定时轮询来获取最新 `stats`。
4. Where 仍需 REST 端点读取 `stats`（如首屏冷启动），the Session Engine shall 保证其返回值与权威快照语义一致、不产生第二真相。

### Requirement 4: 泛化的粘性回放（晚订阅收敛）

**Objective:** 作为 pi-web 框架开发者，我希望「晚订阅者自动收敛到最新状态」是传输层的通用性质，以便不必为每种状态各写一份回放与防御。

#### Acceptance Criteria
1. When 一个客户端在状态已变更之后才订阅，the Session Engine shall 向该晚订阅者重放当前权威状态（至少含 `session-state`、`lifecycle`、`logs`），使其收敛到最新值。
2. The Session Engine shall 通过统一的粘性帧注册机制管理可重放状态，新增一种可重放状态时仅需注册其键，而无需修改订阅流程的核心代码。
3. While 多个客户端先后订阅同一会话，the Session Engine shall 保证每个订阅者最终都收到一致的当前权威状态。
4. If 同一可重放键被多次写入，the Session Engine shall 仅保留并重放其最新值。

### Requirement 5: 前端纯投影

**Objective:** 作为 pi-web 框架开发者，我希望前端是服务端权威快照的纯投影，以便去除前端的时序推断与多源拼装。

#### Acceptance Criteria
1. The Web Client shall 以一个权威投影持有完整 `SessionSnapshot`，作为 `busy`/`ready`/`stats` 等派生状态的唯一来源。
2. The Web Client shall 从权威快照派生 `isBusy`、`stats`、`ready`、`canSubmit`，不再从消息流的 `status` 时序推断这些状态。
3. The Web Client shall 继续仅使用 `useChat` 提供的 `messages` 进行对话内容渲染，不再以其 `status` 参与业务判断。
4. When 权威快照更新，the Web Client shall 在不重新拉取 REST 的前提下，将派生状态刷新为投影后的值。

### Requirement 6: 闭合的协议契约（无孤儿渲染器）

**Objective:** 作为 pi-web 框架开发者，我希望协议产出物类型有单一真相源并被类型与测试强制对齐，以便新增类型时不可能产生孤儿渲染器。

#### Acceptance Criteria
1. The Protocol Contract shall 以单一真相源登记所有 data part 类型（kind），每个 kind 关联其校验 schema 与服务端事件映射。
2. The Protocol Contract shall 将 kind 暴露为受检类型（拼写错误在编译期即报错），消除散落的字符串字面量。
3. The Session Engine shall 基于该单一真相源进行事件→帧的翻译，确保不会漏翻译任一已登记 kind。
4. The Web Client shall 基于该单一真相源注册渲染器，确保不会漏注册任一已登记 kind。
5. The Test Suite shall 提供一条契约测试，遍历单一真相源断言每个 kind 均存在「服务端映射 + 前端渲染器」，使孤儿渲染器在测试层不可能通过。

### Requirement 7: 正确性可单测 + e2e 覆盖

**Objective:** 作为 pi-web 框架开发者，我希望会话正确性能由纯函数单测与离线/浏览器 e2e 判定，以便不再依赖 Chrome 人眼复检整条管线。

#### Acceptance Criteria
1. The Reducer shall 是一个纯函数：给定相同的 agent 事件序列，产出相同的 `SessionSnapshot`，可被单元测试断言。
2. The Projection shall 是一个纯函数：给定相同的 `SessionSnapshot`，产出相同的可观测 UI 派生状态，可被组件单元测试断言。
3. The Test Suite shall 提供离线 e2e（复用 `PI_WEB_STUB_AGENT=1`），覆盖：扩展命令后 `busy` 回落为 false、`stats` 单源粘性、晚订阅回放收敛。
4. The Test Suite shall 提供浏览器 e2e（复用现有 Playwright 体系），断言上述行为在真实管线下的可观测结果。
5. The Test Suite shall 使全部既有单测与 e2e 在改造后保持通过（无回归）。

### Requirement 8: 增量迁移与向后兼容

**Objective:** 作为 pi-web 框架开发者，我希望改造分步进行且每步可独立上线、可回退，以便降低风险并保持线上可用。

#### Acceptance Criteria
1. The Migration shall 划分为四个可独立交付的步骤：服务端快照、泛化粘性、前端投影、协议契约，每步均可单独合并与回退。
2. When 引入 `session-state` 帧，the Session Engine shall 保证未识别该帧的旧客户端可安全忽略它而不报错。
3. While 处于过渡期，the Session Engine shall 继续提供既有 `session-status`、`stats`、`logs` 帧/端点，保持现有消费者可用。
4. If 任一迁移步骤被回退，the System shall 退回到该步骤之前的可工作状态，不残留破坏性中间态。
