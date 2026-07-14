# 04 · Surface 权威表面栈

**Surface 把 agent 子进程当成一个「领域微后端」：状态权威留在子进程里的单写者，前端只做一层瘦投影（读快照）+ 命令发起端（发意图），二者从不直接通信。** 这是与聊天流 RPC 通道正交的**第二条跨进程通信平面**，已在 main 上实现（`createSurface` / `wireSurfaceBridge` / `useSurface`，有真实子进程集成测试背书），端到端驱动 Canvas 工作台。本章先讲它解决什么问题、心智模型是什么，再把 API 细节下沉到章末。

---

## 为什么需要第二条通信平面

到这里为止，你对 pi-web 的心智是「浏览器 ↔ RPC 通道 ↔ agent 子进程」的一条聊天流：用户发消息、LLM 回流事件、翻译成 `UIMessage` 渲染（见 [02 核心概念](./02-core-concepts.md)、[03 系统架构](./03-architecture.md)）。这条平面很适合**对话**，但不适合承载**富交互应用面**——比如一块画布、一份可钻取的报表、一个视频工作台。它们的共同诉求是：

- UI 上有一份**结构化状态**（画廊里有哪些图、当前版本、掩码叠层），需要实时同步；
- 用户在 UI 上的操作（旋转、注册一张上传图、切版本）是**确定性变更**，多数不需要惊动 LLM；
- 这份状态可能很热、更新很频繁，但**装不进 LLM 上下文**（token 太贵）。

如果硬塞进聊天流，会立刻撞上 pi 的物理约束(`docs/surface-app-runtime-contract-v1.md:23-27`)：agent 只有三类下行（`event`/`response`/`extension_ui_request`），工具不能主动 pull，pi 没有 `ctx.state`，唯一管道是 stdin/stdout 的 JSONL（`writeSync` 原子性 ≤ 64KB）。

**唯一稳定解**（不是品味，是被四场景压力测试筛出的必然）：

> 状态权威在 agent 进程里做**单写者**；UI 只收快照、只发命令；宿主（server）当中立代理与消息总线。

这套范式在代码里叫 **agent 权威表面（agent-authoritative-surface）**，见 `packages/tool-kit/src/surface/create-surface.ts:1-16`。它的框架层单一权威文档是 [`docs/surface-app-runtime-contract-v1.md`](../surface-app-runtime-contract-v1.md)（Surface App Runtime 契约 v1）。

> **关于「AAS」这个词**：早期有一篇 `docs/agent-authoritative-surface-design.md` 把这套范式叫「AAS（Agent-Authoritative Surface）」并勾勒了「五通道」框架。那是一份**明标为 pre-spec 的设计草案**——契约 v1 已把它的五通道收编进 C1、并对账了其八个未决问题（`surface-app-runtime-contract-v1.md:14,363-374`）。本章凡出现「AAS」，都仅作**这份设计草案的历史词汇**引用；真正落地、有代码背书的是下文的 `createSurface`/`wireSurfaceBridge`/`useSurface` 三件套，而非一个叫「AAS SDK」的成品。

---

## 三条心智法则

### 法则一 · 单写者 CQRS

状态权威（S）只有 agent 进程能写。任何绕过——UI 直写快照、route handler 写领域态——都是「违章建筑」。命令（C）是变更意图，读模型（R）是带 rev 的快照广播。写与读被拆成两条路：**命令上行、快照下行**，这就是 CQRS。

由此免除了并发控制：既然只有一个写者，就不会有写冲突。

### 法则二 · 两客户端定理

同一个「领域微后端」有**两个客户端**：

| 客户端 | 怎么改状态 | 例 |
|---|---|---|
| 对话流（LLM 经工具） | LLM 调工具 → 工具里的确定性代码改快照 | 「帮我把这张图局部重绘」 |
| 应用面 UI（经 ui-rpc 命令） | 用户点按钮 → 命令改快照 | 点「旋转 90°」 |

**两个客户端彼此从不直接通信**。一致性来自单写者：无论谁触发，最终都落到同一份权威快照，再投影回 UI。所以「对话驱动 surface」在架构上并不存在，存在的是「对话驱动权威，权威投影到 surface」(`surface-app-runtime-contract-v1.md:31,181-183`)。

