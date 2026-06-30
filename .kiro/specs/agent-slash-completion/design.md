# Design Document — agent-slash-completion

## Overview

让 agent(经其声明)运行时携带一组 **静态** slash 补全候选(如 aigc-agent 的 `/img-gen` `/img-edit`),用户敲 `/` 时在补全里看到、选中只把命令填入输入框、补词后走正常消息流交给 LLM(伪命令由 system prompt 驱动 LLM 调对应工具)。本设计在**不改外部 pi SDK** 的前提下,打通"agent 声明 → server 按会话缓存 → completion 暴露 → 前端单浮层呈现"全链路。

设计的关键约束来自 discovery(见 `research.md`):真实 agent 子进程跑 pi SDK 的 `runRpcMode`、stdout 被其掌控,**没有让 agent 运行时应答/推送自定义结构的接缝**(只有 stub 能);唯一不触 pi SDK 的跨进程窗口是 **`runner.ts` 装配期(`runRpcMode` 调用之前)**——此时 stdout 仍由 pi-web 自有子进程代码掌控。本设计据此选定通道。

## Boundary Commitments

**本 spec 拥有(owns):**
- `AgentDefinition.slashCompletions` 声明字段(agent-kit + server mirror)及其经 loader 的透传。
- 一条 agent→server 的**装配期自建 JSONL 帧** `slash_completions`(protocol schema + runner 发送 + PiSession 接收缓存)。
- server 端通用命令补全 provider `agent-slash-provider`(trigger `/`、按会话读缓存)。
- 前端 `/` 单浮层协调(PiCommandPalette 并入伪命令候选 + select 分流)。
- `aigcExtension` 旁的 `aigcSlashCompletions` 候选声明常量与示例 agent 接线。

**不拥有(does NOT own):**
- 命令**执行**通道:host command(决策A,`command-routes.ts:275`)与 extension execute 路径不动。
- 外部 pi SDK(`@earendil-works/*`):零修改。
- LLM 对伪命令的理解:由 system prompt 负责(已具备)。
- agent 运行时双向/可变共享 state:本特性仅装配期单次静态声明。

**允许的依赖:** completion 框架(registry/provider/routes/前端 use-completion)、`PiRpcProcess`/`PiSession` JSONL 管道、runner 装配序列、attachment/title wiring 的 prototype-patch 范式(作参考)。

**触发下游 revalidation 的变化:** 若未来需要"运行时动态变更候选"(非装配期静态),或 pi SDK 提供了真正的 agent ui-rpc handler 接缝——届时本通道(装配期帧)需重估。

## Architecture

```
┌─ agent 子进程 (runner.ts, pi-web 代码) ──────────────────────────┐
│ loadAgentDefinition() ── factory.slashCompletions (静态声明)      │
│        │  装配序列 (createAgentSessionRuntime → wirings)          │
│        ▼  [runRpcMode 之前:stdout 由 pi-web 掌控]                 │
│ emitSlashCompletions(factory):                                    │
│   process.stdout.write({type:"slash_completions", items}\n)       │
│        │                                                          │
│        ▼  runRpcMode(runtime)  ← 此后 stdout 归 pi SDK            │
└────────┼──────────────────────────────────────────────────────── ┘
         │ stdout JSONL
┌─ server 主进程 ─┼───────────────────────────────────────────────┐
│ PiRpcProcess.handleStdout → onLine                               │
│ PiSession.handleRawLine:                                         │
│   if type==="slash_completions" → 缓存 this.slashCompletions     │
│   (置于 active-gate 之前,装配帧早于就绪)                          │
│        │ getSlashCompletions()                                    │
│        ▼                                                          │
│ agent-slash-provider (trigger "/", extract lineStart)            │
│   complete({query,ctx}) → store.get(ctx.sessionId)               │
│                            .getSlashCompletions() → 过滤 → items  │
│        ▲ 注册于 create-handler.ts:79-91                           │
│        │ GET /sessions/:id/completion?trigger=/&q=…               │
└────────┼──────────────────────────────────────────────────────── ┘
         │ HTTP
┌─ 前端 ─┼─────────────────────────────────────────────────────────┐
│ PiCommandPalette (open = value.startsWith("/")):                  │
│   既有: controls.getCommands() → 执行型命令 (RpcSlashCommand)     │
│   新增: client.getCompletion(sid,"/",q) → 伪命令候选 (混排)       │
│   select(): 伪命令 → onChange(insertText) 纯填入(不执行)          │
│             真命令 → 既有执行逻辑                                  │
│   → 用户补词 → onSubmit → doSend(原文) → 正常消息流 → LLM         │
└──────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### C1 — 声明类型与帧(protocol,单一来源)
```typescript
// packages/protocol/src/...(completion 或 transport 域)
export const SlashCompletionDeclSchema = z.object({
  name: z.string().min(1),          // 命令名(无前导 "/"),如 "img-gen"
  description: z.string().optional(),
  insertText: z.string().optional(), // 缺省 = "/" + name + " "
});
export type SlashCompletionDecl = z.infer<typeof SlashCompletionDeclSchema>;

