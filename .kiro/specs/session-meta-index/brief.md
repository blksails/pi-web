# Brief: session-meta-index

## Problem

会话列表想展示「标题 / 图标 / 所属 agent-source」和「工作状态（busy）」，但这些信息今天没有可快速读取的来源：

- **标题要扫全文件**。`packages/core/src/session-list/session-list-routes.ts:137` 的 `enrichDisplayNames`
  注释已写明：fs 后端每项 `displayName` 需**顺读整份 jsonl** 才能取到最新 `session_info` 名。
  为此不得不加有界并发池（`DISPLAY_NAME_CONCURRENCY = 8`）压 fd/IO 峰值，且开销与页项数成正比；
  带搜索关键字（`q`）时更要对**全量**会话先富集再过滤（同文件 :249 注释自述 O(n)）。
- **图标无处存放**。`SessionHeader`（`packages/core/src/session-store/types.ts:19`）只有
  `{type,id,version,cwd,timestamp,parentSession?,name?}`，`SessionMeta`（同文件 :102）只多
  `createdAt/updatedAt/entryCount`。没有任何图标字段。
- **agent-source 是空壳字段**。`SessionListItemSchema.source`
  （`packages/protocol/src/transport/rest-dto.ts:223`）已于 2026-07-23 加入，UI 也已能渲染它
  （`packages/ui/src/elements/session-list-panel.tsx:354` 的 `showSource` 副标题），
  但**服务端从未有人填过它** —— `toItem`（session-list-routes.ts:152）不含 `source`，
  存储层也没有来源。消费端就绪、数据源缺失。
- **工作状态未出列表**。`SessionSnapshot`（`packages/protocol/src/transport/session-state.ts:28`）
  已有服务端权威 `busy` / `lifecycle`，但只在**单会话**粘性帧内；会话列表的 DTO 无任何活跃态字段，
  列表项非空闲时无法转圈。`session-list-panel.tsx:106` 的 `Status = "idle"|"loading"|"error"`
  是**列表请求**的加载态，与「会话正在生成」无关，不可复用。

## Current State

- 会话持久化：`~/.pi/agent/sessions/<cwd 桶>/<时间戳>_<id>.jsonl`（`fs-store.ts:38/57/59`），
  jsonl 的字节格式由 pi CLI 定义，是**外部契约**，不可改。
- 存储端口 `SessionEntryStore`（types.ts:122）已是可插拔的：fs / sqlite / postgres 三实现。
  可选方法 `displayName?`（:146）就是「标题只能扫文件」这一妥协的产物。
- 活跃会话状态权威已存在：`PiSession` 的 `SessionSnapshot`（含 `busy`/`lifecycle`/`title`），
  经 `control: session-state` 粘性帧下发，作用域是**单会话**。
- 列表刷新已有通道：前端 `onTurnEnd` 边沿 bump `refreshSignal` 触发重拉（当年修「会话列表不自动刷新」用的就是这条）。

## Desired Outcome

1. 会话列表能在**不读 jsonl 正文、不扫全文件**的前提下拿到每个会话的 `title` / `icon` / `agentSource`。
2. 列表项能显示会话工作状态（至少 `busy` / `idle`），非空闲时转圈。
3. jsonl 本体**零改动**，pi CLI 侧行为不受影响；索引丢失或损坏时列表退化到今天的行为（能列、能恢复），不产生新的单点故障。

## Approach

**集中索引文件（用户定夺）** —— 一份进程外可共享的 JSON 索引，按 `sessionId` 归键，
承载 `title` / `icon` / `agentSource` 等展示元数据；列表端点一次读入即可投影全页，
彻底绕开 per-item 的 jsonl 顺读。

- **索引位置定在 sessions 目录之外**（拟 `~/.pi/agent/piweb-session-index.json`），
  不放进 `~/.pi/agent/sessions/` 内。理由：`fs-store.ts:241` 的 listDir 虽只认 `.jsonl` 结尾、
  放进去也不会被本项目误当会话，但 pi CLI 对该目录的扫描行为不在我们控制内 —— 放在目录外是零污染的选择。
- **索引经端口而非直接文件访问**：定义一个会话展示元数据端口（读/写/删），
  fs 场景用集中 JSON 文件实现；sqlite / postgres 后端已有 `name` 列并在 append `session_info`
  时维护，其实现改为落库列，避免同一事实两处存。
- **索引是缓存不是权威**：缺失 / 损坏 / 键缺失时，一律回退今天的路径
  （`displayName` 扫 jsonl、`source` 留空），并按需重建该键。任何情况下不得让列表请求失败。
- **工作状态走 REST 聚合（用户定夺）**：`GET /sessions` 从活跃会话注册表取
  `SessionSnapshot.busy` 合入列表项（未加载的会话恒 `idle`），前端沿用既有 `refreshSignal`
  bump 重拉。活跃态**不进索引文件**（运行时投影，持久化它必然产生脏状态）。

## Scope

