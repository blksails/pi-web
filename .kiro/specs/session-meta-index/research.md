# Research & Design Decisions — session-meta-index

## Summary

- **Feature**: `session-meta-index`
- **Discovery Scope**: Extension（对既有 `sessions-list` / `session-store-adapters` / `session-snapshot-authority` 三个边界的扩展；无新增外部依赖，故跳过技术验证子代理，全部 inline 勘察）
- **Key Findings**:
  1. `ResolvedSource.policySource` 已是「resolver 稳定来源标识」且公共实现**恒赋值** → agentSource 不需新造事实源，会话创建路径直接可得。
  2. **服务端 `pendingExtensionUI` 混入推送类请求**（`notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text` 永不回包）→「挂起表非空」**不等于**「在等用户」，必须按 `method` 过滤交互四类。这是「等待用户交互」态成立与否的关键。
  3. fs 后端 `displayName` 每项顺读整份 jsonl（代码自述），而 sqlite/postgres 在 append `session_info` 时已维护 `name` 列 → 索引对 title 的加速价值**只在 fs 后端**；agentSource 的载体价值在**所有后端**。
  4. 前端 `onTurnEnd` 只在 `isBusy` **下降**边沿触发（`pi-chat.tsx:851`）→ R8.1「轮次开始也刷」必须新增上升边沿通知。

## Research Log

### 挂起表能否作为「等待用户交互」的判据

- **Context**: R7.2 要求列表显示「等待用户回应」。需要一个零新增字段的可靠信号。
- **Sources Consulted**: `packages/core/src/session/pi-session.ts:1313-1341`、`packages/protocol/src/rpc/extension-ui.ts:15-55`、`packages/react/src/sse/control-store.ts:326-365`。
- **Findings**:
  - `handleExtensionUIRequest` **无条件** `pendingExtensionUI.set(req.id, req)`，不区分 method。
  - `RpcExtensionUIRequest` 是按 `method` 判别的联合，共九种：交互类 `select` / `confirm` / `input` / `editor`（需回包），推送类 `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`（无回包）。
  - 前端 `routeExtensionUi` 已显式分流两类，并在注释中立下不变量「推送类绝不进入 extensionUiQueue」。服务端**没有**对应分流。
  - 只有 `seedInitialTitle`（冷恢复合成帧）明确绕过挂起表；来自 agent 的真实 `setTitle` 帧仍会入表。
- **Implications**:
  - 活跃态派生必须**按 method 过滤**到交互四类，否则任何发过 `notify` 的会话会永久显示「等待用户交互」。
  - 交互类 method 集合必须有**单一权威**（放 protocol），否则前后端两份清单必然漂移。
  - 顺带发现的存量问题：推送类在服务端挂起表里无界累积（内存，随会话生命周期释放）。**不在本 spec 边界内修**（属 `PiSession` 挂起表语义），仅记录。

### agentSource 的事实来源

- **Context**: R1.1 要求创建会话时保存所属 agent-source；`SessionListItem.source` 已存在但服务端从未填过。
- **Sources Consulted**: `packages/core/src/agent-source/types.ts:38-51`、`lib/app/pi-handler.ts:848-854`、`packages/core/src/http/routes/create-session.ts:96/129`。
- **Findings**:
  - `ResolvedSource.policySource` 语义为「dir 原始 source 串 / 缺省 cwd / git url / `builtin:<name>`」，注释明载「本模块的公共实现恒赋值」，且已被沙箱模板解析消费（`template-name.ts` 以它派生 slug）。
  - 会话创建集中在 `create-session.ts` 两处 `manager.createSession(...)`，该处 `resolved` 在手。
- **Implications**: agentSource = `policySource`，零新增推导；写入挂点唯一（create-session 路由），不必散落。存量会话无此事实 → 已在 R9.6 明确不保证补齐。

### title 的权威与后端差异

