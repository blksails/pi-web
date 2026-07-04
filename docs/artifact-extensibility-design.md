# Artifact 扩展面与组件族设计(扩展模块设计 · 第二篇)

> ⚠️ **契约衔接(2026-07-04)**:[Surface App Runtime 契约 v1](./surface-app-runtime-contract-v1.md)
> 将本篇的隔离载体定为 C7 信任分界的运行面(生成代码唯一合法执行处),ToolArtifactPart
> 归入 C2 存储契约,并新增 PreviewTelemetry 回传子契约(C7-3)。

> 状态:pre-spec 设计稿(2026-07-04)。第一篇见
> [agent-source-extensibility-module-design.md](./agent-source-extensibility-module-design.md)
> (七面收口 + Agent Routes + UI Settings)。本篇深化**面 4 的 Artifact 子面**:
> 从「单实例静态 iframe」升级为可扩展的**制品体系**,并给出宿主侧与 iframe 侧两套
> React 组件族的完整设计。思想承接 AAS 权威表面范式
> ([agent-authoritative-surface-design.md](./agent-authoritative-surface-design.md)):
> artifact 是 agent 权威状态的一种**隔离投影载体**——展示走下行推送,操作走 rpc 回 agent(CQRS)。

---

## 1. 现状与缺口

### 现状(Tier4 已落地部分)

| 部件 | 位置 | 形态 |
|---|---|---|
| `ArtifactSurface` | `packages/ui/src/web-ext/artifact-surface.tsx` | sandbox iframe 底座(`allow-scripts`,不透明 origin),resize/rpc/ready/event 四种消息,push 下行通道(含 onLoad 补投) |
| `ArtifactMessage` | `packages/protocol/src/web-ext/artifact.ts` | zod 判别 union,非法丢弃 |
| 声明 | `web.config.tsx` 的 `artifact: { entry, initialHeight }` | **单实例**,source 级静态声明 |
| 挂载 | `pi-chat.tsx:1708` aside 固定 `w-96` | 门控 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` |
| 下行推送 | `pi-chat.tsx:1017` | **硬编码**:最新 assistant 文本 → `"assistant-message"` 事件 |

### 缺口(本设计的对象)

1. **单实例**:一个 source 只能声明一个 artifact;无多制品、无切换/列表/生命周期。
2. **只有静态来源**:artifact 只能来自 webext 预构建 entry;**LLM/工具无法动态产出制品**
   (报告、图表、生成的网页)——这正是记忆中 ToolArtifactPart pre-spec 想解的问题。
3. **推送通道不可扩展**:宿主推什么写死在 pi-chat;扩展/工具无法自定义下行事件。
4. **iframe 侧零 SDK**:artifact 作者手写 `postMessage`/`addEventListener`,无类型、
   无 React 封装、无自动 resize。
5. **无壳组件**:iframe 裸挂,没有标题栏/工具条/错误边界/加载态/弹出。
6. **无持久化语义**:制品不落附件系统,签名 URL 过期即坏(图像制品痛点)。

---

## 2. 统一模型:三种制品来源 × 一个渲染栈

```
                 ┌────────────────────────────────────────────┐
制品来源(三种)   │            ArtifactRegistry(per-session)   │
                 │  id → ArtifactInstance{descriptor,state}    │