### 法则三 · 命令返回「发生了什么」，快照才是「现在是什么」

命令的返回值只报告「这次做了什么」（如 `{count: 3}`），UI **绝不能**拿命令返回值去渲染权威数据——那要看快照。这条法则让前端对「回包丢帧」天然免疫（dev StrictMode 双开导致的空闲流竞争丢帧实证过），也顺带推出 **v1 没有乐观更新协议**：需要即时反馈就用本地瞬时态呈现，不预写快照镜像(`surface-app-runtime-contract-v1.md:110-118`)。

---

## 底座：状态注入桥（双向共享 KV）

Surface 不是凭空长出来的，它站在一条更基础的设施上——**状态注入桥（state-injection-bridge）**：一份**会话级共享 KV**，权威在 agent 子进程，前后端双向可读写。

- **权威侧**：子进程里由 server 的 `wireStateBridge` 自建一个 KV provider，挂到 globalThis seam `__piWebSessionState__`。agent 作者在工具 `execute` 内经 `getSessionState()` 同步读写（`packages/tool-kit/src/session-state.ts:14-73`）。写入立即生效、零跨进程。
- **下行**：任何写入经 `control:"state"` 帧（带单调 `rev`、`deleted` 标记）实时镜像到 UI。这条镜像**走在 context 之外，不进 LLM 历史**。
- **上行写回**：前端可经 `POST /sessions/:id/state` 写回**偏好类键**（`<ns>.<pref>`，如 `aigc.model`）；**禁写 `surface:*`**——权威快照只能由 agent 进程写（单写者，`surface-app-runtime-contract-v1.md:262-263`）。

Surface 复用的正是这条桥：一个 domain 的权威快照，就落在 KV 的 `surface:<domain>` 键上。`createSurface` 内部改快照的动作，本质就是 `getSessionState().set("surface:<domain>", snapshot)`——它**不自造任何 control 帧**，完全借用状态注入桥的下行原语（`create-surface.ts:36-37,150-154`）。

> agent 作者面的 `getSessionState()` 授权用法见 [08 自定义 Agent 开发](./08-agent-development.md)；写回端点与 `control:"state"` 帧的 HTTP/SSE 契约见 [24 HTTP/SSE API 参考](./24-http-api-reference.md)。

四类状态各有唯一归宿，别混装(`surface-app-runtime-contract-v1.md:248-254`)：

| 类别 | 归宿 | 生命周期 | 例 |
|---|---|---|---|
| 瞬时交互 | UI/engine 本地 | 组件卸载即死 | 手势草稿、缩放、hover |
| 会话偏好 | state 桥 KV（`<ns>.<pref>`） | 会话内 | `aigc.model` / `size` |
| 权威领域快照 | `surface:<domain>`（agent 进程） | 子进程死→hydrate 重建 | 画廊、DAG、视图描述符 |
| 持久态 | 制品仓 / attachment store | 跨重启 | 图 + 血缘 |

---

## Surface 的三平面

一个 surface 就是三元组 `Surface<S> = (S, C, R)`，落在三条通道上：

```
应用面 UI（React：useSurface / useConversationBridge）
   │  ▲
   │  │  状态面：control:"state" 快照下行（粘性，rev 收敛，重连回放）
   │  └──────────────────────────────────────────────
   │  控制面：ui-rpc 命令上行（point=command / action=execute）
   ▼
Hono 宿主（server/index.ts，中立消息总线，零领域语义）
   │  stdin JSONL：{"type":"ui_rpc",...}          ▲ fd1：{"type":"ui_rpc_response",...}
   ▼                                              │
agent 子进程
   ├─ wireSurfaceBridge：截 ui_rpc 行 → 按 domain 派发 → 直写 fd1 回流
   └─ createSurface：__piWebSurfaces__ 注册表 · 权威快照单写者 · 探针命令 surface:<domain>
```

