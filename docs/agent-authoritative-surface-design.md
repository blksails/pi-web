# Agent 权威表面(Agent-Authoritative Surface, AAS)接口草案

> 状态:**pre-spec 设计草案**(未立 spec) · 日期:2026-07-02
> 定位:提炼一个已在 pi-web 中零散跑通三次的通信范式,配一套按 `domain` 命名的 SDK。
> 首个落地目标:AIGC Canvas(图片素材画廊 + 二次创作),但本文只谈**通用范式与接口**,Canvas 仅作端到端实例。

---

## 0. TL;DR

- **AAS 是什么**:宿主里任何富交互 UI 表面(surface),都被建模为 agent 进程里某个 `domain` 的**瘦投影 + 命令发起端**。状态权威永远在 agent 进程,UI 只镜像快照、只发结构化命令,宿主只做**领域无关**的中立搬运。
- **底层是 CQRS,且是被 pi 约束逼出来的**,不是设计品味:pi 的 agent→server 只有 `event / response / extension_ui_request` 三类下行,工具不能 pull,没有 `ctx.state`。UI 无法查询 agent,只能收快照 + 发命令。
- **物理通道已存在**:下行复用 `state-injection-bridge` 的 `control:"state"` 帧(领域无关 KV + `rev`),上行复用 Tier3 `ui-rpc` 命令。**路线 A(推荐)protocol 零改、宿主零改**;`createSurface`/`useSurface` 只是这两个现有机制之上的、按 `domain` 命名的门面。
- **触发源是确定性 extension 代码,不是 LLM**。LLM 只是"扳机"之一(它决定调工具),真正 push state 的永远是确定性代码。这是可靠性的根。
- **它不是新的 webext tier**,是与 5-tier 挂载机制正交的**通信约定**。

---

## 1. 背景与动机

### 1.1 pi 的约束

pi 是 npm 依赖,本仓无源码(真实事实源 = `node_modules` 的 `.d.ts`)。真实约束:

- agent→server 只有三类 JSONL:`event` / `response` / `extension_ui_request`;
- server→agent:`prompt` / 命令 / stdin 内部行;
- **工具不能 pull**;
- **pi 无 `ctx.state`**;context 外原生只有 append-only `pi.appendEntry`(不喂 LLM)。

结论:UI 永远无法"查询"agent 的可变状态,状态权威**只能**待在 agent 进程,UI 只能被动收快照 + 主动发命令。这就是 CQRS——**不是选来的,是唯一稳定解**。

### 1.2 已经跑通三次,却没命名

pi-web 里这几个闭环本质是同一个范式的不同投影:

| 现有特例 | 在 AAS 中的位置 |
| --- | --- |
| `state-injection-bridge` | State + 写回通道的第一次完整实现 |
| `message-queue`(`control:"queue"`) | 一个 domain 的 State + Command 实例 |
| `session-state` / `session-status`(粘性帧) | agent→UI 粘性快照的实例 |
| `unified-command-layer` | 定义了 Command 通道**不得走 prompt 空闲流**(要走 ui-rpc) |
| Tier4 `artifact` iframe | 同范式的**沙箱化投影**(postMessage 替直接渲染,`rpc` 帧替 ui-rpc) |

AAS 就是给这个"每次手接三条边"的模式起名字 + 配 SDK,让新建一个 surface 从踩坑变成填 config。

---

## 2. 范式总览

### 2.1 五条通道

| 通道 | 方向 | 现有接缝(路线 A) | 语义 |
| --- | --- | --- | --- |
| **State**(查询·下行) | agent → UI | `control:"state"` 粘性帧,`key="surface:<domain>"` | agent 唯一权威,UI 只读镜像,`rev` 收敛 |
| **Command**(命令·上行) | UI → agent | Tier3 `ui-rpc`(`point:"command"`, `action:"execute"`) | 结构化、**不过 LLM**、有返回值 |
| **Prompt**(语言·上行·可选) | UI → agent | `client.prompt` fire-and-forget | 仅当需要 LLM 在环时 |
| **Bulk**(大负载·旁路) | 双向 | `att_<id>` 签名 URL | 二进制**永不进帧** |
| **Capability**(协商) | UI ← agent | `getCommands` 只读探针 | 决定渲染什么 + 如何退化 |

