# Design Document — unified-command-result-layer

## 概述

把命令的「声明 / 分派 / 执行 / 结果回流 / 渲染」解耦，建在**现成的 Tier3 ui-rpc 底座**上（`point/action` + `control:ui-rpc` 回流 + correlationId 配对 + 超时/取消）。核心新增是一条 **host 侧命令执行通道**（决策 A）：服务端拦截 `point="command"` 且命令名属于已注册 host 命令时，**在服务端执行并直接合成 `control:ui-rpc` 结果帧回流**（不转 agent）；其余 `point` / 非 host 命令保持既有路径。`ctx.ui.custom` 经 `point="custom"` 复用同一回流帧 + 前端注册式渲染。

迁移 `/plugin` 从 `onBuiltinSelect` 直调 REST + `refreshKey` 手动刷新补丁 → 统一命令通道 + 结果事件驱动。

## Boundary Commitments

**本 spec 拥有：**
- 协议：`point="command"` 的 execute 请求/结果 payload 形状；`point="custom"` 的自定义渲染 payload；（不新增顶层 control 类型，复用 `control:"ui-rpc"`）。
- 服务端：host 命令注册表（`HostCommandRegistry`）+ `PiSession.emitUiRpcResponse()`（合成回流帧）+ ui-rpc handler 对 `point:command` 的 host 拦截分派。
- 前端：统一命令客户端（`executeCommand` 经 ui-rpc bus）+ 命令结果订阅 + `point:custom` 注册式渲染 + 命令面板数据驱动分派。
- 迁移：`/plugin` host 命令执行器 + chat-app 接线（移除直调 REST/refreshKey）。

**不拥有（依赖/外部）：**
- agent 命令的执行（仍由 agent / LLM 处理）。
- pi SDK 在 rpc-mode 把 `ctx.ui.custom` 桥成 ui-rpc 请求（**上游外部依赖**）；web 侧提供接收/渲染 + 声明式兜底。
- extension-management 的安装治理实现（复用既有 store/manager/piCli/allowlist/adminPolicy）。
- marketplace（排除）。

**触发下游重验的变更：** ui-rpc payload 结构变更、`RpcSlashCommand` 结构变更、`/plugin` 行为变更。

## 架构

```
 命令来源                          统一分派(前端)              通道/执行                      回流/渲染
┌────────────┐   选中/键入回车   ┌──────────────────┐  point=command  ┌───────────────────┐
│ 命令面板    │ ───────────────▶ │ dispatchCommand  │ ──action=execute▶│ POST /ui-rpc      │
│ (键入/选中) │   source=builtin │ (数据驱动,按 spec)│                  │   makeUiRpcHandler│
└────────────┘                  └──────────────────┘                  └─────────┬─────────┘
                                          │                                      │ host 命令?
                                          │ executeCommand(name,args)            ├─是→ HostCommandRegistry.exec
                                          ▼ (ui-rpc bus, Promise by id)          │      → session.emitUiRpcResponse
┌────────────┐                  ┌──────────────────┐                            └─否→ session.uiRpc(转 agent)
│ ctx.ui.    │ point=custom 帧  │ 结果订阅          │ ◀── SSE control:ui-rpc ────────────┘
│ custom(工具)│ ───────────────▶│ onUiRpcResponse  │     { correlationId, ok, result|error }
└────────────┘                  └────────┬─────────┘
                                         ▼
                          ┌───────────────────────────────┐
                          │ 结果分流渲染                   │
                          │ - command result → 面板/通知刷新│
                          │ - custom → 注册式组件渲染       │
                          └───────────────────────────────┘
```

## 组件与接口

### 1. 协议（packages/protocol）

`point`/`action` 已含 `command`/`execute`、`custom`。新增（纯类型，payload 细化，向后兼容）：

