# Implementation Plan — runner-ready-frame

- [x] 1. 定义 runner_ready 帧协议
- [x] 1.1 新增 ready 帧 schema 并从协议包导出
  - `packages/protocol/src/transport/runner-ready.ts` 定义 `{type:"runner_ready"}` 单字段 schema（zod literal），与 slash_completions 同族
  - `packages/protocol/src/index.ts` barrel 导出
  - 完成态：protocol 包 typecheck 通过，core/runner 两包可 import 该 schema 与类型
  - _Requirements: 2.2_

- [x] 2. runner 侧 stdin 时序治理与 ready 帧发射
- [x] 2.1 (P) frame-channel 挂载后暂停 stdin + 流视图扩展
  - `frame-router.ts` 在 `stdin.on("data")` 成功后立即 `stdin.pause?.()`（可选链，假 stdin 无 pause 不抛）
  - `stream-views.ts` 的 ReadableLike 增可选 `pause/resume/listenerCount`，导出 gate 所需完整视图类型
  - 扩展 frame-channel 单测：install 后对假 stdin 调用过 pause；无 pause 能力不抛（design T2）
  - 完成态：frame-channel 单测绿；既有各桥帧分发测试不回归
  - _Requirements: 1.2, 1.5_
  - _Boundary: frame-channel — `packages/runner/src/runner/frame-channel/frame-router.ts`, `packages/runner/src/runner/frame-channel/stream-views.ts`, `packages/runner/test/runner/frame-channel.test.ts`_

- [x] 2.2 stdin resume 判据机制体与死锁守卫测试
  - 新建 `stdin-resume-gate.ts`：baseline=listenerCount("data")，监听 newListener(data) + setImmediate 后核对 count>baseline → resume + sendReady；fallbackMs（默认 10s）超时强制 resume + sendReady + stderr 诊断；两路径竞态收敛（先到者执行）；timer unref；dispose 幂等
  - 单测（假 stdin=EventEmitter）：判据命中 → resume+ready 恰一次；兜底路径 → 强制 resume+诊断行；竞态只执行先到者；dispose 幂等
  - 死锁守卫：判据与兜底同时禁用时测试必须报红的反向用例（先证明判据能报红，Req 8.2）
  - 完成态：`packages/runner/test/runner/stdin-resume-gate.test.ts` 全绿且死锁守卫反向用例被验证过能红
  - _Depends: 2.1_
  - _Requirements: 1.2, 1.3, 1.4, 2.1_

- [x] 2.3 runner 装配 gate 并接入统一释放
  - `runner.ts` 在 wireSessionBridges 完成后、runRpcMode 之前 installStdinResumeGate；sendReady 经 frameChannel.send 发 `{type:"runner_ready"}`（统一 fd1 writer）
  - gate 的 dispose 并入 runSessionCleanup 的 disposeAll 列表
  - 完成态：真实 runner 启动后 stdout 可观察到一行 runner_ready 帧（手动或 it 档验证）
  - _Depends: 1.1, 2.2_
  - _Requirements: 2.1, 1.3_

- [x] 3. core 侧就绪判定收帧化
- [x] 3.1 (P) PiSession 收帧就绪 + 看门狗 + cli 单发 + 重启简化
  - handleRawLine 注册表 add("runner_ready") → setLifecycle("ready")（重复/迟到帧由既有单向守卫消化；handshake off 时 setLifecycle 整体 no-op）
  - 看门狗：单 setTimeout(unref)，默认 30s，超时 → error{ready-frame-missing}；ready/终态/cleanup 统一取消不残留
  - cli 单发：readinessHandshake && mode==="cli" 时单次 getCommands 成功→ready，失败静默（交给 exit/看门狗），无重试无专用定时器
  - restart 路径（restartRunner/handleRunnerRestarted）：复位 initializing + 重武装看门狗，删除 settle 定时器与 RESTART_PROBE_SETTLE_MS
  - 选项 rename：readinessProbeTimeoutMs → readyTimeoutMs（session.types.ts / session-manager.ts 同步透传）
  - 完成态：pi-session.ts 不再 import ReadinessProbe；typecheck 通过（探针文件删除在 3.2）
  - _Depends: 1.1_
  - _Requirements: 2.3, 2.4, 3.1, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 7.3_
  - _Boundary: PiSession — `packages/core/src/session/pi-session.ts`, `packages/core/src/session/session.types.ts`, `packages/core/src/session/session-manager.ts`_