export const SlashCompletionsFrameSchema = z.object({
  type: z.literal("slash_completions"),
  items: z.array(SlashCompletionDeclSchema),
});
```
- `SlashCompletionDecl` 为前端安全纯数据(无函数、无 pi SDK 导入),可被 agent-kit / server / tool-kit 共同引用。
- 帧为 pi-web 自建 agent→server 第四类(与 `ui_rpc_response` 同性质),仅在装配期发一次。

### C2 — AgentDefinition 声明字段
```typescript
// packages/agent-kit/src/types.ts(公开)+ packages/server/src/runner/agent-definition.ts(mirror)
slashCompletions?: SlashCompletionDecl[];
```
- loader(`agent-loader.ts`)规范化时**必须保留** `slashCompletions`(当前 loader 按 SDK 字段结构 duck-type;新增字段需在透传白名单/规范化中显式带上)。这是实现期关键确认点。

### C3 — runner 装配期发送
```typescript
// packages/server/src/runner/slash-completions-wiring.ts(新)
export function emitSlashCompletions(factory: AgentDefinition): void {
  const items = factory.slashCompletions ?? [];
  if (items.length === 0) return;
  process.stdout.write(JSON.stringify({ type: "slash_completions", items }) + "\n");
}
```
- 调用点:`runner.ts` 在 `wireSessionTitlePersistence(...)`(:312)之后、`return runRpcMode(runtime)`(:328)之前。
- 严格单行 JSONL,在 `runRpcMode` 接管 stdout 前写出(R1:需 node e2e 验证不干扰后续 RPC 流)。

### C4 — PiSession 接收与缓存
```typescript
// packages/server/src/session/pi-session.ts
private slashCompletions: SlashCompletionDecl[] = [];
getSlashCompletions(): readonly SlashCompletionDecl[] { return this.slashCompletions; }