```ts
// web-ext/command.ts（新增）
export const CommandExecutePayloadSchema = z.object({
  name: z.string().min(1),
  /** 原始参数串(命令名之后),由服务端解析;或结构化 args。 */
  argv: z.string().optional(),
});
export type CommandExecutePayload = z.infer<typeof CommandExecutePayloadSchema>;

/** host 命令结果(ui-rpc response.result 的一种形状)。 */
export const CommandResultSchema = z.object({
  command: z.string(),
  /** UI 渲染意图:刷新面板/通知/打开面板等(数据驱动,不含组件)。 */
  effect: z.enum(["panel-refresh", "notify", "open-panel", "none"]).optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;
```

不改 `UiRpcRequest/Response/ControlPayload`（payload/result 仍为 unknown，新 schema 在消费侧细化）→ 满足 Req 7.1。

### 2. 服务端（packages/server）

**`PiSession.emitUiRpcResponse(response: UiRpcResponse): void`**（新增）— 复用 `this.emitter.emit(FRAME_EVENT, makeControlFrame({ control:"ui-rpc", response }))`，让服务端可主动合成回流帧（与 handleRawLine 的 agent 回流同形）。

**`HostCommandRegistry`**（新增，`packages/server/src/commands/host-command-registry.ts`）：
```ts
export interface HostCommandContext {
  readonly session: PiSession;
  readonly argv: string;        // 命令名之后的原始串
}
export interface HostCommandHandler {
  readonly name: string;
  execute(ctx: HostCommandContext): Promise<CommandResult>;
}
export interface HostCommandRegistry {
  has(name: string): boolean;
  execute(name: string, ctx: HostCommandContext): Promise<CommandResult>;
}
export function createHostCommandRegistry(handlers: HostCommandHandler[]): HostCommandRegistry;
```

**ui-rpc handler 拦截**（`makeUiRpcHandler` 增强或新增 `makeCommandAwareUiRpcHandler(store, registry)`）：
- 解析 body=UiRpcRequest；IF `point==="command" && action==="execute"` 且 `registry.has(name)` → `registry.execute(name, {session, argv})` → `session.emitUiRpcResponse({correlationId, ok:true, result})`（失败 → `ok:false, error`）→ 返回 ack。
- ELSE → 既有 `session.uiRpc(request)`（转 agent）→ ack。
- 解析命令名/argv：payload 经 `CommandExecutePayloadSchema`。

### 3. host 命令执行器：`/plugin`（lib/app）

`createPluginHostCommand(deps)`（`lib/app/plugin-command/plugin-host-command.ts`）实现 `HostCommandHandler`，name="plugin"，复用 extension-management（store/manager/piCli/allowlist/adminPolicy）+ SessionReloader：
- argv 解析子命令：`""`/`list` → effect:"open-panel"/"panel-refresh"（带 data=列表）;`install <源>` → 安装 + reload → effect:"panel-refresh";`uninstall <名>` → 卸载 + reload → effect:"panel-refresh";错误 → 抛出（handler 包成 ok:false）。
- 在 pi-handler 注入：`createHostCommandRegistry([ createPluginHostCommand({...}) ])` 传给 ui-rpc handler。

### 4. 前端统一命令客户端（packages/react）

复用 `createUiRpcBus`。新增 `executeCommand`（薄封装）：
```ts
// 经既有 bus.request({ point:"command", action:"execute", payload:{name, argv} })
// 返回 UiRpcResponse(含 CommandResult);Promise 由 correlationId 配对(pending/success/error 天然可观测)。
```

### 5. UI 数据驱动分派 + 结果渲染（packages/ui）

- `PiCommandPalette.select`：`source==="builtin"` 时不再回调 bespoke `onBuiltinSelect` 直调，而是 `onCommandExecute(cmd, argv)`（注入的统一执行回调）。键入完整命令回车（pi-chat onSubmit 拦截）同样走 `onCommandExecute`。
- 命令结果渲染：host 命令结果按 `effect` 驱动（open-panel/panel-refresh/notify）。`notify` 复用 ambient notifications；面板刷新由结果事件触发（非 refreshKey）。

