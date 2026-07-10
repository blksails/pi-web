# 双向共享 State（context 外状态路线）· 设计讨论稿

> ⚠️ **2026-06-30 重大更正**：本稿 §4「API 草案」中的 `ctx.state.define/get/set`、
> `createSharedState(ctx, …)` 等是基于一份**虚构的 pi API** 写的 —— 已核实真实事实源
> （`@earendil-works/pi-coding-agent@0.79.6` 的 `dist/core/extensions/types.d.ts`）：pi **没有**
> 原生 `ctx.state`/`StateStore`/`__hostPlugins`/`definePlugin`。pi 原生的「context 外状态」只有
> append-only 的 `pi.appendEntry(customType, data)`（不喂 LLM 的持久化日志），**不是**实时可变
> 共享 KV。正确做法：pi-web 在 agent 子进程**自建**可变可订阅 KV，经既有注入手段
> （`forcedExtensionPaths` / runner 装配）装入，工具接入点经 globalThis seam 透出，agent→UI 经
> `pi-session.handleRawLine` 截获自定义 JSONL 行转 `control:"state"` 帧，UI→agent 复用既有命令通道。
> 权威的需求与设计以 `.kiro/specs/state-injection-bridge/` 为准；§2「现状验证」与 §5/§6 关于
> **传输与约束**的结论仍然成立，仅 §4 的 agent 侧 API 形态需按上述真实机制改写。

> 状态：pre-spec 讨论稿（未走 kiro）。目标是把「插件 / webext 扩展与一条独立于 LLM
> 对话历史之外的 state 交互」这件事的**现状边界**与**可行设计**钉清楚，再决定是否落正式 spec。

## 1. 目标

开发插件 / webext 扩展时，需要一条 **context 外的状态路线**：

- **工具能读取状态**：tool `execute` 时能拿到一份运行时 state。
- **UI 能交互修改状态**：用户在前端改 state（点按钮、填表单、拖滑块…）。
- **独立于 LLM context**：这份 state 不进对话消息历史，不消耗 token，不被模型「看见」（除非显式喂入）。

一句话：一个 **agent ↔ UI 双向、可读写、响应式的共享 state store**。

## 2. 现状验证（已实现到哪 / 边界在哪）

结论：**已有「context 外状态路线」的一半 —— 单向 push + 一次性交互回包；缺「工具读取持久共享 state」那一半。**

### 2.1 已有 · Ambient UI State（agent → UI 单向推送）

`ctx.ui.*` 9 个方法，全部是 **agent → UI** 方向（`packages/protocol/src/rpc/extension-ui.ts:15-81`）：

| 类别 | 方法 | 行为 | 落点 |
| --- | --- | --- | --- |
| 推送类（5，无回包） | `notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text` | 写前端 ambient 快照 | `ControlStore.ambient`（`packages/react/src/sse/control-store.ts:61-73, 232-269`） |
| 交互类（4，阻塞回包） | `select` / `confirm` / `input` / `editor` | 弹交互 → 一次性回包给工具 | `extensionUiQueue`（FIFO） |

前端经 `useExtensionUI()` 只读消费 ambient（`packages/react/src/hooks/use-extension-ui.ts:29-43, 73-79`）。

**关键约束**：`RpcExtensionUIRequest` 的 schema 是 **pi 原生派生**（对齐 pi 0.79.x 的
`rpc-types.d.ts`，见文件头注释）。这 9 个方法**不是 pi-web 能单方面增删的** —— 想加
`ctx.ui.getState()` 这类新方法，受 pi SDK 协议约束。

### 2.2 已有 · ui-rpc / ui-command（UI → agent，请求-响应）

pi-web **自有协议**（不依赖 pi 的 extension_ui）：

- 协议：`packages/protocol/src/web-ext/ui-rpc.ts` —— `point` 封闭枚举
  （`slash`/`mention`/`autocomplete`/`inlineComplete`/`command`），`action` 封闭枚举
  （`list`/`resolve`/`execute`/`complete`），但 `payload`/`result` 是 `z.unknown()`（自由）。
- 端点：`POST /sessions/:id/ui-rpc` → `session.handleUiRpc`；
  `POST /sessions/:id/ui-command` → `session.handleUiCommand`
  （`packages/server/src/web-ext/command-routes.ts:55-95`）。