┌──────────────┐ └──────────────┬─────────────────────────────┘
│ A. 静态声明   │→ 描述符         │
│  web.config  │  (source 级,   ▼
│  artifacts:{}│   会话激活即注册)┌─────────────────────────────┐
├──────────────┤                │  渲染栈(宿主组件族,§5)      │
│ B. 工具制品   │→ data part     │  ArtifactPanel(多实例管理)  │
│ data-pi-     │  (对话流事件,  │   └ ArtifactHost(壳)        │
│ artifact     │   流式可增量)  │      └ ArtifactSurface(底座)│
├──────────────┤                └─────────────────────────────┘
│ C. 命令式     │→ ui-rpc/state 桥              ▲
│  agent 扩展  │  (AAS 三扳机:确定性代码 push) │ push 总线(§6)
└──────────────┘                                │ host→iframe 事件
```

**不变量**(全部来源共享):

- 渲染终点永远是 `ArtifactSurface`(sandbox iframe,不透明 origin)——**LLM 产出的
  HTML 一律走此表面**,绝不 `dangerouslySetInnerHTML` 进宿主 DOM。
- 消息永远过 `parseArtifactMessage` zod 校验;操作永远经 rpc 回 agent(投影不可写)。
- 制品内容的持久层是**附件系统**(`att_<id>`),渲染时按需解析签名 URL——根治过期问题。

---

## 3. 协议层扩展(`packages/protocol`)

### 3.1 ArtifactDescriptor(注册表条目,新增)

```ts
// packages/protocol/src/web-ext/artifact-descriptor.ts
export const ArtifactSourceSchema = z.discriminatedUnion("kind", [
  // A:webext 预构建入口(相对 .pi/web/dist,SRI 已由 manifest 覆盖)
  z.object({ kind: z.literal("entry"), entry: z.string().min(1) }),
  // B:附件制品(工具产出;渲染时经 GET /attachments/:id 解析,永不快照签名 URL)
  z.object({ kind: z.literal("attachment"), attId: z.string().regex(/^att_/) }),
  // B:内联 HTML(小制品;上限 256KB,超限强制落附件)
  z.object({ kind: z.literal("inline"), html: z.string().max(262144) }),
]);