外加**挂载**维度:surface 经 webext `SlotContribution` 具名槽激活,宿主不常驻、不知情。

### 2.2 三个触发源(谁按扳机)

state 更新**永远由确定性 extension 代码执行**,只是扳机不同:

```
① LLM 间接:LLM 决定调 image_generation → 工具 execute(确定性)跑完 → push state
② UI 直接: UI 命令 → ui-rpc → handler(确定性)→ runImageTool → push state   【LLM 不在场】
③ agent 自主:extension 监听事件 → push state
```

**LLM 从不直接写 state**——它只产 event/response。这保证 gallery 不会因"LLM 忘了输出 JSON"而漏图,也让精修(②)完全绕过推理。

### 2.3 三层(命令 → 权威持久 → 快照投影)

| 层 | 通道 | 语义 |
| --- | --- | --- |
| 命令 | ui-rpc / 工具调用 | 意图 |
| **权威持久** | **attachment store**(`att_` + `.att.json`) | 每张图本就落库;血缘存 `.att.json` 扩展字段(`derivedFrom`/`genParams`) |
| **快照(实时·投影)** | `control:"state"` 帧 | attachment store 的 materialized view,重启从 store 重建 |

> ⚠️ **不要用 `pi.appendEntry` 当持久层**(2026-07-02 实证):pi 0.80.3 里 `_appendEntry` 是 **private**,`ExtensionContext.sessionManager` 是 **`ReadonlySessionManager`**,扩展**无任何公开的追加/持久 entry API**。gallery 也**不需要**自建持久层——它派生自本就持久的 attachment store(见 §2.4-C)。

### 2.4 与 pi 消息历史的关系(两条独立时间线)

- **pi 消息历史** = `session.getMessages()` 回放的 agent 消息**树**(前端 `getMessages → agentMessagesToUiMessages → initialMessages`);喂 LLM、可 `fork`/`compact`,pi 权威。
- **surface state** = `control:"state"` 帧;**不进 `getMessages`、不喂 LLM、不占 context**。gallery 百图不撑爆上下文。

三触发源对消息历史影响不同:

| 触发源 | 进 pi 消息历史 | 进 gallery | LLM 感知 |
| --- | --- | --- | --- |
| ① LLM 调 `image_generation` 工具 | ✅ ToolResultMessage | ✅ | ✅ |
| ② UI 精修命令(surface ui-rpc) | ❌ | ✅ | **❌ 隐形** |
| ③ agent 自主 | ❌ | ✅ | ❌ |

**张力**:②/③ 对 LLM 隐形——Canvas 精修后回对话说"把刚才那张调亮",agent 不知道是哪张。处理:

- **A. 上下文回注必须显式**:surface→对话 的桥是 Prompt 通道(带 `att_id`,复用 `attachment-bridge` 的 `injectAttachmentRefs`)。提供"带入对话"动作,用户明确要 agent 介入时才注入、才花 token。两条线各自干净。
- **C. gallery = attachment store 的物化视图**(不是独立持久 state):每张图已落 `att_`,① 的图在 transcript 引用的是**同一 `att_id`**。子进程重启时由 **agent 侧 extension 经 `attachment ctx` 枚举重建**(在子进程内,**非前端 REST**——前端永远只订阅 SSE 粘性帧,零 REST route),重建后推粘性快照;`control:"state"` 承担实时推送 + 重连回放;transcript 工具卡与 gallery 格子指向同一 `att_id`=同一素材两视图,天然去重。

### 2.5 重连与重建(刷新后界面还在吗)

两种"重新打开",恢复路径不同:

**情况 1 · 刷新页面(子进程仍活)**:`SessionStateStore` 权威数据在子进程内存里还在(`state/session-state-store.ts`:权威副本在 agent 子进程)。
> ⚠️ **但裸 `control:"state"` 桥不是粘性帧**——粘性靠**手动** `sticky.set`(非自动):message-queue 的 `control:"queue"` 在广播循环里手写一行登记(`pi-session.ts:532`),session-status/state 在 seed 时手动登记(`pi-session.ts:227`)。而 `piweb_state → control:"state"` 分支(`pi-session.ts:580`)**只 `emitter.emit` 广播、无 `sticky.set`**。**⇒ 重连收不到已有 gallery,界面空白。这是代码级证据,不是猜测。**
>
> **粘性登记在服务端 `PiSession`(前端/agent SDK 都做不了,`StickyFrameRegistry` 在宿主)。修复 = 宿主一处小改,领域无关**:在 `piweb_state` 分支加 `this.sticky.set(\`state:${key}\`, frame)`(照抄 queue 的 532 行,按 key 分桶 last-value,`delete` 帧相应清理)。所有 `control:state` key 一次受益,server 不解释 value、不认识 canvas —— 中立不破。本质是 **state-injection-bridge 的既有缺口**(权威 KV 镜像却不粘、重连丢 KV),gallery 只是第一个撞上它的。

**情况 2 · 重开会话(子进程重启 / 冷 resume)**:pi-web 自建 KV 不持久,子进程死即丢。⇒ `hydrate()` 从 attachment store 枚举重建 gallery(§2.4-C 使之可行),再推粘性快照。

**一句话**:刷新能否看到 gallery,取决于 surface **有没有登记粘性帧**;重开会话能否恢复,取决于 **`hydrate` 从 attachment store 重建**。两者都要做,缺一即"刷新后界面不在"。

> **本方案不含任何 REST route。** 还原全靠 SSE:刷新 = 粘性帧重连回放,子进程重启 = agent 侧 `attachment ctx` 枚举重建后推粘性帧。前端**永远只订阅 SSE**,`hydrate` 是 **agent 子进程内部**行为,不是前端拉取——故"快照 + 载入"在零 REST 约束下不是可选项而是**必备手段**。

---

## 3. 现状盘点(接口草案的地基)

### 3.1 可直接复用(路线 A,零 protocol 改动)

| 能力 | 现有 schema / 端点 | 文件 |
| --- | --- | --- |
| State 下行 | `StateControlPayloadSchema`(`control:"state"` + `key`/`value:unknown`/`rev`/`deleted`) | `packages/protocol/src/web-ext/state.ts:15` |
| State 写回 | `StateSetRequestSchema` → `POST /sessions/:id/state` | `web-ext/state.ts:27` |
| 子进程上报行 | `StateDownLineSchema`(`piweb_state`) | `web-ext/state.ts:43` |
| stdin 写回行 | `StateSetLineSchema`(`piweb_state_set/delete`) | `web-ext/state.ts:53` |
| Command 上行 | `UiRpcRequestSchema` → `POST /sessions/:id/ui-rpc` | `web-ext/ui-rpc.ts:30` |
| Command 下行 | `UiRpcControlPayloadSchema`(`control:"ui-rpc"`,按 `correlationId` 配对) | `web-ext/ui-rpc.ts:51` |
| 命令 payload/result | `CommandExecutePayloadSchema` / `CommandResultSchema` | `web-ext/command.ts:12,21` |
| Bulk | `att_` 签名 URL(HMAC,10 年 TTL) | `packages/server/src/attachment/*` |

### 3.2 现有约束:control 帧是**封闭 union**

`packages/protocol/src/transport/sse-frame.ts:21` 的 `ControlPayloadSchema` 是写死的 `z.discriminatedUnion("control", [...])`,含 9 个 domain。**今天每加一个新 control domain 都要改 protocol + bump semver。** 这正是路线 A 复用 `control:"state"` KV 桥的动机:KV 桥的 `value: z.unknown()` 已经领域无关,新 domain 不必扩 union。

---

## 4. 接口草案

约定:新增 SDK 建议落一个薄包 `@blksails/pi-web-surface-kit`(agent 侧 + UI 侧双入口),或分别并入 `tool-kit`(agent)与 `pi-web-react`(UI)。以下类型为**草案**,现有 schema 引用以 §3.1 为准。

### 4.1 State 通道 — 复用 `control:"state"`,不新增帧(路线 A)

surface 快照落在**单一 key**上,`value` 即整个 domain 快照,`rev` 由现有桥分配:

```ts
// 逻辑映射(非新 schema):
// control:"state" 帧  { key: `surface:${domain}`, value: <Snapshot>, rev, deleted? }
export type SurfaceKey = `surface:${string}`;
```

