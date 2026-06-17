# Research & Design Decisions — rpc-channel

## Summary
- **Feature**: `rpc-channel`
- **Discovery Scope**: New Feature(greenfield)+ 对单一上游 `protocol-contract` 的 Complex Integration
- **Key Findings**:
  - 不复用包内 `RpcClient`:它写死 spawn `pi --mode rpc`、未暴露 extension UI 子协议、基于 Node `readline`(会在 `U+2028`/`U+2029` 误切)——三处都与本特性硬性要求冲突。
  - 协议类型已由上游 `protocol-contract`(`@pi-web/protocol`)集中导出(`RpcCommand`/`RpcResponse`/`AgentEvent`/`RpcExtensionUIRequest`/`RpcExtensionUIResponse` 等),本特性只 import 消费,不在本地重建 `rpc-types.ts`(PLAN.md 早期方案已被 protocol-contract 取代)。
  - `PiRpcChannel` 是 §14.1① 强制接缝:必须先有接口,`PiRpcProcess` 仅是 `local` 实现;命令封装层只依赖接口,可用纯 mock channel 做单测。

## Research Log

### 不复用包内 `RpcClient`
- **Context**:能否直接用 `@earendil-works/pi-coding-agent` 的 `RpcClient` 省去自写?
- **Sources Consulted**:PLAN.md §3.1、§7.3、tech.md「关键技术决策」、brief.md「现状」。
- **Findings**:`RpcClient` (1) 写死 spawn 目标 `pi --mode rpc`;(2) 不暴露 `extension_ui_request` 子协议(权限弹窗无法挂起/回复);(3) 行切分用 Node `readline`,在 JSON 字符串内含 `U+2028`/`U+2029` 时会误切成多行。
- **Implications**:必须自写 `PiRpcProcess`,参照其 spawn + framing 结构,但替换 reader、补齐扩展 UI、并外置 spawnSpec。

### JSONL 成帧语义
- **Context**:pi 的 JSONL 严格语义如何正确实现?
- **Sources Consulted**:PLAN.md §3.1、§7.2、tech.md「JSONL framing」。
- **Findings**:必须仅按 `\n` 切、剥尾随 `\r`(CRLF 容错)、缓冲跨 chunk 不完整行、跳过空行、保留行内 `U+2028`/`U+2029`。Node `readline` 把 `\n`/`\r`/`U+2028`/`U+2029` 都视为行边界,故禁用。
- **Implications**:reader 是纯函数式增量解析器(喂 chunk → 吐完整行),可脱离子进程单测,直接覆盖 Req 3/7.1。

### spawnSpec 边界与 `cliPath` 定位
- **Context**:谁决定 spawn 什么?
- **Sources Consulted**:PLAN.md §3.0.0、§3.1、§7.6,roadmap.md(`agent-source-resolver`)。
- **Findings**:spawn 目标(`node runner.ts --agent …` 或 `node <pkg>/dist/cli.js --mode rpc`)、`require.resolve` 定位包内 `cli.js`、双模式判定——全部归 `agent-source-resolver`。本特性只接收 `{ cmd, args, cwd, env }` 形状的 spawnSpec。
- **Implications**:`PiRpcProcess` 不含任何源解析/入口探测;spawnSpec 形状是本特性与上游的契约。

### 扩展 UI 子协议挂起/回复
- **Context**:`extension_ui_request` 如何处理?
- **Sources Consulted**:PLAN.md §3.1、§3.3(`POST /ui-response`)、§4(走旁路非 UIMessage)。
- **Findings**:扩展 UI 请求带 `id`,通道需登记为待决项并通知上层(session-engine),上层经 `respondExtensionUI(id, …)` 把回复写回 stdin。它不是命令响应(无对应已发命令),也不走 UIMessage 翻译。
- **Implications**:通道维护两张表:`pendingCommands`(id→Promise resolver)与 `pendingExtensionUI`(id→请求快照),职责分离。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Ports & Adapters(选用) | `PiRpcChannel` 端口 + `PiRpcProcess` 本地适配器;命令封装层依赖端口 | §14.1① 接缝;命令层可纯 mock 单测;e2b/ssh 只是新适配器 | 需先定义接口再实现 | 与 steering「传输/隔离用接口隔开」一致 |
| 直接子类化包 `RpcClient` | 继承并覆盖 reader/扩展 UI | 少量代码 | `RpcClient` 内部私有、spawn 写死,覆盖面脆弱;无接缝 | 否决 |
| 把 framing 内联进 session-engine | 不单独成层 | 少一层 | 违反 spec 边界(roadmap);无法独立测试/复用 | 否决 |