export const ArtifactDescriptorSchema = z.object({
  id: z.string().min(1),                       // source 级用声明 key;工具制品用 art_<nanoid>
  title: z.string().optional(),
  profile: z.enum(["web", "report", "image"]), // 三 profile:交互页 / 富文档 / 图像
  source: ArtifactSourceSchema,
  initialHeight: z.number().positive().optional(),
  presentation: z.enum(["panel", "card", "both"]).default("panel"),
  pinned: z.boolean().optional(),              // 常驻(不随消息滚出)
});
export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;
```

### 3.2 工具制品 part(来源 B 的对话流载体,新增)

复用既有 data-part 车道(`data-pi-artifact`),**不加新 SSE 帧**:

```ts
// 工具 execute 内经 emitUi 同款通道发出;流式时同 id 多帧最后写赢
export const ToolArtifactPartSchema = z.object({
  descriptor: ArtifactDescriptorSchema,
  // 喂回 LLM 的可见性:制品本体不进上下文,只进摘要(附件系统 att_ 引用哲学的延伸)
  modelVisibility: z.object({
    mode: z.enum(["summary", "none"]).default("summary"),
    summary: z.string().max(2048).optional(),
  }),
});
```

### 3.3 ArtifactMessage 保持 4 kinds,收敛事件命名

不动判别 union(封闭协议原则);在 `event.name` 上立**命名空间约定**并提供类型字典:

| 前缀 | 方向 | 例 |
|---|---|---|
| `host:*` | 宿主 → iframe | `host:assistant-message`、`host:theme`、`host:visibility` |
| `app:*` | 扩展自定义 | `app:crm:refresh` |
| `rpc:response` | 宿主 → iframe(既有) | rpc 回包回灌 |

既有硬编码的 `"assistant-message"` 迁移为 `host:assistant-message`,由内置 producer 兼容发双名一个大版本。

**PreviewTelemetry 衔接(SAR 契约 C7-3)**:沙箱产物 → agent 的健康回传走 `event` kind 的
`app:telemetry` 命名空间(四 kinds `ready/resize/rpc/event` 不扩);iframe SDK(§6)MAY 提供
采集器(`window.onerror` / `unhandledrejection` / console 摘要钩子,截断脱敏后 `emit`),
经宿主 rpc 中转回 agent;进入 LLM 上下文仍须经对话桥 ContextInjection(SAR C3-2)。

---

## 4. 声明层:web.config.tsx 多制品(来源 A)

```tsx
// .pi/web/web.config.tsx —— artifacts 复数化;单数 artifact 保留为 artifacts.default 语法糖
export default defineWebExtension({
  manifestId: "acme-crm",
  capabilities: ["artifact"],
  artifacts: {
    report: {
      entry: "artifact/report.html",     // pi-web build 多入口产物(§8)
      title: "周报",
      profile: "report",
      initialHeight: 320,
    },
    board: {
      entry: "artifact/board.html",
      title: "实时看板",
      profile: "web",
      pinned: true,                       // 会话激活即打开并常驻
    },
  },
});
```

`pi-web build` 扩展:`.pi/web/artifact/*.html` 自动识别为多入口,产物 hash 化、逐文件
SRI 记入 manifest(现只对 entry mjs 做 SRI,需补齐 artifact HTML/资产)。

---

## 5. 宿主侧组件族(`packages/ui` + `packages/react`)

### 5.1 组件层级

```
<ArtifactProvider>                      # packages/react — registry + push 总线(headless)
  <PiChat …>
    aside(或 artifactSurface 槽):
      <ArtifactPanel />                 # 多实例管理:tab 条 + 当前实例 + 空态
        <ArtifactHost descriptor={…}>   # 壳:标题栏/工具条/ErrorBoundary/加载骨架
          <ArtifactSurface … />         # 既有底座,零改动复用
    对话流内(来源 B):
      data-pi-artifact → <ArtifactPartCard />   # 制品卡:缩略 + 「在面板打开」
```

### 5.2 `ArtifactProvider` / `useArtifacts`(packages/react,headless)

```ts
export interface ArtifactsApi {
  readonly artifacts: ReadonlyArray<ArtifactInstance>;  // 注册表快照(含来源/状态)
  readonly activeId: string | undefined;
  open(id: string): void;                               // 打开并聚焦(面板可见)
  close(id: string): void;
  register(d: ArtifactDescriptor): void;                // 来源 B/C 动态注册(幂等,按 id 覆盖)
  push(id: string, name: `host:${string}` | `app:${string}`, data: unknown): void;
  resolveSrc(d: ArtifactDescriptor): Promise<ArtifactSrc>; // entry→baseUrl 拼接 /
                                                           // attachment→签名 URL 现取 / inline→srcDoc
}
export function useArtifacts(): ArtifactsApi;
```

装配关系:

- **来源 A**:webext 加载完成 → descriptor 批量 `register`;`pinned` 自动 `open`。
- **来源 B**:`data-pi-artifact` part 到达 → 内置 data-part 处理器 `register` + 按
  `presentation` 决定是否 `open`(`card` 只出对话卡)。
- **来源 C**:state 桥/ui-rpc 命令(如 `artifact:open`)→ 同一 API。三来源汇于一个注册表。
- **push 总线泛化**:pi-chat 现有的 latestAssistantText 硬编码改为 Provider 内置的一个
  producer(向所有 `profile:"web"` 实例发 `host:assistant-message`),扩展可增删 producer
  ——推送内容从此可扩展(缺口 3)。

### 5.3 `ArtifactHost`(packages/ui,壳)

```tsx
export interface ArtifactHostProps {
  readonly descriptor: ArtifactDescriptor;
  readonly rpc?: UiRpcClient;
  readonly toolbar?: React.ReactNode;      // 扩展自定义工具条追加区
  readonly onClose?: () => void;
}
```

职责(全部是缺口 5 的补齐,底座不动):

- 标题栏:title + profile 图标 + 关闭/刷新(重挂 iframe)/**弹出**(`window.open` 独立
  窗口,同 src——sandbox 语义不变)/下载(attachment 来源直链签名 URL);
- `ExtErrorBoundary` 包裹(webext 既有边界组件复用)+ 加载骨架(`ready` 消息前);
- `resolveSrc` 异步解析:attachment 来源**每次挂载现取签名 URL**(根治过期,缺口 6);
- `data-pi-artifact-host` 测试锚点。

### 5.4 `ArtifactPanel`(packages/ui,多实例管理)

- 单实例时无 tab 条,与现渲染等价(视觉零回归);多实例出 tab(title 截断 + profile 图标);
- 空态:无实例时不渲染(保持现有 aside 让位逻辑,`hasArtifactAside` 改读注册表非空);
- 非激活实例 **keep-alive**(`display:none` 而非卸载——iframe 状态保留,切 tab 不重载);
  上限 4 个活 iframe,LRU 淘汰(卸载并记状态,重开走 reload);
- 与 `panelRight` 槽共存规则沿现状:artifact 永不被 panelRatio 收起。

### 5.5 `ArtifactPartCard`(packages/ui,对话流制品卡)

注册为内置 data-part 渲染器(`data-pi-artifact` 键),webext Tier2 可按同键覆盖:

- `image` profile:直接 `<img>` 签名 URL(轻量,不开 iframe);
- `report`/`web`:标题 + 摘要 + 「在面板打开」按钮 → `useArtifacts().open(id)`;
- 流式增量:同 id 后帧覆盖前帧(与工具卡 partial 管线同语义)。

---

## 6. iframe 侧 SDK(`@blksails/pi-web-kit/artifact`,新子入口)

补齐缺口 4。零依赖核心 + 可选 React 层,**打进 artifact bundle**(iframe 内无 import map,
不能裸 import 宿主单例;React 由 artifact 自带或用核心层免 React)。

### 6.1 核心(无框架)

```ts
// @blksails/pi-web-kit/artifact
export function createArtifactClient(opts: { manifestId: string }): ArtifactClient;

export interface ArtifactClient {
  ready(): void;                                    // 握手(宿主据此撤加载骨架)
  resize(height: number): void;
  observeResize(el?: HTMLElement): () => void;      // ResizeObserver → 自动 resize
  rpc(req: { point: string; action: string; payload?: unknown }): Promise<UiRpcResult>;
                                                    // 封装 correlationId 配对 rpc:response
  onEvent<T = unknown>(name: string, cb: (data: T) => void): () => void;
  emit(name: `app:${string}`, data: unknown): void; // iframe → 宿主自定义事件
}
```

实现要点:`window.parent.postMessage(…, "*")`(不透明 origin 下唯一合法 targetOrigin,
安全性由宿主侧 `event.source` 校验 + zod 保证,与现实现一致);rpc 配对在 SDK 内部用
自增 id + `rpc:response` 过滤,超时对齐宿主 15s。

### 6.2 React 层

```tsx
// @blksails/pi-web-kit/artifact/react
export function ArtifactApp(props: {
  manifestId: string;
  children: React.ReactNode;
}): JSX.Element;          // Provider:建 client、mount 后 ready()、observeResize(root)

export function useHostEvent<T>(name: string): T | undefined;   // 最新事件值(useSyncExternalStore)
export function useAgentRpc(): ArtifactClient["rpc"];
export function useArtifactClient(): ArtifactClient;
```

### 6.3 artifact 作者范例(来源 A)

```tsx
// .pi/web/artifact/report.tsx —— 构建为 report.html 的入口
import { createRoot } from "react-dom/client";
import { ArtifactApp, useHostEvent, useAgentRpc } from "@blksails/pi-web-kit/artifact/react";

function Report(): JSX.Element {
  // 下行:宿主内置 producer 推的最新 assistant 文本(流式逐帧)
  const msg = useHostEvent<{ text: string }>("host:assistant-message");
  const rpc = useAgentRpc();
  return (
    <div>
      <h1>周报</h1>
      <pre>{msg?.text ?? "等待对话…"}</pre>
      {/* 上行:操作经 rpc 回 agent(可路由到第一篇的 Agent Routes / 贡献点) */}
      <button onClick={() => void rpc({ point: "command", action: "execute",
        payload: { id: "crm.regenerate" } })}>
        重新生成
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ArtifactApp manifestId="acme-crm"><Report /></ArtifactApp>,
);
```

---

## 7. 工具侧:动态产出制品(来源 B)

`tool-kit` 新增 helper,与附件桥咬合:

```ts
// packages/tool-kit/src/artifact/emit-artifact.ts
export async function emitArtifact(
  ctx: AttachmentToolContext,            // 既有附件工具上下文
  onUpdate: ToolUpdateFn,                // emitUi 同款通道
  input: {
    title: string;
    profile: "web" | "report" | "image";
    html?: string;                        // ≤256KB 内联;超限自动落附件
    attId?: string;                       // 已落库制品(如 AIGC 图)直接引用
    summary: string;                      // 喂回 LLM 的摘要(制品本体不进上下文)
    presentation?: "panel" | "card" | "both";
  },
): Promise<{ artifactId: string }>;
```

范例(报告工具):

```ts
const report = renderReportHtml(data);                    // 工具内确定性生成
await emitArtifact(ctx, onUpdate, {
  title: `CRM 周报 ${range}`,
  profile: "report",
  html: report,                                           // 落 att_,part 里只带引用
  summary: `已生成 ${range} 周报:成交 ${n} 笔,金额 ${amt}。`,
  presentation: "both",                                   // 对话卡 + 面板打开
});
```

安全注意:来源 B 的 HTML 是 **LLM/数据驱动内容**,渲染仍走 sandbox iframe
(`inline` → `srcDoc`;`attachment` → 签名 URL src),与来源 A 同一围栏——制品体系
不为动态内容开任何 DOM 直渲后门。

---

## 8. 目录结构与构建(模块内,承接第一篇 §4)

```
<agent-source>/.pi/web/
├── web.config.tsx            # artifacts 复数声明(§4)
├── artifact/                 # 🆕 artifact 源码目录(多入口)
│   ├── report.html           #   壳 HTML(<div id="root"> + <script src="report.js">)
│   ├── report.tsx            #   入口(ArtifactApp)
│   ├── board.html
│   ├── board.tsx
│   └── shared/               #   iframe 内共享代码(打进各 bundle)
├── styles.css
└── dist/
    ├── web-extension.mjs
    ├── manifest.json          # artifacts 各文件 SRI 补齐
    └── artifact/              # hash 化产物
        ├── report.html / report.[hash].js
        └── board.html  / board.[hash].js