> 路线 B(仅当需要多 domain 类型化 snapshot + schema 校验时):往 `ControlPayloadSchema` 加一个开放信封 variant
> `{ control: "surface", domain: string, rev: number, snapshot: unknown }`,给 union 松绑。**起步不需要。**

### 4.2 Command 通道 — 复用 Tier3 `ui-rpc`,细化 payload(不改 UiRpc 结构)

与 `command.ts` 同法:`ui-rpc` 的 `payload`/`result` 是 `unknown`,在消费侧细化即可,**不动** `UiRpcRequestSchema` 本身(向后兼容)。

```ts
import { z } from "zod";

/** point="command", action="execute" 时,surface 命令的 payload 细化。 */
export const SurfaceCommandPayloadSchema = z.object({
  /** 目标 surface 的 domain,如 "canvas"。 */
  domain: z.string().min(1),
  /** 命令动作,如 "edit" | "delete" | "duplicate"。 */
  action: z.string().min(1),
  /** 结构化参数;att_ 引用在此传递,二进制永不进入。 */
  args: z.unknown().optional(),
});
export type SurfaceCommandPayload = z.infer<typeof SurfaceCommandPayloadSchema>;

/** ui-rpc response.result 的 surface 细化(可复用 CommandResult 的 effect 语义)。 */
export const SurfaceCommandResultSchema = z.object({
  domain: z.string().min(1),
  action: z.string().min(1),
  ok: z.boolean(),
  /** 操作产物引用(如新生成的 att_id 列表);快照仍以 State 帧为准。 */
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type SurfaceCommandResult = z.infer<typeof SurfaceCommandResultSchema>;
```

**服务端两条分流路径**(已核实 `packages/server/src/http/routes/command-routes.ts:281` `makeUiRpcHandler`):

```
point==="command" && action==="execute" && CommandExecutePayload.safeParse(payload).ok && registry.has(name)
   → host 命令路径:宿主主进程同步执行,HTTP 响应体直接返回 UiRpcResponse
否则
   → session.uiRpc(req):转发 agent 子进程,HTTP 只回 ack,响应经 SSE control:"ui-rpc" 按 correlationId 异步回流
```

> **surface 命令必须走 agent 转发路径,严禁走 host 命令路径。** host 命令(`client.uiRpcCommand` 的同步响应体)跑在**宿主主进程**,拿不到 agent 侧 `models.json`/provider/`runImageTool`,且认领领域语义 = **破坏独立性**。
> `SurfaceCommandPayload` 用 `{domain, action, args}`(**无顶层 `name`**),`CommandExecutePayloadSchema.safeParse` 自然失败 ⇒ 不被 host 拦截 ⇒ 落到 `session.uiRpc` 转发进 agent 子进程的 Tier3 贡献点(能拿到 provider/runImageTool)。响应经 `control:"ui-rpc"` 按 `correlationId` 异步配对(`ui-rpc-bus` 已 Promise 化 + timeout)。
> ⚠️ `unified-command-layer` 的"同步响应体"教训是针对 **host 命令**的;surface 走的是 Tier3 ui-rpc 的既定异步回流(经空闲控制流 `openControlOnlyStream`,非 prompt 流,不冲突)。

### 4.3 Capability 通道 + 退化契约

`createSurface` 自动注册一个只读探针命令 `surface:<domain>`(经 `getCommands` 可见)。UI 据此决定挂载与退化:

```ts
export interface SurfaceCapability {
  /** getCommands 中是否存在 `surface:<domain>`。 */
  available: boolean;
  /** agent 声明支持的命令动作白名单(用于渲染工具栏)。 */
  actions: string[];
}
```

**退化契约**:`available === false` 时,surface **不得报错或空转**,而是降级到只读/纯客户端能力(例:Canvas 退成"只读图库 + 客户端裁剪")。换任意无关 agent source,pi-web 照跑——这是独立性的验证。

### 4.4 Bulk 通道

大负载(图像、mask、拼贴产物)一律走 `att_<id>` 引用:命令 `args` 与快照 `value` 里只出现 `att_id` + 签名 `displayUrl`,**base64/二进制永不进帧**。客户端产物(画的 mask、裁剪结果)经现有附件上传接缝落成新 `att_`,再把 id 放进命令。

