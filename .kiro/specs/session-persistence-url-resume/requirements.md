# Requirements Document

## Project Description (Input)

### 谁有问题 / 现状 / 应改变什么

- **谁**:pi-web 的使用者(在浏览器中与 agent 对话的用户),以及需要在重启 / 分享 / 刷新后恢复会话的运维与协作场景。
- **现状**:pi-web 的会话**完全不持久化、也无法用 URL 载入**。
  - 主进程用 `InMemorySessionStore`(`packages/server/src/session/session-store.ts`)只在内存登记活跃会话,服务器重启即丢。
  - 没有 `/session/[id]` 动态路由;创建会话后浏览器 URL 不变,`sessionId` 只存在于 React state,刷新即失。
  - 三个持久化后端(fs / sqlite / postgres)已实现于 `packages/server/src/session-store/`,但仅在 **agent 子进程**经 `mirror.ts` 旁路镜像(且不对 fs 启用);`lib/app/stub-agent-process.mjs` 不走 pi 的 `SessionManager`,**不落盘**。
  - 持久化的 `SessionHeader` 复刻 pi 原生格式,**只有 `cwd`,没有 agent `source` / `model`** —— 这是"续聊"的根本卡点:重新 spawn agent 必须知道 source。
- **应改变什么**:让会话持久化到 **fs / sqlite**(沿用 `SESSION_STORE` 切换),支持通过 **`/session/:id` URL 载入并继续对话**,并以 **Playwright e2e** 在两后端各验证一轮。

### 已完成的代码调研结论(供 design 复用)

1. pi `SessionManager` 支持恢复:`create(cwd, dir, { id })` 可指定 id、`open(path)`、`continueRecent(cwd)`、`list/listAll()`;`createAgentSessionRuntime({sessionManager})` 接受已加载历史的 SM;`appendCustomEntry(customType, data)` 可写自定义条目(已在 `mirror.ts` patch 列表,sqlite 会镜像)。
2. `MessageEntry.message` 与 `GetMessagesResponse.messages[]` 同构(`AgentMessage`),存读无需转换;但前端 `useChat`(AI SDK v5)用 `UIMessage`(parts-based),与 `AgentMessage` 不同构、无现成转换函数——需新写。
3. 冷会话恢复应复用 **`POST /sessions { resumeId }`**(`/sessions/:id/resume` 会被 `router.ts:168` 的 `:id` 存在性校验 404)。
4. 主进程 `sessionId`(`randomUUID`)当前与 agent 持久化文件 id **不一致**,需用 `create(cwd, dir, { id })` 对齐。
5. `@blksails/server` exports 指向 `src/index.ts`(纯 TS、无 dist);stub 是裸 node `.mjs` 无 TS loader,复用 `SessionEntryStore` 需注入 `--import jiti/register`,否则内联存储。

## Introduction

本特性让 pi-web 的会话从"纯内存、刷新即失"升级为"可持久化、可经 URL 载入并继续对话"。会话的对话历史与恢复所需的创建元数据(agent source、工作目录、模型)被写入由 `SESSION_STORE` 选择的存储后端(文件或 sqlite)。用户创建会话后浏览器地址反映该会话的唯一标识;访问该地址可恢复历史并无缝续聊。本期以 Playwright e2e 在文件与 sqlite 两后端各完成一轮端到端验证。

## Boundary Context

- **In scope**:
  - 会话对话历史与创建元数据持久化到可配置后端(文件 / sqlite)。
  - 浏览器地址反映会话标识;经 `/session/:id` 载入历史并继续对话。
  - 历史对话(用户消息、agent 回复、思考、工具调用与结果)的渲染。
  - 文件与 sqlite 两后端的端到端验证(含冷恢复:活跃会话被移除后仍可经存储恢复)。
- **Out of scope**:
  - **真实(非 stub)agent 模式下 sqlite 后端的续聊**:agent 运行时只从文件读取历史上下文,sqlite 仅为镜像;本期不保证真实模式 + sqlite 的上下文续聊,列为后续。本期 sqlite 后端的端到端续聊由确定性 stub agent 覆盖。
  - postgres 后端的端到端续聊验证(后端实现已存在,不在本期验证范围)。
  - 多用户鉴权 / 会话分享的访问控制。
  - 会话列表 / 检索 / 管理 UI。