### 6. 迁移接线（components/chat-app + lib/app）

- chat-app：构造 ui-rpc bus（若 controls 未提供则用 createPiClient 的 ui-rpc send + ControlStore.onUiRpcResponse 订阅）→ `executeCommand`。`onCommandExecute("plugin", argv)` 替代 `onBuiltinSelect` 的 if-else/REST/nonce。
- PluginPanel：列表刷新改由命令结果（effect:panel-refresh，data 含列表）或订阅驱动；**移除 `refreshKey` 补丁**与直调安装/卸载（面板内安装按钮也走 `executeCommand("plugin","install <源>")`）。

## File Structure Plan

| 文件 | 动作 | 责任 |
|---|---|---|
| `packages/protocol/src/web-ext/command.ts` | 新增 | CommandExecutePayload / CommandResult schema |
| `packages/protocol/src/index.ts` | 改 | 导出上述 |
| `packages/server/src/session/pi-session.ts` | 改 | `emitUiRpcResponse()` |
| `packages/server/src/commands/host-command-registry.ts` | 新增 | HostCommandRegistry + 类型 |
| `packages/server/src/http/routes/command-routes.ts` | 改 | ui-rpc handler 的 host 命令拦截分派 |
| `packages/server/src/index.ts` | 改 | 导出 registry/类型 |
| `lib/app/plugin-command/plugin-host-command.ts` | 新增 | `/plugin` host 执行器（复用 extension-management） |
| `lib/app/pi-handler.ts` | 改 | 注入 HostCommandRegistry 给 ui-rpc handler |
| `packages/react/src/web-ext/command-client.ts` | 新增 | `executeCommand` + custom 订阅 |
| `packages/react/src/index.ts` | 改 | 导出 |
| `packages/ui/src/controls/pi-command-palette.tsx` | 改 | `onCommandExecute` 数据驱动分派（替代 bespoke） |
| `packages/ui/src/chat/pi-chat.tsx` | 改 | onSubmit/select 经 onCommandExecute |
| `packages/ui/src/web-ext/custom-ui-renderer.tsx` | 新增 | 注册式 custom 渲染 |
| `components/chat-app.tsx` | 改 | 接线 executeCommand;迁移 /plugin;移除 refreshKey/直调 |
| `components/plugin-panel.tsx` | 改 | 结果事件驱动刷新;面板安装走 executeCommand;移除 refreshKey |

## Testing Strategy

**单元（vitest）：**
- host-command-registry：has/execute/未注册/抛错包装。
- plugin-host-command：argv 解析（install/uninstall/list/空）→ effect/调用 extension-management（mock）。
- command-routes 拦截：point:command+host 命令 → 走 registry + emitUiRpcResponse；非 host → uiRpc 转发；agent 命令路径不变。
- command-client：executeCommand 经 bus 配对结果；custom payload 解析。
- emitUiRpcResponse：合成 control:ui-rpc 帧广播。

**浏览器 e2e（playwright，external server）：**
- 迁移不回归：现有 plugin-command + slash-command-palette 全绿。
- 统一通道：键入 `/plugin install local:..`（或选中）→ **无 /messages**（不进 LLM）→ control:ui-rpc 结果回流 → 面板列表显示（事件驱动，非 refreshKey）。
- 错误态：安装非法源 → ok:false → 面板错误反馈。
- custom：注入 point:custom 帧（stub）→ 注册组件渲染；未注册名 → 降级不崩。

## 关键约束落地
- host 命令绝不进 LLM：分派只走 ui-rpc command 通道，断言无 /messages（Req 2）。
- 执行按归属：host=server（registry）、agent=agent（uiRpc 转发不变）、custom=工具推（Req 1.4/7.2）。
- 向后兼容：仅新增可选 payload schema + 新 handler 分支，既有 ui-rpc/agent 路径不变（Req 7）。
- dev 改注入路由需重启；e2e 用 NEXT_DIST_DIR=.next-e2e external server（Req 8）。