- **状态面（下行）**：`control:"state"` 快照推送，粘性（last-value 覆盖）、重连回放。小而热、全量、rev 收敛。
- **控制面（上行）**：命令经 Tier3 ui-rpc 的**agent 转发路径**上行——关键 trick 是命令 payload **不含顶层 `name` 字段**，从而 `safeParse` 掉不进宿主的 host 命令拦截，自然落到 `session.uiRpc` 转发进子进程（`packages/protocol/src/web-ext/surface.ts:11-13,30-34`）。
- **数据面（规划中）**：契约 v1 为「大而冷、只读、可缓存」的数据面（经 Agent Routes 拉数据页）留了位，但整章标注 **[预定形]**、随未来 M-B 生效（`surface-app-runtime-contract-v1.md:284-288,412-425`）。本栈当前**不包含**它，别当已交付能力用。

domain 在一个会话内**唯一**：重复注册是装配错误（后注册者拒绝 + diagnostics，`surface-app-runtime-contract-v1.md:103-105`）。

---

## 对话桥：让 surface 操作能回流对话

有些 surface 操作确实需要 LLM 在环（要它选工具、补参数），比如「生成一张图」。这类操作**必须**经宿主的 Prompt 通道，组装成结构化用户消息进对话流——于是操作也回流进对话历史，可见、可回放、可指代（「刚才那张再调亮」）。这层收口在 `useConversationBridge` 门面里（`packages/react/src/hooks/use-conversation-bridge.ts`）。

它把宿主注入的三个裸 props（会话提交能力 / 轮末信号 / 控制面访问）收成四个能力，核心是 **opChannel 三态降级**（`use-conversation-bridge.ts:75-88`）——应用面不得跳级：

| opChannel | 条件 | 行为 | LLM 是否在环 |
|---|---|---|---|
| `prompt` | Prompt 通道已注入 | `renderSurfaceOp(op)` 渲染成用户消息，走对话流 | **在环** |
| `command` | Prompt 缺失、但探针 `surface:<domain>` 在 | 降级 `surface.run(domain, action, args)`（需 `op.fallback`） | 不在环 |
| `unavailable` | 两者都不可用 | 动作禁用 / 只读退化 | — |

`prompt` 与 `command` 语义不同（后者对 LLM 隐形），所以 **UI 必须可感知地呈现降级态**（Canvas 里就有一句「surface 不可用，仅本地工具可用」的提示，`surface-app-runtime-contract-v1.md:212-214`）。

判断到底走哪条的**正向判据**（满足其一才走 Prompt）：① 需要 LLM 判断；② 操作应可见可回放地进历史；③ 后续对话要能指代它。纯数据操作（`register`/`delete`/`sync`）恒走控制面、不进对话(`surface-app-runtime-contract-v1.md:203-207`)。

`renderSurfaceOp` 是把 `SurfaceOp`（标题 + 工具 + 有序参数）渲染成 fenced 用户消息的**纯函数**，同输入恒同输出（`packages/web-kit/src/surface-op.ts:57-66`）。它落在 web-kit（框架无关的 canonical 家），门面 hook 在其上层组装。

---

## Canvas：一个端到端的正向实例

Canvas 工作台是 Surface 栈的参考消费者，也是它唯一跑通全链路的应用面。看它怎么用上面每一件：

1. **agent 侧**用 `canvasSurfaceExtension` 经上游 `createSurface` 装 `domain="canvas"` 的权威 surface，快照是画廊物化视图 `GalleryState`；命令表含 A 档二创六动作 + `register`/`sync`/`delete`（`packages/tool-kit/src/aigc/canvas/extension.ts:27,87-107`）。
2. **hydrate**：子进程重启时经 attachment seam 枚举重建画廊，不阻塞会话启动（`extension.ts:97-104`）。
3. **状态面**：画廊、当前版本、`livePreview`（生成中「由糊变清」）都在 `surface:canvas` 快照里下行。注意 `livePreview` 刻意**只带 stage、丢弃大图 data URI**——大帧与 pi RPC 并发写 fd1 会交织损坏 JSONL（守「无二进制进帧」不变量，`extension.ts:108-117`）。
4. **控制面 + 对话桥**：「生成」三条全中正向判据 → 走 Prompt 通道（LLM 调 `image_edit` 工具）；「旋转 90°」零命中 → 走控制面 `register`。工具落制品、推快照，UI 订阅快照出新图——**回程永远是状态面，不是消息**。
5. **轮末收敛**：`agent_end` 触发全量重建并整替快照、清 `livePreview` 叠层（`extension.ts:122-135`）。