// handleRawLine 内,在 `if (this._status !== "active") return` 之前:
const sc = SlashCompletionsFrameSchema.safeParse(parsed);
if (sc.success) { this.slashCompletions = sc.data.items; return; }
```
- 置于 active-gate 之前以避免装配帧被丢(R2)。`onLine` 订阅在构造时(:166)已建立,早于子进程装配写帧,基本无丢失;schema 守卫确保只认本帧。

### C5 — agent-slash 补全 provider
```typescript
// packages/server/src/completion/providers/agent-slash-provider.ts(新)
export function createAgentSlashProvider(
  getSession: (sessionId: string) => { getSlashCompletions(): readonly SlashCompletionDecl[] } | undefined,
): CompletionProvider {
  return {
    id: "agent-slash", trigger: "/", extract: "lineStart", kind: "agent-slash",
    async complete({ query, ctx }) {
      const decls = getSession(ctx.sessionId)?.getSlashCompletions() ?? [];
      return decls
        .filter((d) => d.name.startsWith(query))
        .map((d) => ({
          label: `/${d.name}`,
          insertText: d.insertText ?? `/${d.name} `,
          ...(d.description ? { detail: d.description } : {}),
        }));
    },
  };
}
```
- 注册:`create-handler.ts` 在 :79-91 内置区追加 `completion.register(createAgentSlashProvider((id) => store.get(id)))`(`store` 与 `requireSession` 同源;实现期对齐 store 的取 session API)。
- **per-agent gating 自动成立**:无声明的会话 `getSlashCompletions()` 为空 → 返回空候选(Req4)。

### C6 — 前端 `/` 单浮层协调(方案 i)
- `pi-command-palette.tsx`:`open` 时(value 以 `/` 起)在既有 `controls.getCommands()` 之外,新增 effect 拉 `client.getCompletion(sessionId, "/", queryOf(value))`(参考 `extItems` 范式),把伪命令候选混排进列表(视觉区分:填充态 vs 执行态)。
- `select()` 分流:候选来自 completion(伪命令)→ `onChange(insertText)` **纯填入不执行**;候选为 `RpcSlashCommand`(真命令)→ 走既有执行逻辑(builtin/extension/...)。
- 单浮层规避双 keydown 竞争(discovery F5);`use-completion.accept` 的纯填入语义在此被等价复用。
- 提交:用户补词后 `onSubmit` → 既有三层分流中**未命中执行命令**→ `doSend(原文)`(`pi-chat.tsx:551`)→ 正常消息流。

### C7 — AIGC 候选声明与示例接线
```typescript
// packages/tool-kit/src/aigc/slash-completions.ts(新,纯数据,经 tool-kit 主入口导出,非 /runtime)
export const aigcSlashCompletions: SlashCompletionDecl[] = [
  { name: "img-gen", description: "用提示词生成图像 (image_generation)", insertText: "/img-gen " },
  { name: "img-edit", description: "编辑最近上传的图像 (image_edit)", insertText: "/img-edit " },
];
// examples/aigc-agent/index.ts: defineAgent({ extensions:[aigcExtension], slashCompletions: aigcSlashCompletions, ... })
```

## Data Models

| 模型 | 字段 | 说明 |
|---|---|---|
| `SlashCompletionDecl` | `name` / `description?` / `insertText?` | 声明候选;前端安全纯数据 |
| `slash_completions` 帧 | `type` / `items[]` | 装配期 agent→server 一次性帧 |
| `CompletionItem`(既有) | `label` / `insertText` / `detail?` | provider 输出,前端复用 |

## Error Handling
- 无 `slashCompletions`:runner 不发帧;provider 返回空;palette 行为不变(Req4/R4)。
- 帧解析失败:`safeParse` 守卫,忽略非法帧不影响其它行处理。
- `getCompletion` 失败:palette catch → 伪命令候选置空,不阻塞执行命令与输入(Req2.3)。
- 装配帧干扰 RPC(R1):若 node e2e 发现异常,回退方案=改用独立 fd 或 per-session 文件 seam(同进程边界,不改 pi SDK)。

## File Structure Plan

**新建**
- `packages/protocol/src/<completion>/slash-completion.ts` — `SlashCompletionDecl` + `slash_completions` 帧 schema/类型。
- `packages/server/src/runner/slash-completions-wiring.ts` — `emitSlashCompletions(factory)`。
- `packages/server/src/completion/providers/agent-slash-provider.ts` — `createAgentSlashProvider`。
- `packages/tool-kit/src/aigc/slash-completions.ts` — `aigcSlashCompletions` 常量。

**修改**
- `packages/agent-kit/src/types.ts` — `AgentDefinition.slashCompletions?`。
- `packages/server/src/runner/agent-definition.ts` — mirror 字段。
- `packages/server/src/runner/agent-loader.ts` — 规范化保留 `slashCompletions`。
- `packages/server/src/runner/runner.ts` — `:312` 后调 `emitSlashCompletions(factory)`。
- `packages/server/src/session/pi-session.ts` — 缓存字段 + `handleRawLine` 识别(active-gate 前)+ `getSlashCompletions()`。
- `packages/server/src/http/create-handler.ts` — `:79-91` 注册 agent-slash-provider。
- `packages/tool-kit/src/aigc/index.ts`(及 tool-kit 主入口)— 导出 `aigcSlashCompletions`。
- `examples/aigc-agent/index.ts` — `slashCompletions: aigcSlashCompletions`。
- `packages/ui/src/controls/pi-command-palette.tsx` — 拉 completion + 混排 + select 分流。
- (按需)`packages/react` client — 确保 `getCompletion` 对 palette 可用。

## Testing Strategy

**单元/集成(`pnpm test`)**
- protocol:`SlashCompletionDecl`/帧 schema 解析与默认 `insertText` 推导。
- PiSession:`handleRawLine` 收到 `slash_completions`(在 active 之前到达)→ `getSlashCompletions()` 返回缓存;非法帧被忽略(对应 Req1.2、R2)。
- agent-slash-provider:`complete` 按 query 前缀过滤;无声明会话返回空(Req2.1、Req4)。
- 前端 palette `select` 分流:伪命令候选 → 仅 `onChange`(无执行回调被调用);真命令 → 触发执行(Req3.1/3.2、Req5)。
- runner:`emitSlashCompletions` 空声明不写、非空写单行帧(Req1.1)。

**node e2e(`pnpm e2e:node`,真实子进程,验证 R1)**
- 启 aigc-agent(声明 `slashCompletions`)真实子进程 → 主进程握手正常 + `GET /completion?trigger=/&q=img` 返回 `/img-gen`/`/img-edit`(证明装配帧未破坏 RPC 流 + 端到端缓存到位)。对应 Req6.1、Req7.4。

**浏览器 e2e(`pnpm e2e`,隔离 build + stub,`PI_WEB_DISABLE_STANDALONE=1`)**
- 敲 `/` → 浮层含 `/img-gen` → 选中 → 输入框出现 `/img-gen `(未发送、未执行)→ 补词提交 → 走正常消息流(stub)→ 工具卡/结果显示,刷新后历史载入(Req2/3/6.2)。
- A/B:不声明 `slashCompletions` 的 agent 敲 `/` 不出现 `/img-gen`,执行型命令(如 `/clear`)仍正常(Req4、Req5)。

## Requirements Traceability

| 需求 | 设计组件 |
|---|---|
| 1.1/1.2/1.3 | C1 C2 C3 C4(声明→帧→per-session 缓存) |
| 2.1/2.2/2.3 | C5 C6(provider + 前端复用补全 UI,失败不阻塞) |
| 3.1/3.2/3.3 | C6(select 纯填入分流 + doSend 原文) |
| 4.1/4.2 | C4 C5(按会话缓存,空声明空候选) |
| 5.1/5.2/5.3 | C6(单浮层并入,真命令执行不变) |
| 6.1/6.2/6.3 | C7 + node/浏览器 e2e(AIGC 端到端,工具形态不变) |
| 7.1/7.2 | research.md(blocker 验证 + 不改 pi SDK 通道选型) |
| 7.3/7.4 | Testing Strategy(单测全覆盖 + 新鲜运行 e2e) |