- 转发：`session.handleUiRpc` → `proc.requestUiRpc` →
  `sendCustomRequest("ui-rpc", req)`，**经 pi JSONL 通道发 custom method 并同步等回包**，
  结果走 HTTP 200 响应体（`packages/server/src/runner/pi-rpc-process.ts:470-482`）。
  这与 memory「统一命令分离层」一致：host 命令走**同步 HTTP 响应体**，不走 SSE 空闲控制流。
- webext 侧入口：`WebExtHostContext.rpc: UiRpcClient`（`packages/web-kit/src/host-context.ts:13`）。

**`command` point 是通用逃生舱**：`point="command"` + `payload={ commandId, ... }` 已能承载任意
「UI→agent 命令」。

### 2.3 根本约束（决定整个设计形状）

`packages/server/src/runner/runner.ts:9-10` 注释点破：

> 「agent 子进程内处理 ui-rpc/ui-command 的逻辑在 **pi SDK 的 runRpcMode 或 stub**。」

进程边界与 pi JSONL 协议的方向性：

```
browser (React)            server (pi-web 完全掌控)        agent 子进程 (pi SDK runRpcMode)
   │   REST + SSE (自有)       │      pi JSONL 通道            │
   │◀────────────────────────▶│◀────────────────────────────▶│
                              server→agent: response / custom request(ui-rpc,ui-command)
                              agent→server: event / response / extension_ui_request(9 方法)
```

**致命点**：`agent → server` 方向只有 `event` / `response` / `extension_ui_request` 三类，
**工具无法主动发起一个「向 server/UI 同步 pull state」的 custom request**。

> 推论：**「工具读取状态」只有当 state 的权威副本在 agent 子进程内时才成立**（工具读自己
> 进程的变量，同步、零延迟）。若 state 权威在 UI 或 server，工具就只能靠「每轮注入」拿到它，
> 那等于进了 context —— 违背「context 外」初衷。

## 3. 设计方向：agent 持权威 + server 镜像 + UI 响应式视图

```
        ┌──────────────── 权威 state ────────────────┐
        │  agent 子进程：const state = createSharedState({...})  │
        │  · 工具 execute(ctx) 同步读：ctx.state.get()          │  ← 满足「工具读取状态」
        └───────────────────────────────────────────┘
              │ 变更广播(push)              ▲ 写回(command)
              ▼                            │
        ┌──────────── server 镜像 ────────────┐
        │  per-session StateStore（内存 + 可选落盘）│  ← REST 查询 / 历史恢复 / 落库
        └───────────────────────────────────┘
              │ control:"state" 帧(SSE)     ▲ POST /ui-command (HTTP)
              ▼                            │
        ┌──────────── UI 响应式视图 ───────────┐
        │  useExtensionState() → { state, setState } │  ← 满足「UI 交互修改」
        └───────────────────────────────────┘
```

三条边：

1. **工具读（同步）**：state 权威在 agent 进程，`ctx.state.get(key)` 直接读闭包变量。零跨进程。
2. **UI 写**：`setState` → `POST /sessions/:id/ui-command`（复用现有 `command` 逃生舱）→
   agent 侧 handler 改权威 state → 触发广播。**无需改 pi 协议**。
3. **agent → UI 广播 + server 镜像**：state 变更时 push 一份结构化快照给 UI，同时 server 截留为镜像。
   ← **这条是当前唯一缺的原语**（见 §5）。

## 4. API 草案

### 4.1 agent 侧（index.ts）

```ts
export default defineAgent({
  async setup(ctx) {
    // 声明一块 context 外的共享 state（权威在本进程）
    const counter = ctx.state.define("counter", { value: 0 });   // 见 §5 接线
    // 或独立 helper：const counter = createSharedState(ctx, "counter", { value: 0 });

    ctx.registerTool({
      name: "increment",
      parameters: { type: "object", properties: {} },
      async execute() {
        counter.set({ value: counter.get().value + 1 });   // 同步读写，自动广播
        return { content: `now ${counter.get().value}` };
      },
    });
  },
});
```

### 4.2 webext 侧（.pi/web/web.config.tsx）

```tsx
import { useExtensionState } from "@blksails/pi-web-kit";

function Counter() {
  const [state, setState] = useExtensionState<{ value: number }>("counter");
  return (
    <button onClick={() => setState({ value: (state?.value ?? 0) + 1 })}>
      {state?.value ?? 0}
    </button>
  );
}
```