- **In**:
  - 会话展示元数据（`title` / `icon` / `agentSource`）的持久化：端口 + 集中索引文件实现 + 库列实现。
  - 写入时机：会话创建（agentSource、初始 icon）、自动标题产生时（title）、显式改名时（title）。
  - 索引的并发安全与自愈：原子替换、读-合并-写、跨进程互斥、损坏回退与重建。
  - `GET /sessions` 投影上述字段 + 活跃态字段；`SessionListItem` DTO 相应扩展（`source` 从空壳变为真有值）。
  - 会话列表面板渲染图标、标题、来源，并在非空闲时显示转圈。
  - 会话删除时连带清理索引键（避免孤儿键无限增长）。
- **Out**:
  - 修改 jsonl 的字节格式或新增 entry 类型（本 spec 明确不碰 pi CLI 契约）。
  - 图标的编辑 UI / 图标选择器（本期只存与显示；写入由创建与自动标题链路产生）。
  - 会话搜索能力的扩展（现有 `q` 名称子串检索行为不变，只是可能因索引而变快）。
  - 跨机器索引同步、远端会话聚合。
  - 活跃态的实时推送通道（本期为 REST 聚合 + 既有刷新信号；专用跨会话广播面留作后续）。

## Boundary Candidates

- **索引端口契约**（读/写/删/批量读）—— 与后端实现解耦，是本 spec 的核心接缝。
- **集中索引文件的并发与原子性**（锁、tmp+rename、RMW 合并）—— 可独立测试，与上层无关。
- **写入时机接线**（创建 / auto-title / 改名三处触发点）—— 领域事件到索引写入的桥。
- **列表端点投影**（元数据合入 + 活跃态合入 + 回退路径）。
- **活跃态聚合**（活跃会话注册表 → 列表项的纯投影）。
- **面板渲染**（图标 / 来源 / 转圈三处 UI）。

## Out of Boundary

- pi CLI 的会话读写行为与 jsonl 语义 —— 外部契约，只做兼容性验证，不做修改。
- `SessionSnapshot` 本身的字段与语义（归 `session-snapshot-authority`）；本 spec 只**消费** `busy`。
- 会话删除 / 重命名的既有交互（归 `session-list-item-actions`）；本 spec 只在其链路上挂索引写入与清理。
- 列表的分页 / 排序 / 系统视图门控（归 `sessions-list`，行为不变）。

## Upstream / Downstream

- **Upstream**：
  - `session-store-adapters`（`SessionEntryStore` 端口与三后端实现）—— 索引端口与之并列，不改其契约。
  - `session-snapshot-authority`（`SessionSnapshot.busy` 是活跃态唯一权威）。
  - `sessions-list`（`GET /sessions` 端点、`SessionListItem` DTO、面板组件都在其边界内，本 spec 扩展之）。
  - `auto-session-title`（title 的产生源；`ambient.title` → `session_info` 追加，本 spec 在此挂索引写入）。
- **Downstream**：
  - 桌面版与 CLI 的会话列表（同一端点，自动受益）。
  - 后续「活跃态实时推送」若要做，消费本 spec 定义的活跃态字段形状。
  - 后续会话搜索增强可直接查索引而非扫 jsonl。

## Existing Spec Touchpoints

- **Extends**: `sessions-list`（DTO / 端点 / 面板三处扩展）。roadmap 原先把「会话活跃态显示」
  记为 `sessions-list` 的 Existing Spec Update，**本 spec 全包吸收该条**，勿两处实现。
- **Adjacent**:
  - `session-list-item-actions`（删除/重命名交互 —— 索引清理与 title 写入挂在其链路上，不重做交互）。
  - `session-store-adapters`（三后端 —— 索引端口与之并列共存）。
  - `attachment-tool-bridge` 的 `.att.json` 不透明 meta（同类先例：领域无关地存 opaque JSON）。
  - `auto-session-title`（title 来源）。

## Constraints

- **jsonl 是外部字节契约**：pi CLI 也读写同一批文件，格式零改动是硬约束。须验证多出的索引文件
  不影响 pi CLI 的目录扫描（放在 sessions 目录外即为规避手段，仍需实测确认）。
- **★ 集中索引的并发写是本方案的主要风险，须在设计阶段正面解决**：并发写者包括多个 pi-web 实例、
  桌面版、以及 CLI 直开的会话。整文件替换语义下「最后写者赢」会**丢掉其他写者刚写入的键**
  （不是丢自己的写，而是丢别人的）。缓解方向须在设计中定稿：锁下读-合并-写 + tmp+rename 原子替换 +
  进程内串行队列；并以「索引仅为缓存、可从 jsonl 重建」兜底，使最坏情况退化为性能损失而非数据丢失。
  （sidecar 单会话侧文件本无此问题，方案由用户明确选定为集中索引，故风险转由设计消化。）
- **索引不得成为新的单点**：任何读失败都必须能回退到现有 jsonl 路径。
- **不得引入额外依赖到内核包**：`@blksails/pi-web-core` 的依赖声明不得出现数据库驱动等
  （`core-package-extraction` R1.2 已立此纪律）；集中索引实现若需锁机制，用 Node 内置能力。
- **活跃态不落盘**：进程崩溃后残留的 `busy` 会永久骗人，活跃态只能是运行时投影。
- **验证判据**：列表相关的时序/渲染必须以浏览器 e2e 为准（`isolated-panes` 的教训：单测全绿而真实浏览器全红）；
  性能主张须给出机械证据（改造前后的 IO 次数或耗时对比），不能只说「更快」。