- **Context**: R2.2/R2.3/R9.5 要求索引命中即不扫文件、未命中不变差、且不与后端自维护的名称冲突。
- **Sources Consulted**: `session-list-routes.ts:127-150/271-274`、`fs-store.ts:147`、`sqlite-store.ts:115-117`、`session-actions-routes.ts:156-170`。
- **Findings**:
  - fs：`SessionMeta.name` 仅来自 header，最新标题只能靠 `displayName` 扫全文件派生。
  - sqlite/postgres：append `session_info` 时 `UPDATE name` 列，`list.name` 已是最新，且不实现 `displayName`。
  - 显式改名走 `POST /sessions/rename` → append 一条 `session_info`。
  - 自动标题走 `setTitle` extension-ui 请求（推送类），持久化由 pi 原生 / mirror 落 `session_info`。
- **Implications**: 投影优先级定为 **store.name（非空）> 索引 title > `displayName` 派生**。这一条同时满足 R2.2（命中不扫）、R2.3（未命中不变差）、R9.5（后端自维护者为准，不产生第二权威）。

### 刷新时机

- **Context**: R8.1/R8.3 要求轮次开始与开始等待用户回应时列表可见变化。
- **Sources Consulted**: `packages/ui/src/chat/pi-chat.tsx:845-856`、`components/chat-app.tsx:716-722`。
- **Findings**: 现有 `onTurnEnd` 由 `turnEndWasBusyRef.current && !isBusy` 触发，**仅下降边沿**；`chat-app` 用它 bump `sessionListRefreshKey`。
- **Implications**: 在同一处扩展为「活跃态变化即通知」（busy 双边沿 + 交互挂起数 0↔非0），宿主复用同一个 bump。既有 `onTurnEnd` 语义保持不变（另有消费者：panelSyncSignal 画廊重建），不可改其触发条件。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 单会话 sidecar 文件 | 每会话一个 `.meta.json` 与 jsonl 并放 | 无并发写竞争（写者天然分片）；与 `.att.json` 先例同构 | 文件数翻倍；列表需 readdir + 逐个读 | discovery 阶段推荐，**被用户否决** |
| **集中索引文件（选定）** | 全机器一份 JSON，按 sessionId 归键 | 列表一次读取即得全量；实现集中、易 prune | 多进程并发写需锁；整文件替换会丢别人的键 | 用户定夺；风险由设计消化（锁下 RMW + 可重建） |
| jsonl 内 custom entry | 用格式内 `CustomEntry` 追加 | 零新文件；pi CLI 按未知 customType 忽略 | 读取仍需扫 jsonl，不解决快速展示 | 否决：与本特性首要目标相悖 |
| 索引落进 sqlite 表 | 复用已有 sqlite 后端 | 事务与并发天然安全 | fs 后端（默认部署形态）拿不到收益；内核不得依赖驱动 | 否决 |

## Design Decisions

### Decision: 索引是缓存，不是权威

- **Context**: R3.x 要求任何元数据故障都不影响会话能否列出与恢复。
- **Alternatives Considered**: 1) 索引为 title 权威（读最快）；2) 索引为缓存、jsonl 为权威。
- **Selected Approach**: 缓存。读失败/损坏/缺键一律回退既有路径；可从 jsonl 重建。
- **Rationale**: 与用户定夺一致；也是「集中索引并发写」这一风险的兜底 —— 最坏退化为一次性变慢而非数据丢失。
- **Trade-offs**: 放弃了「彻底退役 `displayName` 扫文件」的收益，回退路径必须长期保留。
- **Follow-up**: 验收须证明索引删除后列表行为与今天等价（R3.1）。

### Decision: 交互类 method 集合放 protocol，作为单一权威