- **Adjacent expectations**:
  - 依赖 agent 运行时(pi SDK 或确定性 stub)具备按标识加载已有会话历史并继续的能力。
  - 依赖 `SESSION_STORE` 等既有环境配置选择存储后端。

## Requirements

### Requirement 1: 会话持久化到可配置后端

**Objective:** As a 运维者, I want 会话的对话与恢复元数据持久化到所选存储后端, so that 服务重启或页面刷新后会话不丢失且可恢复。

#### Acceptance Criteria
1. When 一个会话产生新的对话条目(用户消息或 agent 回复), the Session Store shall 将该条目持久化到当前配置的存储后端。
2. Where 存储后端配置为 sqlite, the Session Store shall 将会话数据写入 sqlite 存储。
3. Where 存储后端未配置或配置为文件, the Session Store shall 将会话数据写入文件存储。
4. When 一个新会话被创建, the Session Store shall 一并持久化恢复所需的创建元数据(agent source、工作目录、模型)。
5. If 存储后端写入失败, then the Session Store shall 不中断正在进行的对话,并记录该错误。

### Requirement 2: 会话标识在 URL 与持久化之间一致

**Objective:** As a 用户, I want 浏览器地址里的会话标识与持久化记录一致, so that 我能用该地址重新打开同一会话。

#### Acceptance Criteria
1. When 一个新会话创建成功, the Web UI shall 使浏览器地址反映该会话的唯一标识(形如 `/session/:id`)。
2. The Session Store shall 使持久化记录中的会话标识与浏览器地址中的会话标识一致。
3. While 会话处于活跃状态, when 用户在该会话地址刷新页面, the Web UI shall 保持同一会话标识不变。

### Requirement 3: 通过 URL 载入并继续会话

**Objective:** As a 用户, I want 打开一个会话地址即可恢复历史并继续对话, so that 我无需重新开始即可接续之前的工作。

#### Acceptance Criteria
1. When 用户访问一个已持久化但当前不在内存中的会话地址, the Session Resume service shall 从持久化存储恢复该会话并使其可继续对话。
2. If 用户访问的会话地址在持久化存储中不存在, then the Web UI shall 显示可识别的"会话不存在"提示而非崩溃。
3. When 用户在已恢复的会话中发送新消息, the Session shall 在原有历史上下文的基础上继续响应。
4. While 同一会话已在内存中活跃, when 用户访问其地址, the Session Resume service shall 直接复用该活跃会话而不重复创建(幂等)。

### Requirement 4: 历史对话的完整渲染

**Objective:** As a 用户, I want 恢复的历史对话呈现得与实时一致, so that 我能正确理解之前的对话内容并继续。

#### Acceptance Criteria
1. When 历史对话被载入, the Web UI shall 按原始顺序渲染用户消息与 agent 回复。
2. Where 历史包含 agent 的思考、工具调用与工具结果, the Web UI shall 分别以对应的可视形式呈现。
3. When 历史渲染完成, the Web UI shall 允许用户无缝继续输入新消息。

### Requirement 5: 存储后端切换与端到端可验证性

**Objective:** As a 开发者, I want 能在文件与 sqlite 两后端切换并端到端验证持久化与恢复, so that 我能确信两种后端下的核心交付都成立。

#### Acceptance Criteria
1. Where 存储后端为文件, the e2e suite shall 验证「新建会话 → 对话 → 经该地址重新载入 → 历史恢复 → 可续聊」,并断言文件存储中存在该会话的持久化产物。
2. Where 存储后端为 sqlite, the e2e suite shall 验证同一端到端流程,并断言 sqlite 存储中存在该会话记录。
3. When 一个活跃会话被显式移除后用户再访问其地址, the Session Resume service shall 仍能从持久化存储恢复该会话(覆盖冷恢复路径)。
