# Research & Design Decisions — ctx-ui-custom-bridge

## Summary
- **Feature**: `ctx-ui-custom-bridge`
- **Discovery Scope**: Extension（在既有 RPC 桥接 + 翻译层 + 前端渲染器之上补一条断链）
- **Key Findings**:
  - pi SDK 在 RPC 模式下 `ctx.ui.custom()` 是**空操作**（`rpc-mode.js:151-154` 直接 `return undefined`），不发任何帧；`unified-command-result-layer` Req 6.3 把"pi SDK 会桥接 custom"当外部依赖的假设是错的。
  - 前端接收端**已完整实现但成孤儿**：`registerCustomUi`/`CustomUiRenderer`/`CustomUiDataPart` 齐备，且 `pi-chat.tsx:330` 已 `registerDataPartRenderer("data-pi-custom-ui", CustomUiDataPart)`，但协议层 `DataPartSchema`（`transport/data-part.ts`）是封闭的 4 类型联合，**不含 `data-pi-custom-ui`**，故该 data part 从未可被合法送出。
  - pi-web 完全掌控 runner（`runRpcMode` 前的 `startRunner`）与翻译纯函数（`translateEvent`），且 `pi-session.ts` 把 `onEvent` 与 `onExtensionUIRequest` **都**喂进 `translateEvent`——这给了"不改 pi 原码"补全链路的两个落点。

## Research Log

### pi SDK 的 ctx.ui.custom 真实行为（RPC vs TUI）
- **Sources**: `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.79.6_*/.../dist/modes/rpc/rpc-mode.js:82-154`；`dist/modes/interactive/interactive-mode.js:1600-1915`；`dist/core/extensions/types.d.ts:67-191`。
- **Findings**:
  - `custom<T>(factory, options)` 签名：factory 是 `(tui, theme, keybindings, done) => Component`，**TUI 组件工厂，不可跨进程序列化**。
  - RPC 模式：`async custom() { return undefined; }`（空操作）。
  - 同模式下 `notify`/`setStatus`/`setWidget`/`setTitle` 均 `output({ type:"extension_ui_request", method, ... })` 往 stdout 写 JSONL——证明"ambient UI 方法发帧"通路可用，custom 可镜像它。
- **Implications**: 让 `ctx.ui.custom` 真正可用必须由 pi-web 自己在绑定接缝处替换该空实现；约定只传可序列化 `{component, props}`，不传工厂。

### 不改 pi 的注入接缝（bindExtensions / 翻译层）
- **Sources**: `rpc-mode.js:22-285`（`runRpcMode(runtimeHost)` → `rebindSession` → `session.bindExtensions({ uiContext: createExtensionUIContext(), ... })`）；`runner.ts:277-306`；`attachment-wiring.ts:137-200`（既有"构造后委托"范本）；`pi-rpc-process.ts:457-505`；`pi-session.ts`（`onEvent`/`onExtensionUIRequest` 双路喂 `translateEvent`）；`translate-event.ts:334-341`。
- **Findings**:
  - `runRpcMode` 用的 session 来自 pi-web 传入的 `runtime.session`，且每次 `newSession/fork/switchSession` 后 `rebindSession` 会重新 `bindExtensions`，并可能更换 session 对象（`rpc-mode.js:331/452/459`）。
  - `extension_ui_request` 在主进程经 `handleExtensionUIRequest` → `extensionUIListeners`，再由 `pi-session.ts` 的 `onExtensionUIRequest` 回调喂 `translateEvent`，命中 `case "extension_ui_request"` → `control:extension-ui`。notify 等 fire-and-forget 同路（无响应，pending 项留存属既有行为）。
- **Implications**:
  - 子进程侧：覆盖 `uiContext.custom`，需在 `bindExtensions` 接缝拦截；为跨 rebind 稳健，**patch session 类 prototype 的 `bindExtensions`**（一次覆盖所有会话），而非只包一次实例方法。
  - 主进程侧：在 `translateEvent` 的 `extension_ui_request` 分支按 `method==="custom"` 改产 `data-pi-custom-ui` data part（纯函数单点改动，复用前端孤儿渲染器）。

### 前端接收端与协议缺口
- **Sources**: `packages/ui/src/web-ext/custom-ui-renderer.tsx`；`packages/protocol/src/web-ext/command.ts:40`（`CustomUiPayloadSchema={component:string, props?:unknown}`）；`packages/protocol/src/transport/data-part.ts`、`ui-message-chunk.ts`（`UiMessageChunkSchema` 无泛型 `data-${string}` 兜底）。
- **Findings**: 渲染器与注册表就绪，缺的是协议层让 `data-pi-custom-ui` 成为合法 chunk。
- **Implications**: 新增 `CustomUiDataPartSchema` 进 `DataPartSchema` 联合；data 形状与 `CustomUiPayloadSchema` 对齐（component+props）。

## Architecture Pattern Evaluation