`useExtensionState(key)`：订阅 `control:"state"` 帧的对应 key 切片，`setState` 内部走
`rpc.request({ point: "command", action: "execute", payload: { commandId: "state.set", key, value } })`
（或新增 `ui-command` 的 `state` 命名空间）。

## 5. 唯一缺口：agent → UI 推送「结构化 state 快照」

现有 push 方法只携带文本（`setStatus: string` / `setWidget: string[]`），且 schema 受 pi 约束。
三个候选，按「干净度 / pi 依赖」权衡：

| 方案 | 机制 | pi SDK 依赖 | 评价 |
| --- | --- | --- | --- |
| **A. setWidget 夹带 JSON** | agent 用 `ctx.ui.setWidget("__state:counter__", [JSON.stringify(v)])`，server 拦截特殊 key 提取为结构化 state，发 `control:"state"` 帧 | 无（全用现有原语） | 能立刻落地、零 pi 改动；但 key 约定 hack，文本通道夹结构化数据不优雅 |
| **B. 自定义 event 翻译** | agent 发一个 pi-web 约定的 `event`（agent→server 合法方向），server 识别后转 `control:"state"` 帧 + 写镜像 | 取决于 pi SDK 是否允许 agent 发自定义 event；不进 message 流 | 比 A 干净；需确认 pi 的 event 自定义能力 |
| **C. 新 push 方法** | pi SDK 在 extension_ui 加 `setState` 方法 | 需 pi SDK 上游改 | 最干净，但跨仓、周期长 |

> 建议：**先用 A 打通端到端闭环并写 e2e**（证明三条边都通），同时向 pi SDK 求证 B/C 的可行性，
> 把「文本夹带」收敛到一个 pi-web 内部约定层，对 agent/webext 作者暴露的始终是 §4 的干净 API。

server 镜像（`control:"state"` 帧 + StateStore）这一段是 **pi-web 完全自有**，不受 pi 约束，可直接做：

- 新增 `ControlPayloadSchema` 分支 `control:"state"`：`{ key, value, rev }`（rev 单调递增防乱序）。
- `ControlStore` 增 `states: Record<string, { value, rev }>` 切片 + setter（对齐现有 ambient 写法）。
- 新增 `useExtensionState` hook（对齐 `useExtensionUI`）。

## 6. 与 context 的关系（为什么是「context 外」）

- state 不进 `UIMessage` / 不走 data-part（data-part 会进消息历史 → 进 context）。
- state 只在 agent 进程内存 + server 镜像 + SSE 帧之间流转。
- 若某轮需要让模型「看到」state，由 agent 在 prompt 组装时**显式**塞入（opt-in），默认不喂。

## 7. 开放问题 / 待决策

1. **state 权威位置**：确认采用「agent 进程权威」（本稿主张），还是接受「server 权威 + 每轮注入工具」
   的折中（后者工具读的是快照而非实时，但 server 可独立落盘 / 多端一致）。
2. **§5 推送方案**：A（立即）vs B（需验证 pi event 自定义）vs C（需 pi SDK 上游）。
3. **持久化**：state 是否随会话落盘、冷恢复（复用 session-list / attachment 的落盘惯例）？
4. **多端一致**：同一会话多个浏览器 tab 同时改 state 的并发与 rev 冲突策略。
5. **权限边界**：webext 改 state 是否需门控（对齐 webext 签名/白名单信任模型）。

## 8. 验证策略（落 spec 时）

- 协议层：`control:"state"` 帧 + StateStore 纯函数单测。
- React 层：`useExtensionState` 的订阅/写回 hook 单测（对齐 `use-extension-ui` 现有测试）。
- 端到端：`PI_WEB_STUB_AGENT=1` 离线 e2e —— 工具改 state → UI 帧更新；UI 点击 → ui-command →
  工具下次 `get()` 读到新值（双向闭环，隔离 `NEXT_DIST_DIR=.next-e2e`）。

## 9. 相关

- 10 Web UI 扩展（5-tier）`docs/product/12-web-ui-extension.md`
- 13 HTTP/SSE API `docs/product/24-http-api-reference.md`
- 统一命令分离层（memory：`unified-command-result-layer`）
- 现有 ambient 实现：`.kiro/specs/extension-ui-surfaces/`