- **Context**: 见上「挂起表能否作为判据」。
- **Alternatives Considered**: 1) core 内自建清单；2) protocol 导出常量，core 消费，测试守卫两处一致。
- **Selected Approach**: 方案 2。
- **Rationale**: 前端已有一份分流 switch；再在 core 写第二份清单必然漂移（新增一个 method 时只改一处）。
- **Trade-offs**: protocol 多一个导出常量。
- **Follow-up**: 守卫测试须对「交互类 ∪ 推送类 = schema 全集且互斥」做差集断言 —— **不得**写成重言式（用常量断言常量）。

### Decision: 并发写用「锁下读-合并-写 + 原子替换」，抢不到即放弃

- **Context**: R4.1 不丢别人的条目；R4.2 不读中间态；R4.3 抢不到不阻塞。
- **Alternatives Considered**: 1) 无锁整文件替换（会丢键）；2) 每次写前读并合并 + 文件锁 + tmp+rename；3) 引入锁库。
- **Selected Approach**: 方案 2，锁用目录/独占创建（Node 内置能力，无新依赖），带超时与陈旧锁清理；写入经临时文件 + `rename` 原子替换。
- **Rationale**: 内核包不得引入新依赖；`rename` 在同一文件系统上原子，天然满足 R4.2（读者只会看到旧或新整份）。
- **Trade-offs**: 高并发下会有写入被放弃（元数据是展示增强，可接受且已由 R4.3 明确）。
- **Follow-up**: 必须有并发测试真正并行写不同 sessionId 并断言无键丢失 —— 不能只测串行。

### Decision: 活跃态经装配层的 provider 注入，不让列表路由认识 SessionManager

- **Context**: R7.5/R7.7 要求只投影既有权威、不加载会话。
- **Selected Approach**: 列表路由接受一个可选的 `activityOf(sessionId) => SessionActivity | undefined`；装配层从 `SessionManager.getStore().list()` 构造。
- **Rationale**: 保持 `session-list` 端点对活跃会话注册表零依赖（今天它只认 `SessionEntryStore`）；也让路由可单测。
- **Trade-offs**: 装配层多一根接线。
- **Follow-up**: 注意术语双生：`SessionStore`（活跃会话注册表）与 `SessionEntryStore`（持久化）不是一回事。

### Decision: 来源色条由来源标识确定性派生，不落盘

- **Context**: R6.3/R6.4 要求同来源同色、跨刷新稳定；icon 已被否决。
- **Selected Approach**: 纯函数 `sourceAccentColor(source)`：稳定哈希 → 固定调色板取模。
- **Rationale**: 零存储、零空值、存量会话只要有来源即可立刻着色；确定性满足「稳定」。
- **Trade-offs**: 不同来源可能撞色（调色板取模）；R6.3 已写为「尽可能不同」而非「保证不同」。

## Risks & Mitigations

- **并发写丢键** — 锁下 RMW + 原子替换；并发测试为验收前置；索引可重建兜底。
- **推送类污染「等待用户交互」态** — method 过滤 + protocol 单一权威 + 差集守卫测试。
- **索引与 jsonl 漂移**（外部删除会话文件后索引残留） — 列表以实际存在的会话为准（R5.2），索引只做富集；提供 prune（R5.3）。
- **pi CLI 兼容** — 索引落在 `~/.pi/agent/sessions/` **之外**；须实测 CLI 列出/恢复不受影响（R9.2）。
- **列表时序类缺陷单测抓不到** — 状态与刷新时机以浏览器 e2e 为判据（`isolated-panes` 教训）。
- **性能主张空口无凭** — R2.5 要求以改造前后实测读取次数/耗时为证据。

## References

- `docs/pi-web-host-contract-v1.md` §5.1 / §5.3 — 能力面装配与冻结 id 清单（`session.list` 在册）。
- `.kiro/specs/sessions-list/` — 被扩展的存量 spec（端点/DTO/面板三处）。
- `.kiro/specs/session-snapshot-authority/` — `SessionSnapshot.busy` 的权威定义。
- `.kiro/specs/auto-session-title/` — title 产生链路（Req 8.4 即 `displayName` 那条妥协的出处）。
