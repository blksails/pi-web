# Research & Design Decisions

## Summary
- **Feature**: `session-readiness-handshake`
- **Discovery Scope**: Extension(在既有会话引擎 / SSE 协议 / 前端 control 链路上增量)
- **Key Findings**:
  - pi 的 `AgentEvent` 联合中**不存在** `session_start`/`ready` 事件——首个事件 `agent_start` 是每轮对话才发,启动期无锚点。
  - 现有两个 "ready" 都早于真实就绪:`PiRpcProcess.status="ready"` 在 OS `spawn` 事件(`pi-rpc-process.ts:160-162`)、`PiSession._status="active"` 在构造时(`pi-session.ts:88`);`createSession` 同步返回不等就绪(`session-manager.ts:78-94`)。
  - `PiSession` 对普通帧纯广播、无回放缓冲;唯一回放范式是日志 `LogRingBuffer` 在 `subscribe()` 回填(`pi-session.ts:184-190`)——直接复用为粘性状态载体。

## Research Log

### 就绪锚点:pi 是否有 ready 事件?
- **Context**: 需要一个"agent 真正能处理命令"的锚点。
- **Sources Consulted**: `packages/protocol/src/rpc/event.ts`(`CoreAgentEventSchema` 全枚举)、`translate-event.ts`(`agent_start`→start 是每轮)。
- **Findings**: 无 session 级 ready/init 事件。`agent_start` 仅在 prompt 之后。
- **Implications**: 必须**主动探测**就绪,不能被动等事件 → 探针模式。

### 探针命令选择:getCommands 是否在 idle 期可响应?
- **Context**: 探针须只读、无副作用,且能在"无 prompt"的 idle 期得到响应。
- **Sources Consulted**: `SessionChannel`(`session.types.ts:47-101`,含 `getCommands(): Promise<RpcResponse>`)、前端 `pi-chat.tsx:464` mount 后于 idle 调 `getAvailableModels`。
- **Findings**: 前端已在 idle 期成功调用只读查询;`getCommands` 列 slash 命令,只读、需 session 绑定。其 pending-command Promise 天然等到 agent 读循环起、处理 stdin 缓冲的该命令并回响应时才 resolve——**"首条响应"即真实就绪**,timeout 仅兜底 never-responds。
- **Implications**: 选 `getCommands` 为探针;"resolve(含 error 响应)即 ready,reject/超时即 error"。

### 粘性状态如何投递到前端(两条 SSE 路径)?
- **Context**: 早期帧丢失源于"发帧时无订阅者"。需让任何订阅者订阅即得当前态。
- **Sources Consulted**: `connection.ts` per-prompt `handleEvent`(`frame.kind==="control"`→`applyControlFrame`,放行全部 control)、`openControlOnlyStream`(仅放行 `ui-rpc`,224 行)、`pi-chat.tsx:486-502`(idle 控制流 `!isBusy && needsIdleControl` 才开)。
- **Findings**: per-prompt 流已灌全部 control 帧;idle 流需扩展放行 `session-status`。就绪期恒 idle(`isBusy` 不可能真),故扩展 `needsIdleControl` 含 `!sessionReady` 即可在 mount 期开流接粘性帧,且不与 prompt 流冲突(规避 [[pi-web-uirpc-idle-control-stream]] 记录的回归)。
- **Implications**: 三处前端改动:control-store 加 `lifecycle` 切片、connection 放行、pi-chat 门控 + 扩展开流条件。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 探针 + 门控(选用) | 主动探就绪 + 前端门控发送 + 粘性帧回放 | 正确性满分、部件最少、复用回填范式、零上行队列 | 就绪前输入框短暂禁用 | 本期方案 |
| 探针 + 上行队列 | 服务端缓冲过早 prompt,ready 时 flush | 即输即发零门控 | 队列顺序/超时/与 abort·restart·fork 交互复杂 | 留作后续 UX 优化(R6.1 排除) |
| prompt 自探 + 重试 | 首条 prompt 当探针,失败重试 | 省探针命令 | prompt 非幂等→双跑风险;UI "已连接"无独立锚点 | 否决 |
| runner sentinel | runner bootstrap 吐 ready 行 | 无探针 RTT | `runRpcMode` 前吐偏早、缺 started hook | 不可靠,否决 |

## Design Decisions
- **D1 探针 = `getCommands`,resolve 即 ready**:有响应即证明读循环起 + session 绑定;timeout(默认 30s)兜底 never-responds → `error{probe-timeout}`。
- **D2 生命周期态与 `_status` 正交**:`_status` 是通道活动态(active/stopping/stopped),`_lifecycle` 是业务就绪态(initializing/ready/error/ended);不复用同一字段避免语义混淆。
- **D3 粘性回放复用日志范式**:`subscribe()` 在日志回填后追加一帧当前 `session-status`,仅发新订阅者。
- **D4 失败安全默认**:前端 control-store `lifecycle` 初始 `initializing` → 收到任何帧前默认不可发送,绝不抢跑。
- **D5 本期不重试探针、不做上行队列**(R6.1 / Non-Goals),保持最小部件、零回归。

## Synthesis Outcomes
- **泛化**:粘性 `session-status` 回放与既有日志回填是同一"订阅即回填快照"模式的两个实例;实现时对齐 `pi-session.ts:184-190` 写法,不另造抽象。
- **build-vs-adopt**:复用既有 `getCommands` / `EventEmitter` / `ControlStore` / idle 控制流,无新依赖。
- **简化**:不引入会话创建 HTTP 响应携带初始态(粘性流回放已覆盖);不引入独立就绪 hook,挂在既有 `usePiControls`。