## Design Decisions

### Decision: 接口先行,`PiRpcProcess` 为 `local` 实现
- **Context**:§14.1① 要求传输无关接缝。
- **Alternatives Considered**:1) 直接写 `PiRpcProcess` 具体类;2) 端口/适配器分层。
- **Selected Approach**:定义 `PiRpcChannel { send/onLine/close/health }`;`PiRpcProcess` 实现之;命令封装层仅对接口编程。
- **Rationale**:几乎零额外成本,换来未来 e2b/ssh/device 复用与命令层可 mock 单测。
- **Trade-offs**:多一个接口文件;收益远大于成本。
- **Follow-up**:命令封装单测必须用 mock channel,不启动真实进程(验证接口可替换性,Req 1.5)。

### Decision: 增量 JSONL reader 与命令分发分离
- **Context**:framing 必须独立可测且协议正确。
- **Selected Approach**:`JsonlLineReader`(纯增量解析:`push(chunk) → string[] 完整行`,内部维护残留缓冲)与 `PiRpcProcess` 的消息分发(按形状路由三类)解耦。
- **Rationale**:reader 无 I/O、可大量正反例单测覆盖 Req 3 全部成帧规则;分发层只关心已成行的消息。
- **Trade-offs**:两个小组件而非一个大类;可读性与可测性更高。
- **Follow-up**:reader 单测覆盖 CRLF / 分片 / `U+2028`/`U+2029` / 空行 / 单 chunk 多行。

### Decision: 消费上游协议类型,不重建本地 `rpc-types.ts`
- **Context**:PLAN.md §3.1 早期设想本地复制 d.ts;但 roadmap 已将协议契约收敛到 `protocol-contract`。
- **Selected Approach**:从 `@pi-web/protocol` import `RpcCommand`/`RpcResponse`/`AgentEvent`/`RpcExtensionUIRequest`/`RpcExtensionUIResponse` 等。
- **Rationale**:单一事实来源,避免类型分叉;依赖方向 `protocol ← rpc-channel` 单向收敛。
- **Trade-offs**:运行依赖上游包就绪;由波次顺序(protocol-contract 先行)保证。
- **Follow-up**:协议形状变更触发本特性重校验(Revalidation Trigger)。

## Risks & Mitigations
- 不能部署 Serverless/Edge(子进程跨请求驻留)— 本特性只提供 `local` 通道;远程接缝留给未来 provider。
- 待决命令在子进程崩溃时悬挂 — `close()`/exit 时统一拒绝所有待决 Promise(Req 6.2/6.3)。
- 僵尸进程 — `detached:false` + `close()` 显式 kill + exit 监听(Req 2.2/6.6)。
- 真实 pi 环境不可用导致集成/e2e 不可跑 — 提供等价 stub 进程作为退路(Req 7.4),但 e2e 优先真实 `pi --mode rpc`。

## References
- `PLAN.md` §3.1(PiRpcProcess)、§3.0.0(spawn 目标双模式)、§14.1①(传输无关接口)、§7(风险)。
- `.kiro/specs/protocol-contract/design.md` — 上游协议契约(`RpcCommand`/`RpcResponse`/`AgentEvent`/扩展 UI 类型)。
- `.kiro/steering/tech.md`、`structure.md` — JSONL framing、接缝、依赖方向约束。