### 4.5 agent 侧 — `createSurface`

```ts
export interface SurfaceCtx<S> {
  /** 读当前权威快照。 */
  get(): S;
  /** 改快照并推 State 帧(内部复用 state-injection-bridge 写入原语:分配 rev + fd1 直写)。 */
  setState(reducer: (prev: S) => S): void;
  /** 可选:把血缘/参数持久到 attachment `.att.json` 扩展字段(非 pi.appendEntry——pi 无公开持久 API)。 */
  persistLineage?(attachmentId: string, lineage: unknown): Promise<void>;
  /** 附件上下文(resolve att_ / putOutput),复用现有 attachment 工具上下文。 */
  attachments: AttachmentToolContext;
}

export type SurfaceCommandHandler<S> = (
  args: unknown,
  ctx: SurfaceCtx<S>,
) => Promise<SurfaceCommandResult["data"]> | SurfaceCommandResult["data"];

export interface SurfaceConfig<S> {
  /** 唯一 domain,映射到 key=`surface:<domain>` 与探针命令 `surface:<domain>`。 */
  domain: string;
  /** 初始快照(prop 默认值须下沉到函数体,避免共享引用)。 */
  initialState: S;
  /** 结构化命令表:action → handler(确定性代码,不过 LLM)。 */
  commands: Record<string, SurfaceCommandHandler<S>>;
  /** 可选:子进程(重)启动时从 attachment store 枚举重建初始快照(见 §2.5 重连与重建)。 */
  hydrate?(): Promise<S>;
}

export interface SurfaceHandle<S> {
  readonly domain: string;
  /** 由 ui-rpc(point=command)派发命令到 commands[action]。 */
  dispatch(action: string, args: unknown, ctx?: Partial<SurfaceCtx<S>>): Promise<SurfaceCommandResult>;
  /** 供 ① 触发源使用:确定性代码(如工具 execute)直接改快照。 */
  update(reducer: (prev: S) => S): void;
  /** 新订阅者接入时回放最新快照(粘性,重连收敛)。 */
  replay(): void;
}

export function createSurface<S>(config: SurfaceConfig<S>): SurfaceHandle<S>;
```

**实现要点(全部复用现有机制,勿重造)**:

- `setState`/`update` 内部**不自行构造 `control:"state"` 帧**,而是走 `state-injection-bridge` 的 agent 侧写入原语(它负责 `rev` 单调分配 + `fs.writeSync(1, ...)` 直写 fd1)。
  - ⚠️ **fd1 直写坑**:pi `runRpcMode` 用 `takeOverStdout` 劫持 `process.stdout.write`(转 stderr);自定义 `piweb_state` 行必须 `writeSync(1, ...)`,否则 UI 永远收不到。**只有真实子进程集成测试能抓到,stub 抓不到。**
- `createSurface` 在装配期(runner 注入 / `forcedExtensionPaths`)注册探针命令 `surface:<domain>`,使 `getCommands` 可见(Capability)。
- `dispatch` 由 ui-rpc `point="command"` 命中,handler 跑完 `data` 经 `control:"ui-rpc"` 回流;handler 内 `ctx.setState` 顺带推最新快照(命令与快照解耦:命令返回"发生了什么",快照才是"现在是什么")。

### 4.6 UI 侧 — `useSurface`

```ts
export interface UseSurfaceResult<S> {
  /** 镜像快照(未就绪为 null);按 rev 收敛,丢弃乱序帧。 */
  state: S | null;
  /** 发结构化命令(不过 LLM),Promise 解析为 result.data。 */
  run(action: string, args?: unknown): Promise<SurfaceCommandResult>;
  /** Capability:false 时调用方走退化分支。 */
  available: boolean;
  /** 当前快照 rev(调试/乐观更新对齐用)。 */
  rev: number;
}

export function useSurface<S>(domain: string): UseSurfaceResult<S>;
```

**实现要点**:

- `state`:订阅 `control:"state"` 中 `key === "surface:${domain}"` 的帧(可基于现有 `useExtensionState` 之上封装),按 `rev` 单调收敛。
- `run`:经 `ui-rpc-bus`(`use-ui-rpc`)发 `UiRpcRequest{ point:"command", action:"execute", payload: SurfaceCommandPayload }`,**不用** `client.uiRpcCommand`(那是 host 命令同步响应体,走宿主主进程)。payload 无顶层 `name` ⇒ 逃逸 host 拦截 ⇒ 转发 agent;结果按 `correlationId` 异步配对回流(总线已 Promise 化 + timeout)。
- `available`:挂载时 `client.getCommands()` 查 `surface:<domain>` 是否存在。

### 4.7 挂载(webext SlotContribution)

surface 的渲染器经具名槽注册(复用现有 `SlotContribution`,勿新造 renderer 机制):

```ts
// agent source 的 .pi/web 里声明(示意)
export const contributions = [
  { slot: "surface:canvas", render: () => <CanvasGallery /> },
];
```

宿主只提供槽位,不知道 `canvas` 是什么。

---

## 5. 端到端实例:Canvas gallery(极简切片)

**agent 侧**(AIGC extension,agent 子进程,拿得到 `models.json`/provider/key):

```ts
import { createSurface } from "@blksails/pi-web-surface-kit";
import { runImageTool } from "@blksails/pi-web-tool-kit";

interface GalleryAsset { attachmentId: string; displayUrl: string; derivedFrom?: string; genParams?: unknown; }
interface GalleryState { assets: GalleryAsset[]; }

const gallery = createSurface<GalleryState>({
  domain: "canvas",
  initialState: { assets: [] },
  commands: {
    // ② UI 直接触发的精修:结构化命令,不过 LLM
    edit: async (args, ctx) => {
      const { image, mask, prompt, model } = args as any;
      const res = await runImageTool(
        { image, mask, prompt, model }, ctx.attachments, undefined, undefined,
        { toolName: "image_edit", routes: ROUTES, defaultModel: "gpt-image-2",
          requiredParams: [], mediaFields: ["image", "mask"] },
      );
      if (!res.details.ok) return { error: { code: "edit_failed", message: res.details.error } };
      const fresh = res.details.assets.map((a) => ({ ...a, derivedFrom: image }));
      ctx.setState((s) => ({ assets: [...fresh, ...s.assets] })); // 回流画廊
      await ctx.appendEvent?.({ kind: "edit", from: image, to: fresh.map((f) => f.attachmentId), prompt });
      return { ids: fresh.map((f) => f.attachmentId) };
    },
  },
});

// ① LLM 间接触发:LLM 调 image_generation → 工具 execute 里确定性入库
onImageGenerated((assets) => gallery.update((s) => ({ assets: [...assets, ...s.assets] })));
```

**UI 侧**:

```tsx
function CanvasGallery() {
  const { state, run, available } = useSurface<GalleryState>("canvas");
  if (!available) return <ReadonlyGallery />;              // 退化:非 AIGC source
  return (
    <Grid>
      {state?.assets.map((a) => (
        <Cell key={a.attachmentId} src={a.displayUrl}       // Bulk:签名 URL,不进帧
          onInpaint={(maskAttId, prompt) =>
            run("edit", { image: a.attachmentId, mask: maskAttId, prompt, model: "qwen-image-edit-max" })} />
      ))}
    </Grid>
  );
}
```

---

## 6. 宿主中立性证明

判据:**grep 宿主代码(`app/`、`packages/pi-web-server`)找不到任何 `canvas`/`gallery`/`image_edit` 字符串。**

- State 帧转发:`handleRawLine` 匹配 `piweb_state` 行 → `control:"state"`,`value` 是 `unknown`,宿主不 peek;
- Command:ui-rpc `payload`/`result` 是 `unknown`,宿主不解析;
- 挂载:SlotContribution 槽名对宿主是不透明字符串;
- Bulk:attachment store 是宿主通用基础设施,不含 AIGC 语义。

领域知识只活在两端(agent extension + UI 渲染器)。这是"可无限加 domain 而不腐蚀宿主"的根据。

---

## 7. 路线 A vs 路线 B

| | 路线 A(推荐) | 路线 B |
| --- | --- | --- |
| State 通道 | 复用 `control:"state"` KV 桥 | 新增 `control:"surface"` union variant |
| protocol 改动 | **零** | 扩 `ControlPayloadSchema` + bump semver |
| 类型化 snapshot | 弱(`value:unknown`,SDK 侧断言) | 强(帧级 schema 校验) |
| 何时选 | 起步、单/少 domain | 多 domain + 需帧级校验/独立订阅 |