一句话：**Canvas 之所以能人机共编同一块画布，就是因为画布状态是 agent 进程里 `domain=canvas` 的单写者快照，对话流和用户 UI 只是它的两个客户端。** Canvas 的用户面见 [16 Canvas 工作台](./16-canvas-workbench.md)，插件作者面见 [17 Canvas 插件开发](./17-canvas-plugins.md)。

---

## 上手：跑通一个领域无关的 surface

仓库自带一个**零 AIGC 依赖**的最小示例 `surface-demo-agent`，一个计数器 + echo 日志的 surface。

### 步骤 1 · 启动它

```bash
pi-web ./examples/surface-demo-agent
```

省略 model → 继承 `~/.pi/agent/settings.json` 的默认 provider/model。命令交互本身**不需要 provider 凭证**（命令在子进程内确定性执行、不过 LLM）；只有对话回复才用 LLM（`examples/surface-demo-agent/README.md:22-27`）。

**预期结果**：浏览器里出现一块 surface 面板，显示 `count: 0` 与空日志。

### 步骤 2 · 看 agent 侧怎么声明

`examples/surface-demo-agent/index.ts:33-53` 把整套范式落成一个 config：

```ts
import { createSurface, type SurfaceCtx } from "@blksails/pi-web-tool-kit/runtime";

interface DemoState { count: number; log: string[]; }

export default defineAgent({
  extensions: [
    (pi) => {
      createSurface<DemoState>(pi, {
        domain: "demo",
        initialState: { count: 0, log: [] },
        commands: {
          // 命令返回「发生了什么」；快照才是「现在是什么」。
          increment: (_args, ctx: SurfaceCtx<DemoState>) => {
            ctx.setState((s) => ({ ...s, count: s.count + 1 }));
            return { count: ctx.get().count };
          },
          echo: (args, ctx: SurfaceCtx<DemoState>) => {
            const text = String((args as { text?: unknown })?.text ?? "");
            ctx.setState((s) => ({ ...s, log: [...s.log, text] }));
            return { echoed: text, size: ctx.get().log.length };
          },
        },
      });
    },
  ],
});
```

**关键点**：`initialState` 在闭包内构造（不跨会话共享引用）；命令内经 `ctx.setState(reducer)` 改快照，SDK 自动经状态注入桥推 `control:"state"` 下行帧；探针命令 `surface:demo` 由 `createSurface` **自动注册**，无需显式声明。

### 步骤 3 · 点一下面板上的 increment

**预期结果**：`count` 变成 1，日志/计数实时更新。这一路是：UI 发 `run("increment")` → ui-rpc（payload 无 `name`，逃逸 host 拦截）→ 子进程 `wireSurfaceBridge` 按 domain 派发到 `commands.increment` → 改快照 → `control:"state"` 回流镜像。命令**全程不过 LLM**。

### 步骤 4 · 验证降级

把 source 换成非该 domain 的（如 `pi-web ./examples/hello-agent`），面板探针 `surface:demo` 缺失 → `available===false`。

**预期结果**：面板退化为只读、**不报错**——这正是 opChannel `unavailable` 态该有的行为。

---

## API 细节（章末下沉）

四条边、五个符号，按「谁在哪一侧」记：