- [x] 3.2 删除探针机制体并改造 core 单测面
  - 删 `packages/core/src/session/readiness-probe.ts` 与 `packages/core/test/session/readiness-probe.test.ts`（随机制移除，非 skip）
  - 改造 `packages/core/test/session/pi-session.readiness.test.ts` / `pi-session.server-gate.test.ts`：stub channel 注入 onLine('{"type":"runner_ready"}') 驱动 ready；补看门狗超时→error{ready-frame-missing}、重复帧 no-op、handshake off 收帧零变更、cli 单发成功→ready、restart 复位后新帧再 ready、exit-before-ready 行为不变的用例
  - 完成态：core 包测试全绿，仓内无任何 ReadinessProbe / probe-timeout / probe-failed 残留引用（grep 为证，剥注释）
  - _Depends: 3.1_
  - _Requirements: 3.2, 3.3, 4.5, 8.3_

- [x] 3.3 真实子进程集成测试（根因级验证）
  - 改造 `packages/core/test/session/readiness.it.test.ts`：真 runner spawn 后立即发 getCommands 须得到响应（证早写行不丢，Req 1.1）；ready 帧在真实启动后到达且 lifecycle 变 ready、时延显著小于旧重发拍（Req 2.5）
  - 完成态：it 档全绿且包含「spawn 后立即写入」用例
  - _Depends: 2.3, 3.1_
  - _Requirements: 1.1, 2.5, 8.1_

- [x] 4. app 装配层适配
- [x] 4.1 配置链路 rename（env 与调用点）
  - `lib/app/readiness-config.ts`：readinessProbeTimeoutFromEnv → readyTimeoutFromEnv，env 改 PI_WEB_READY_TIMEOUT_MS（解析规则不变：正整数，非法回退默认）
  - `lib/app/pi-handler.ts` 调用点同步；`test/readiness-config.test.ts` 随 rename 改造
  - 完成态：仓内无 PI_WEB_READINESS_PROBE_TIMEOUT_MS 残留（grep 为证）；readiness-config 测试绿
  - _Depends: 3.1_
  - _Requirements: 3.3, 4.2_

- [x] 4.2 (P) stub agent 主动发帧（去搭车化）
  - `lib/app/stub-agent-process.mjs`：启动可应答后主动发 slash_completions/agent_routes 装配帧 + runner_ready 帧；删除 get_commands 搭车发射逻辑；get_commands 应答本身保留
  - 完成态：直接跑 stub 进程断言其 stdout 在未收到任何命令的前提下输出 runner_ready 帧与装配帧各一行（与 core 侧改造解耦；端到端 ready 验证归 5.1）
  - _Depends: 1.1_
  - _Requirements: 2.1, 8.3_
  - _Boundary: stub-agent — `lib/app/stub-agent-process.mjs`_

- [x] 5. 集成验证与证据
- [x] 5.1 存量测试面适配与全绿
  - 5 个 runner it 档（attachment-catalog/profile 系列 subprocess it）readinessProbeTimeoutMs → readyTimeoutMs
  - 根 vitest + 各子包测试面全部跑绿（含 e2e:node stub 面）；核对汇总行算术（passed+skipped=总数，防 worker 崩溃假绿）
  - 完成态：全测试面绿的完整输出证据
  - _Depends: 3.2, 3.3, 4.1, 4.2_
  - _Requirements: 3.3, 8.3_

