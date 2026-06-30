# Research Log — state-injection-bridge

> 语言：zh-CN。本文件记录发现与决策依据；design.md 自洽，本文件仅供背景追溯。

## 发现范围

Extension（扩展既有 pi-web）。聚焦集成点：pi 0.79.6 真实能力面、agent↔server JSONL 通道方向性、既有 wiring/注入/seam 范式、SSE control 帧链路、前端 ControlStore。

## 关键发现 0 —— 纠偏：早期前提建立在虚构 pi API 上（最高优先级）

- **事实**：`/Users/hysios/Projects/BlackSail/agents/pi` 目录不存在（`ls`/`test -d` 双验）。pi 是 npm 依赖 `@earendil-works/pi-coding-agent@0.79.6`，真实事实源 = `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.79.6_*/.../dist/**/*.d.ts`。
- **证伪**：穷尽 grep 全部 dist `.d.ts` 后确认 pi **没有** `ctx.state`/`StateStore`（可订阅可变 KV）、`RuntimeContext` 接口、`__hostPlugins`/`definePlugin`/`loadPlugins`、`runRpcAgent`。早期会话「读到」的 `pi/src/*` 文件是被篡改的虚构内容。
- **影响**：requirements 已据真实能力面重写（R1「pi-web 自建 KV」而非「pi 原生 ctx.state」；R2「pi-web 既有注入手段」而非「__hostPlugins」）。

## 关键发现 1 —— pi 0.79.6 真实能力面

来源：`dist/core/extensions/types.d.ts`、`dist/core/agent-session-runtime.d.ts`、`dist/modes/rpc/*.d.ts`。

- `ExtensionContext`（工具/handler 的 `ctx`）：`ui`(ExtensionUIContext)、`mode`、`hasUI`、`cwd`、`sessionManager`(只读)、`model`、`isIdle()`、`signal`、`abort()` 等。**无 state 成员**。
- `ExtensionAPI`（注册对象 `pi`）：`registerTool`、`registerCommand`、`registerMessageRenderer`、`sendMessage`、`sendUserMessage`、`appendEntry<T>(customType, data)`（注释「for state persistence (not sent to LLM)」—— append-only，非可变 KV）、`setActiveTools` 等。
- `createAgentSessionRuntime(factory,{cwd,agentDir,sessionManager})` → `AgentSessionRuntime`，只暴露 `.session`/`.services`/`.cwd`/`.diagnostics`。入口 `runRpcMode(runtimeHost)`（**仅收 runtime，无 stdin/stdout 注入**）。

## 关键发现 2 —— JSONL 通道方向性（决定状态权威位置）

- **agent→server**（`pi-rpc-process.ts:473`）：仅 `response`/`extension_ui_request`/`event` 被分派；未知 `type` → 仅诊断，不转发。
- **但** `pi-session.ts:405 handleRawLine` **已在**截获一种约定的原始行 `{"type":"ui_rpc_response",...}` → 合成 `control:"ui-rpc"` 帧。**这是 agent→UI 推任意结构化数据的现成接缝** —— 加一个 `piweb_state` 分支即可下行状态帧，无需改 pi。
- **server→agent**（`pi-session.ts:518` `channel.send`）：pi 的 `runRpcMode` 用 `attachJsonlLineReader(process.stdin, handleInputLine)` 读 stdin；`handleInputLine`（`rpc-mode.js:563`）只识别 `extension_ui_response`，其余按 `RpcCommand`（**固定封闭联合** prompt/steer/.../get_commands，**无 ui_rpc**）处理，未知 type → 回 `error("Unknown command")`。
- **推论**：`session.uiRpc` 发的 `{type:"ui_rpc"}` 在**真实 agent 无消费者**（`examples/webext-contrib-agent/index.ts:4` 注明「真实 pi agent 的 ui_rpc handler 见 spec 设计待决项」，e2e 靠 stub 应答）。故状态权威必须在子进程；UI→agent 写回不能依赖 pi 既有命令通道直达。

## 关键发现 3 —— 写回（UI→agent）的真实可行机制

- `attachJsonlLineReader`（`jsonl.js:18`）仅 `stream.on("data", onData)`，**不独占 stdin**、不 setEncoding。
- **决策**：runner 在调用 `runRpcMode` **之前**给 `process.stdin` 挂**第二个**自有 JSONL reader，截获约定的写回行 `{"type":"piweb_state_set",...}` → 直接改子进程内 KV → 触发下行帧。pi 的 reader 也会看到该行并回一条 `Unknown command: piweb_state_set` 的 `response`（id=undefined，server 端无 pending → 丢弃，无害噪声）。
- 这条路径**真实、无需改 pi**，恰为 state 用例解决了 webext-contrib 搁置的 ui_rpc-handler 难题（范围限定在 state，不展开成通用 ui_rpc 真实 handler）。

## 关键发现 4 —— 可复用范式（build-vs-adopt：全部 adopt 既有 pi-web 范式）

| 关注点 | 复用范式 | 出处 |
| --- | --- | --- |
| 子进程装配 hook | `wireAttachmentBridge` / `wireSessionTitlePersistence` | `runner/attachment-wiring.ts`、`runner/session-title-wiring.ts` |
| 工具接入点透出 | globalThis seam（`__piWebAttachmentToolContext__`） | `runner/attachment-wiring.ts:60` |
| 扩展强制注入 | `forcedExtensionPaths` | `auto-session-title`（memory） |
| 优雅降级 | env 缺失/失败 → 能力不可用、不崩 | `wireAttachmentBridge` |
| 自定义行 → control 帧 | `handleRawLine` 截获约定行 | `pi-session.ts:405` |
| control 帧 → 前端切片 | `ControlStore` 不可变快照 + `useSyncExternalStore` | `react/sse/control-store.ts` |
| 同步 HTTP 响应体回流 | host 命令 `client.uiRpcCommand` | `unified-command-result-layer`（memory） |

## 设计综合（Generalization / Build-vs-Adopt / Simplification）

- **Generalization**：状态核抽象为通用 `SessionStateStore`（KV + rev + subscribe），下行帧/写回命令/前端 hook 都按通用 key→value 设计；R1（纲领）是其总用例，R3/R4/R6/R7 是其三条边的视图。
- **Build-vs-Adopt**：状态核必须**自建**（pi 无原生 KV，已证伪）；传输/注入/seam **全部 adopt** 既有 pi-web 范式（见发现 4），不新造传输层。
- **Simplification**：本期不做落盘/冷恢复（仅内存）、不做 CRDT（rev 单调 + 后写覆盖）、不做通用 ui_rpc 真实 handler（只做 state 写回行）。前端状态切片并入既有 `ControlStore`，不另起 store。

## 风险与缓解

- **R-1 stdin 双 reader 噪声**：pi 对 `piweb_state_set` 回 Unknown-command error。缓解：server `handleResponse` 对 id=undefined 的未知 command response 静默丢弃（已是现状）；集成测试断言无 UI 可见副作用。
- **R-2 stdout 行交织**：runner 与 pi 都写 stdout。缓解：runner 只写**完整** `JSON+\n` 行；server 行读按 `\n` 切分（现状）。
- **R-3 真实 agent 写回仅限 state 约定**：不承诺通用 ui_rpc。Boundary 明确。
- **R-4 多 tab 并发写**：rev 单调 + 后写覆盖；不做合并（Out of scope）。