| Option | 描述 | 优点 | 风险/限制 | 取舍 |
|--------|------|------|-----------|------|
| **A. delegate（覆盖 uiContext.custom）** | prototype-patch `bindExtensions`，把空 `custom` 换成发 `extension_ui_request{method:custom}` 帧；翻译层产 `data-pi-custom-ui` | 让**字面 `ctx.ui.custom`** 端到端可用（满足 Req 1/4）；复用既有 extension_ui_request + 前端渲染器 | 依赖 pi 内部仍走 `session.bindExtensions`（版本契约，升级需回归）；patch 第三方 prototype | **选定** |
| B. 并行 seam（globalThis 工具上下文，仿 attachment-bridge） | tool-kit 导出 `getWebUiContext().custom()`，绕开 ctx.ui | 与 pi 内部零耦合，最稳 | 不是 `ctx.ui.custom`，不满足 Req 1.1 | 借用其"结构化 payload 约定"思想 |
| C. emitUi 式（onUpdate + tool details 约定） | 复用 `emitUi`/`data-pi-ui` 既有通路，新增 custom details key | 零 pi 改动、已验证、最简 | 仅工具 `execute` 内可用；同样不是 `ctx.ui.custom` | 记录为备选；若未来放宽"必须是 ctx.ui.custom"可切换 |

## Design Decisions

### Decision: 用 delegate（A）实现，payload 走结构化约定
- **Context**: 需求锁定"让 `ctx.ui.custom` 真正可用"（Req 1.1、Req 4），且不改 pi 原码。
- **Alternatives Considered**: A / B / C（见上表）。
- **Selected Approach**: 子进程 prototype-patch `bindExtensions` 覆盖 `uiContext.custom`；agent 经 agent-kit 助手 `customUi(ui, {component, props})` 调用，payload 经 pi `custom(factory, options)` 的 `options` 扩展字段（`__piWebCustomUi`）传入，覆盖实现读取并写 `extension_ui_request{method:"custom", payload}` 帧；翻译层把它转 `data-pi-custom-ui` data part。
- **Rationale**: 唯一能让字面 `ctx.ui.custom` 工作的路；最大化复用既有 extension_ui_request 转发与前端渲染器；改动集中在 pi-web 自有边界。
- **Trade-offs**: 引入对 pi 内部绑定流程的隐式依赖 → 以"version pin + e2e 回归 + Revalidation Trigger"缓释。
- **Follow-up**: e2e 验证跨 newSession/fork/switchSession（rebind 后仍生效）。

### Decision: custom 复用 extension_ui_request 通道而非新增顶层事件
- **Context**: 子进程→主进程需要一种帧。
- **Alternatives**: (1) 复用 `extension_ui_request`（method 加 custom）；(2) 新增顶层 AgentEvent 类型走 `broadcastEvent`。
- **Selected**: (1)。`extension_ui_request` 已有完整转发→`translateEvent` 通路且 notify 证明 fire-and-forget 可行；(2) 需改 pi 原生派生的 AgentEvent 联合且 `broadcastEvent` 校验风险更高。
- **Trade-offs**: 复用 pending 机制会给 custom 留一个永不回收的 pending 项（与 notify 同，既有行为，影响可忽略）。

### Decision: 子进程直接 `process.stdout.write` 单行帧
- **Context**: 覆盖实现拿不到 pi 内部 `output()` 闭包。
- **Selected**: 以单次 `process.stdout.write(JSON.stringify(frame) + "\n")` 写完整 JSONL 行。
- **Rationale**: 同进程同一 stdout 流的多次 `write()` 由 Node 写队列按调用序串行化，单次写整行不会与 pi 自身写交错（JSONL 按 `\n` 严格分行）。`JSON.stringify` 会转义 U+2028/2029，无分行歧义。
- **Follow-up**: 单测断言帧形状与换行；集成测试用真 runner 验证不串行错乱。

## Risks & Mitigations
- **pi 版本升级改变 bindExtensions/uiContext 绑定方式** → version pin `@earendil-works/pi-coding-agent@0.79.6`；e2e 作为回归闸；列入 Revalidation Triggers。
- **prototype-patch 影响同进程其它 session** → 期望行为（一个子进程一个 agent，patch 幂等、仅增强 custom，不改其它方法）；override 仅当 payload 合法时发帧，否则保持 pi 原空操作语义。
- **custom 在无活动 turn 时调用** → data part 需挂到活动 assistant message；约定 custom 于工具 `execute`/对话回合内调用（demo 如此）；无活动消息时由 useChat 决定（可能新建/丢弃），文档注明该约束。
- **demo 组件污染生产** → demo 组件注册置于显式 `registerDemoCustomUi()`，仅 demo/e2e 路径调用，不默认进生产聊天。

## References
- pi SDK: `@earendil-works/pi-coding-agent@0.79.6`（`dist/modes/rpc/rpc-mode.js`、`dist/core/extensions/types.d.ts`）
- 既有委托范本: `packages/server/src/runner/attachment-wiring.ts`
- 翻译纯函数: `packages/server/src/session/translate/translate-event.ts`
- 前端渲染器: `packages/ui/src/web-ext/custom-ui-renderer.tsx`
- 相邻 spec: `.kiro/specs/unified-command-result-layer/`（修正其 Req 6.3 假设）