- [x] 5.2 时延证据与已知未验记录
  - dev 真机日志对比改造前后 spawn→ready 时间线（改造前基线 4111ms 含 ~910ms 重发拍等待）；确认 ready 不再落在整秒重发拍上
  - 核验前端契约零变化：session-status 帧结构/粘性回放/gateUntilReady 行为（前端零代码改动，7.1/7.2/7.4）
  - 在本文件 Implementation Notes 显式记录 e2b/ACS 真沙箱 ready 帧可达性为已知未验（6.3 经既有通道的设计断言 + 6.4）
  - 完成态：时间线对比数据落盘（本文件 Implementation Notes），已知未验条目落盘
  - _Depends: 5.1_
  - _Requirements: 2.5, 6.3, 6.4, 7.1, 7.2, 7.4, 8.4_

## Implementation Notes
<!-- 执行期追加：learnings / 时延对比数据 / 已知未验清单 -->

### 时延对比（2026-07-30 dev 真机，Req 8.4）

| 指标 | 改造前（探针+重发） | 改造后（ready 帧） |
|---|---|---|
| spawn→ready | 4111 ms | 3494 / 3511 / 3563 ms（三会话） |
| 进入 rpc mode→ready | 910 ms（ready 恰落 spawn+4×1000ms 重发拍后 111ms —— 拍等待伪延迟） | 888 / 892 / 905 ms（= runRpcMode 内部真实初始化耗时，ready 时刻即 pi 读取器挂载即刻，**无整秒对齐指纹**） |
| 兜底触发 | —— | 0 次（`stdin-resume-gate fallback` 诊断行零出现 = 判据路径工作） |

真机核验：custom 3 会话 + cli 1 会话（`pi --mode rpc` 形态）全部 ready；迟到 SSE 订阅回放粘性 `session-status{ready}`（7.1）。

### 存量红（与本特性无关，判别实验证实）

- `e2e:node` 6 档：HEAD 基线即红（runnerBootstrapPath 解析到已迁移的 `packages/server/src/runner/runner.ts`，core-extraction 分支存量）。判别：基线 7 红/22 用例 vs 改后 6 红/17 用例，**新红集合为空**，`webext-build-load` 反由红转绿。
- `test:app` 1 档：`chat-app-logs-wiring.test.tsx` OOM 崩，基线同崩（记忆库已有前科的存量档）。
- `desktop`：cargo build 缺 `binaries/node-aarch64-apple-darwin` sidecar（worktree 环境性缺失），typecheck/test 均因此拦断，与本特性零交集。

### 已知未验（Req 6.4）

- **e2b/ACS 真沙箱下 ready 帧经传输逐行转发的可达性**：设计断言其沿既有上行通道（PiRpcSession.onLine）到达，本期无真沙箱环境未实证。旧 runner 镜像（不发帧）× 新 server 的表现 = 看门狗 `error{ready-frame-missing}`（可观测非悬挂），沙箱基座重烘焙后须真机验一次。
- 旧 server × 新 runner：ready 帧被放行丢弃、探针照常 —— 前向兼容（推理，未实测双版本组合）。

### Learnings

- **档 C（workflow/ultracode）在链式依赖任务上的编排缺陷**：隔离 worktree 基于 origin/main（非当前分支）创建，且任务产物滞留各自 worktree 不传递 → 依赖链断裂（2.2/2.3 连环 blocked）。对抗复查抓到的「2.1 单独落地 = 中间态死锁」（TASK_DECOMPOSITION_PROBLEM）判定正确，最终 2.1+2.2+2.3 在主上下文原子落地。
- **cli 模式 restart 后需重新单发**：设计初稿遗漏，readiness.it 真实重生用例抓红后补 `startCliReadinessIfApplicable()` 复用（构造期 + handleRunnerRestarted 两处触发）。
- **runner it 档「全帧过协议 schema」白名单**是新增 runner 上行帧的必经门：`runner_ready` 须加入 `validateFrame` 联合（runner.it.test.ts），这也是「真 runner 确实发出了帧」的第一现场证据。
- stub 装配帧原搭车 get_commands 探针发射 —— 删探针必须连带 stub 去搭车化，否则 stub e2e 的 slash 补全静默消失。
