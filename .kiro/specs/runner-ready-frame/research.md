# Research Log — runner-ready-frame

## Discovery Scope

Extension 型改造（存量系统集成），轻量 discovery：不引入外部依赖，全部调研为仓内实证 + Node 流语义验证。调研日期 2026-07-30，均为当日新鲜证据。

## Investigations

### I1 · 根因判别实验（stdin 早期行丢失）

**方法**：scratchpad 最小复现（`parent.mjs`/`child.mjs`），父进程 t=0 与 t=600ms 各写一行，子进程早挂 `data` 监听（模拟 frame-channel）、300ms 后晚挂第二个监听（模拟 pi 的 `attachJsonlLineReader`）。唯一变量：早挂后是否 `pause()`、晚挂后是否 `resume()`。

| 变体 | 晚挂读取器收到 | 结论 |
|---|---|---|
| 早挂不 pause | 只有 LATE 行 | **EARLY 行物理丢失**（复现故障） |
| 早挂后 `pause()`，晚挂后 `resume()` | EARLY + LATE | 零丢失 |
| 早挂后 `pause()`，无人 `resume()` | 全空 | **死锁** —— 显式 pause 是粘性的，晚挂 `on("data")` 不解除 |

**含义**：① 修根因 = frame-channel 挂完读取器立即 pause；② resume 义务在 runner 自己身上（pi 的读取器只 `on("data")` 不 `resume()`，见 pi SDK `dist/modes/rpc/jsonl.js:41`）。

### I2 · resume 判据（newListener 事件）

**方法**：`child3.mjs` 端到端验证 —— pause 后监听 `newListener` 事件，见 `data` 监听器新增（`setImmediate` 一拍后核对 `listenerCount > baseline`）即 `resume()` 并发 `{type:"runner_ready"}` 帧。

**结果**：`early=EARLY+LATE, late=EARLY+LATE, ready-frame-received ✓`。判据精确（事件驱动、零轮询）、时序正确（EARLY 行缓冲后被晚挂读取器完整收到）。

**风险**：`newListener` 在监听器**加入之前**触发（Node 文档语义），故须 `setImmediate` 后核对 count；pi 未来若改用 `readable` 事件而非 `data`，判据失效 → 必须配兜底超时强制 resume（Req 1.4 的可诊断失败路径）。

### I3 · dev 日志时延指纹（改造收益量化）

2026-07-30 dev 实测（`PI_WEB_LOG_ENABLED=1` + `session:lifecycle`）：新会话 spawn(843873) → entering rpc mode(847074) → ready(847984)。ready 恰落在 spawn+4×1000ms 重发拍后 111ms —— 首发被吞、第 4 次重发命中。**进 rpc mode 后 ~910ms 是纯等重发拍**，改为主动上报后预期 <100ms。

### I4 · 上行帧到 PiSession 的识别路径（集成点核实）

`PiSession.handleRawLine`（pi-session.ts）内建 `add(type, {schema, handle})` 注册表，现有成员：`piweb_state`、三个结果帧（clear_queue/agent_route/attachment_catalog）、四个装配期声明帧（`slash_completions`/`agent_routes`/`agent_attachment_profile`/…）。**`runner_ready` 帧 = 加一个注册项**，零新机制。上行出口复用 frame-channel 统一 fd1 writer（`makeLineWriter`）。

### I5 · stub agent 隐藏耦合（★关键发现）

`lib/app/stub-agent-process.mjs:1160`：stub 的装配帧（slash_completions/agent_routes）**搭车 get_commands 探针**发出（注释原文「搭车 get_commands(readiness 探针,主进程此时必在监听 onLine)发出装配帧」）。删探针 → stub e2e 的声明帧失去触发时机。**stub 必须改为启动即主动发装配帧 + runner_ready 帧**。另：stubSpawnSpec 替换 spawnSpec 但不改 resolved.mode，stub 会话可能是 custom 或 cli 任一 mode → stub 无条件发 ready 帧即可两态兼容。

### I6 · cli 模式（pi --mode rpc）就绪特性

cli 模式子进程是 pi CLI 本体，**无 frame-channel 早挂监听** → stdin 无早期消费者 → 早写的行被 OS/流缓冲，pi 读取器挂上后补读 —— 无丢失问题。故 cli 模式**单次**只读判定（getCommands，无重发）即可靠。本轮 dev 实测的旧会话故障（exit code 1）根因是全局坏插件（`~/.pi/agent/registry-plugins/blksails_smoke-test` 无 factory 导出），与就绪机制无关，已移除；`exit-before-ready` 路径在该故障中表现正确（1.2s 报 error）。

### I7 · 传输形态

e2b/SandboxWs 传输跑真 runner（baked bootstrap）→ 同样发 ready 帧；上行行经传输逐行转发到 `PiRpcSession.onLine`。**真沙箱可达性本期未实证**（列入已知未验，Req 6.4）。

## Architecture Pattern Evaluation

| 方案 | 判定 | 理由 |
|---|---|---|
| A · 仅修 pause/resume，保留单发探针 | 否 | 根因修了但机制体全留，未达「去探针」目标 |
| B · pause/resume + runner 主动 ready 帧（选用） | **GO** | 判定方向反转为事实驱动；机制净删 190 行 + 配置链路；先例充分（装配期声明帧同族） |
| C · 彻底删就绪握手 | 否 | 退回「过早发送被静默丢弃」的原始竞态 |

## Design Decisions

- **D1 pause 位置**：`createInboundFrameRouter` 内 `stdin.on("data")` 之后立即 `stdin.pause?.()`——语义「本通道不驱动流动」内聚在通道自身；可选链兼容测试注入的假 stdin。
- **D2 resume 判据**：`newListener` 事件（过滤 `data`）+ `setImmediate` 后核对 `listenerCount > baseline`；兜底超时（10s）强制 resume + stderr 诊断，杜绝静默死锁。机制体独立成 `stdin-resume-gate.ts`（可注入、可单测）。
- **D3 ready 帧最小化**：`{type:"runner_ready"}` 单字段，schema 入 protocol 包（与 `slash_completions` 同族）；发送时机 = resume 成功后（早写行已缓冲，无需等 pi 处理）。
- **D4 看门狗**：单 `setTimeout`（unref），默认 30s，env `PI_WEB_READY_TIMEOUT_MS`；超时 → `error{ready-frame-missing}`。**不是探针**：不发请求、不重发。
- **D5 cli 兼容**：`PiSession` 按 `mode === "cli"` 走单发 getCommands（成功→ready；失败静默交给 exit/看门狗路径），不引入重试。
- **D6 配置链路 rename 而非叠加**：`readinessProbeTimeoutMs` → `readyTimeoutMs`（语义变了，旧名保留是误导）；env 同理换名，旧 env 不再读取（breaking，运维面记录在 design Migration）。

## Risks

| 风险 | 缓解 |
|---|---|
| pause/resume 写错 → 通道静默死锁（比 probe-timeout 难查） | 兜底超时强制 resume + stderr 诊断；死锁守卫测试（先证明能报红） |
| 旧 runner（不发帧）× 新 server → 永久 initializing | 看门狗 `ready-frame-missing`（有沙箱基座镜像旧于代码的前科） |
| pi 未来改读取器实现 → newListener 判据失效 | 兜底超时路径保证可用性退化而非死锁；it 测试钉住真实 pi 行为 |
| stub 装配帧搭车探针（I5） | stub 改主动发帧，纳入任务清单 |
| e2b 真沙箱 ready 帧可达性未实证 | 显式记已知未验（Req 6.4），不默记已验 |