```

`pi-web build` 增量:探测 `artifact/*.html` → esbuild 多入口(React 自带打包,
**不**外置到 import map)→ 产物 SRI 逐文件写 manifest → 宿主 `resolveSrc` 校验后再挂。

---

## 9. 安全与降级矩阵

| 场景 | 行为 |
|---|---|
| iframe 权限 | 恒 `sandbox="allow-scripts"`,永不加 `allow-same-origin`(弹出窗口同样) |
| 消息 | `event.source` 校验 + zod;非法丢弃(现状不变,SDK 只是封装) |
| `inline` 超 256KB | 服务端强制落附件,part 校验拒绝超限内联 |
| attachment 签名过期 | `resolveSrc` 挂载时现取;iframe 内资源过期 → Host 工具条「刷新」重挂 |
| baseUrl 未配置 | 来源 A 不挂载(现有门控);来源 B `inline/attachment` **不受此门控**(不依赖扩展静态资产) |
| webext 验签失败 | 来源 A 全禁;来源 B 仍可用(制品走附件系统信任链,与 webext 无关) |
| 实例超限 | LRU 卸载非活 iframe,tab 保留,重开 reload |

## 10. 分期路线

- **M1(宿主组件族,零协议改)**:ArtifactProvider/Panel/Host + 注册表 + push 总线泛化
  (assistant-message 迁 producer)。`artifacts` 复数声明 + 单数兼容。现有 e2e
  (webext-artifact-agent)必须零改动通过——视觉与行为回归线。
- **M2(iframe SDK)**:web-kit `artifact` 子入口(核心 + React)+ build 多入口/SRI +
  `examples/webext-artifact-agent` 升级为 SDK 写法(保留一个裸 postMessage 对照页验协议兼容)。
- **M3(工具制品)**:protocol descriptor/part schema + `emitArtifact` + `ArtifactPartCard` +
  附件落库;AIGC 图像工具迁移为首个消费者(image profile,顺手根治签名 URL 过期展示)。
- **v2 展望**:制品版本历史(附件 lineage 复用)、跨会话制品库、`report` profile 的
  导出(PDF/print)、artifact 间 postMessage 编排(需新围栏,默认关)。

## 11. 改动落点

| 落点 | 改动 |
|---|---|
| `packages/protocol/src/web-ext/` | 🆕 artifact-descriptor.ts + ToolArtifactPart;ArtifactMessage 不动 |
| `packages/react/src/web-ext/` | 🆕 artifact-provider.tsx(registry/push 总线/resolveSrc) |
| `packages/ui/src/web-ext/` | 🆕 artifact-host.tsx / artifact-panel.tsx / artifact-part-card.tsx;artifact-surface.tsx **零改动** |
| `packages/ui/src/chat/pi-chat.tsx` | aside 挂载点换 `<ArtifactPanel>`;latestAssistantText 迁 producer |
| `packages/web-kit/` | 🆕 `artifact` / `artifact/react` 子入口;build 多入口 + 逐文件 SRI |
| `packages/tool-kit/src/artifact/` | 🆕 emitArtifact(依附件桥) |
| `examples/webext-artifact-agent` | 升级 SDK 写法 + 多 artifact;🆕 examples 里加工具制品演示(可并入 module-crm-agent) |

已知坑对照:iframe 无 import map(React 必须打进 bundle,勿学 webext 单例桥)、
`NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 构建期注入、jsdom 下 iframe 行为测不了
(组件单测测 Host/Panel 逻辑,iframe 通信走浏览器 e2e)、Response/streamdown 异步高亮
勿用于制品卡摘要(同步 pre)。