| 符号 | 侧 | 职责 | 证据 |
|---|---|---|---|
| `createSurface(pi, config)` | agent 子进程 | 建按 domain 命名的权威 surface：写注册表、注册探针、装配期推首帧 | `packages/tool-kit/src/surface/create-surface.ts:130-232` |
| `getSurfaceRegistry()` / `__piWebSurfaces__` | agent 子进程 | 进程内 `domain→dispatch` 注册表 seam，装配顺序无关 | `packages/tool-kit/src/surface/surface-registry.ts:16,49-68` |
| `wireSurfaceBridge(runtime, …)` | server runner | 第二个 stdin JSONL 读取器：截 `ui_rpc` 行 → 按 domain 派发 → `writeSync(1)` 直写 fd1 回流 | `packages/server/src/runner/surface-wiring.ts:109-228` |
| `useSurface(domain, opts)` | React 前端 | `{state, run, available, rev}`：镜像快照 + 命令上行 + 探针 | `packages/react/src/hooks/use-surface.ts:56-155` |
| `useConversationBridge(opts)` | React 前端 | `{opChannel, submitOp, bringToConversation, onTurnEnd}` 对话桥门面 | `packages/react/src/hooks/use-conversation-bridge.ts:70-189` |
| `renderSurfaceOp(op)` / `SurfaceOp` | web-kit | `SurfaceOp` → 用户消息文本的纯函数 | `packages/web-kit/src/surface-op.ts:57-66` |

契约根类型在 protocol 包（`packages/protocol/src/web-ext/surface.ts`）：`surfaceStateKey(domain)`→`surface:${domain}`、`SurfaceCommandPayloadSchema{domain,action,args}`（**无顶层 `name`**）、`SurfaceCommandResultSchema{ok,data?,error{code,message}?}`。

### 命令处理器契约

`SurfaceCtx<S>` 给命令处理器三样东西（`create-surface.ts:33-41`）：`get()` 读当前快照、`setState(reducer)` 改快照（自动推下行帧）、`attachments` 复用既有 attachment 工具上下文（resolve `att_` / 落库产物，二进制永不进快照）。

命令处理器返回值有三种归一化路径（`create-surface.ts:167-190`）：正常返回值 → dispatch 包成 `{ok:true,data}`；返回 `{ok:false,error:{code,message}}` → 透传保留稳定领域码；抛 `SurfaceCommandError(code,msg)` → `.code` 传播进结果。

### 装配序（server runner）

`wireSurfaceBridge` 在 `startRunner` 内、`runRpcMode(runtime)` **之前**、`wireStateBridge` **之后**装配（`packages/server/src/runner/runner.ts:337-348`）。之所以必须直写 fd1 而非 `process.stdout.write`：pi 的 `runRpcMode` 会 `takeOverStdout()` 把 stdout 重定向到 stderr，RPC 帧经原始 fd1 写出，本桥也必须直写 fd1 才能被 server 的 `PiRpcProcess` 读到（`surface-wiring.ts:15-21`）。无 surface 注册时非 surface 行照常放行（惰性 no-op，不影响未用本栈的会话）。

---

## 下一步 / 相关

- 这条平面在整体架构里的位置（与 RPC/SSE 的关系）→ [03 系统架构](./03-architecture.md)
- 「事件→UIMessage」的另一条正交平面 → [02 核心概念](./02-core-concepts.md)
- 承载本栈的包边界（protocol / server / react / web-kit / tool-kit）→ [05 分层包](./05-packages.md)
- agent 作者面 `getSessionState()` 的授权用法 → [08 自定义 Agent 开发](./08-agent-development.md)
- 与 5-tier 挂载机制正交、以及 Tier4 `artifactSurface`（iframe 表面，与本栈的 Surface 是两个概念）→ [12 Web UI 扩展](./12-web-ui-extension.md)
- 建立在本栈之上的用户面画布编辑器 → [16 Canvas 工作台](./16-canvas-workbench.md)
- Canvas 插件作者面 → [17 Canvas 插件开发](./17-canvas-plugins.md)
- `POST /sessions/:id/state` 写回端点、`control:"state"` 镜像帧、ui-rpc 转发的 HTTP/SSE 契约 → [24 HTTP/SSE API 参考](./24-http-api-reference.md)
- Surface / AAS（设计词汇）/ CQRS 单写者 / SurfaceOp / opChannel 等术语 → [26 术语表](./26-glossary.md)
- 框架层单一权威设计文档 → [`docs/surface-app-runtime-contract-v1.md`](../surface-app-runtime-contract-v1.md)