**建议**:路线 A 起步,`createSurface`/`useSurface` 作纯 SDK 门面;若 domain 数量与类型化需求增长,再平滑迁到路线 B(给封闭 union 松绑)。

---

## 8. 未决问题(立 spec 前需拍板)

1. **SDK 包边界**:独立 `@blksails/pi-web-surface-kit` 双入口,还是分别并入 `tool-kit`(agent)/`pi-web-react`(UI)?
2. **探针命令注册**:`createSurface` 自动注册 `surface:<domain>`,还是要求 extension 显式声明?影响 Capability 的默认行为。
3. ~~**命令 payload 承载**~~ **已确认(2026-07-02)**:ui-rpc payload 是 `z.unknown()`,透传任意结构。surface 命令用 `SurfaceCommandPayload{domain,action,args}`(无顶层 `name`)走 **agent 转发路径**(§4.2),严禁 host 命令路径(宿主主进程执行、破坏独立性)。响应走 `control:"ui-rpc"` 异步配对,非同步响应体。<br>剩余可选清晰化:是否在服务端 `makeUiRpcHandler` 或 agent 侧加**显式** surface 分流(payload 带 `domain` 即路由到 surface 贡献点),以免依赖"无 name 逃逸 host 拦截"这种隐晦机制。非必须。
4. **血缘持久时机**:gallery 派生自 attachment store(§2.4-C),血缘存 `.att.json` 扩展字段——M1 是否就写血缘,还是先只做扁平画廊(无派生树)?另需评估大量图时 `hydrate` 枚举重建的性能(见 §2.5)。
5. **写回通道用途**:`POST /sessions/:id/state` 直接写回,是否开放给纯 UI 偏好(视图密度、选中项),还是一律走 command 由 agent 改?建议:UI 本地偏好走客户端/state 写回,凡触及权威数据一律走 command。
6. **rev 与乐观更新**:命令返回 `data`(新 att_id)与快照帧到达之间有窗口,UI 是否做乐观插入并按 `rev` 对齐回收?
7. **fork 语义**:pi 消息历史是树、可 `fork`/`navigateTree`;gallery 派生自 attachment(按 `sessionId`),fork 出新 sessionId 时 gallery 跟随新分支 / 继承 / 走全局素材库?需定义。
8. ~~**重连粘性缓存归属**~~ **已实证(2026-07-02)**:粘性靠**手动** `sticky.set`(服务端 `PiSession`,`StickyFrameRegistry`);`control:"state"` 桥**未登记**(`pi-session.ts:580` 只广播不 set)⇒ 非粘性、重连丢。修 = 宿主在 `piweb_state` 分支通用登记 `sticky.set(\`state:${key}\`, frame)`(领域无关,惠及所有 state key)。<br>剩余待定:`delete` 帧的粘性清理策略(存 deleted 帧 vs 从表移除),以及是否顺带把它作为 state 桥的独立修复先落(不等 surface)。

---

## 附:接缝对照表

| AAS 通道 | 现有代码 |
| --- | --- |
| State 下行 | `packages/protocol/src/web-ext/state.ts:15`(`StateControlPayloadSchema`) |
| State 写回 | `web-ext/state.ts:27`(`StateSetRequestSchema`)+ `POST /sessions/:id/state` |
| 子进程/stdin 内部行 | `web-ext/state.ts:43,53` |
| Command 上/下行 | `web-ext/ui-rpc.ts:30,51` + `POST /sessions/:id/ui-rpc` |
| 命令 payload/result | `web-ext/command.ts:12,21` |
| control 帧封闭 union(路线 B 松绑点) | `transport/sse-frame.ts:21` |
| Bulk | `packages/server/src/attachment/*`(签名 URL) |
| 编辑执行编排器 | `packages/tool-kit/src/aigc/run-image-tool.ts` |

> 相关文档:`docs/bidirectional-shared-state-design.md`(context 外双向 state 的更早讨论)、`docs/product/12-web-ui-extension`(5-tier 挂载)、`docs/product/11-aigc-and-vision-tools`(Canvas 首个落地场景)。
