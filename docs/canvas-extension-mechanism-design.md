# Canvas 扩展机制设计(CanvasKit · 扩展模块设计 · 第三篇)

> ⚠️ **定位修订(2026-07-04)**:经 [Surface App Runtime 契约 v1](./surface-app-runtime-contract-v1.md)
> 裁决,本篇的 "kernel"(pointer/gesture/history)降级为 **Canvas 应用面的私有交互件**,
> 不是框架内核;框架内核见契约 C1-C7。实施排在契约 M-A 之后,requirements 须引用契约。

> 状态:pre-spec 设计稿(2026-07-04)。系列:
> 第一篇 [扩展模块统一设计](./agent-source-extensibility-module-design.md)(七面收口 + Routes + Settings)
> · 第二篇 [Artifact 扩展面](./artifact-extensibility-design.md)
> · 范式基础 [AAS 权威表面](./agent-authoritative-surface-design.md)。
>
> 本篇回答:**以 Canvas 为主要实现目标,把 Canvas 自身重构为可扩展宿主**——
> 舞台工具、生成动作、图层类型、检查器、参数能力全部插件化,形成
> 「pi-web 宿主 → surface → surface 内插件」的**递归扩展模型**。

---

## 1. 为什么以 Canvas 为中心重设扩展机制

### 1.1 现状:功能完整,但机制封闭

Canvas 工作台已全量在 main(M1 编辑器 + M2 标注/引用/参数簇 + M3 图层/画笔/扩图,
生成走对话流)。但它是**封闭单体**(`packages/ui/src/canvas/canvas-workbench.tsx`,2033 行):

| 封闭点 | 代码证据 | 后果 |
|---|---|---|
| 舞台工具写死 8 种 | `type StageTool = "move"\|"expand"\|"draw"\|"line"\|"arrow"\|"text"\|"mask"\|"erase"`(`:99`) | 加一个「贴纸」工具要改内核 union + 指针分支 + 工具轨 |
| 生成动作写死 6 种 | `decideGenerate` 硬编码优先级 if 链(`:184`) | 加「风格迁移」动作要改决策函数 + `ACTION_LABEL` + `buildToolPrompt` |
| 编辑历史项写死 2 种 | `type EditOp = stroke \| anno`(`:139`) | 新工具产出的操作进不了统一 undo 栈 |
| 图层只有图像 | `WorkLayer.attachmentId`(`:144`) | 文本层/形状层无处安放 |
| 模型/比例清单硬编码 | `DEFAULT_MODEL_OPTIONS`(`:111`)、`RATIO_OPTIONS`(`:128`,还内嵌 wan/gpt-image 网关知识) | agent 换 provider 后 UI 清单失真;领域知识错层 |
| 领域组件长在宿主包 | `packages/ui/src/canvas/`,example 从 `@blksails/pi-web-ui` import | **宿主中立性已破**(grep 宿主包能搜到 canvas)——AAS §6 判据不成立 |

### 1.2 目标模型:递归扩展

```
pi-web 宿主(领域无关)
  └─ 让出:具名槽 / control:state 桥 / ui-rpc / 附件系统        ← 五层 + AAS 五通道
       └─ Canvas surface(领域 = "canvas",装在 agent source 里)
            └─ 让出:工具轨 / 动作链 / 图层 / 检查器 / 能力清单   ← 本篇的 CanvasKit 扩展点
                 └─ Canvas 插件(同 source 或第三方 source 提供)
```

Canvas 既是 pi-web 的扩展(消费第一二篇的机制),又是自己插件的宿主(供给本篇机制)。
**内置能力必须自举**:现有 8 工具 6 动作全部改写为第一批插件——扩展点够不够,内置迁移
就是验收。

---

## 2. 架构:内核 / 注册表 / 插件 三层

### 2.1 新包 `@blksails/pi-web-canvas-kit`(从宿主 ui 包迁出)

```
packages/canvas-kit/
├── src/
│   ├── kernel/                    # 领域无关画布内核(不含任何 AIGC 语义)
│   │   ├── stage.ts               #   viewport/缩放平移/底图像素坐标系
│   │   ├── pointer.ts             #   指针管线:捕获→路由到激活工具(修 M3 的
│   │   │                          #   stopPropagation 挡不住 stage mousedown 类问题:
│   │   │                          #   路由唯一入口,不再多处监听)
│   │   ├── history.ts             #   统一 undo/redo 栈(op kind 开放注册)
│   │   ├── layers.ts              #   图层树(类型开放注册)
│   │   ├── bitmap-io.ts           #   client-image-ops 迁入(拍平/合成/掩码烤制)
│   │   └── attachment-io.ts       #   att_ 上传/解析接缝(Bulk 通道)
│   ├── registry/
│   │   └── canvas-registry.ts     # per-instance 插件注册表(tools/actions/layers/
│   │                              #   inspectors/capability providers;id 带命名空间)
│   ├── plugins/                   # 🆕 内置插件 = 自举(第一批消费者)
│   │   ├── tools/                 #   move/expand/draw/line/arrow/text/mask/erase
│   │   ├── actions/               #   outpaint/inpaint/reference/variants/reframe/edit
│   │   └── layers/                #   image-layer
│   ├── components/                # CanvasHost/ToolRail/PromptBar/InspectorDock/…
│   ├── hooks/                     # useStage/useCanvasTool/useSelection/useCapability/…
│   ├── define.ts                  # defineCanvasTool/Action/Layer/Inspector/Plugin
│   └── index.ts
└── test/
```

迁出后 `packages/ui` 只保留领域无关部件;`canvas-launcher`/`gallery`/`lineage-view`/
`aigc-quick-settings` 一并迁入。宿主中立性判据恢复:grep `packages/ui` + `app/` 无
canvas/aigc 字符串(canvas-kit 是**扩展侧依赖**,由 agent source 的 webext bundle 引用)。

### 2.2 设计标准:双层架构(集成核 / 开发者体验层)

canvas-kit 由**职责截然不同的两层**构成,这是本包的第一架构纪律(2026-07-04 定):

| | **L1 · 集成核(Integration Core)** | **L2 · 开发者体验层(DX / SDK)** |
|---|---|---|
| 解决什么 | 系统集成的全部复杂性 | 插件/面板作者的开发体验 |
| 承载内容 | surface 桥接与退化、附件上传编排、syncSignal 收敛与叠层自愈、settleWindow、快照式消费、坐标换算、指针唯一路由、undo 栈、StrictMode/双事件安全 | `defineCanvasTool/Action/Layer/Inspector`、hooks、类型 |
| 质量标准 | **正确**:时序/竞态/降级全覆盖,集成测试为主 | **稳定不出错**:遵循 React 惯例,pit of success,semver 承诺面 |
| 允许的样子 | 内部可以复杂(它就是复杂性的收容所) | 必须简单——一个工具 ≈ 一个对象字面量 |

**推论条款**(requirements/design 阶段据此展开):

1. **单向依赖 + 封装边界**:L2 → L1 单向;插件作者只可 import 包公开入口(`define.ts` +
   hooks + 类型),`kernel/*` 内部模块**不出现在 package exports**——作者物理上碰不到
   fd1/settleWindow/竞态这些词。
2. **复杂性不可见化验收**:L1 的每项复杂性都要给出"L2 看不见它"的证明。例:
   `onPointerDown(ev)` 拿到的 `imageX/imageY` 已换算(作者不碰 viewport);
   `history.push(op)` 不暴露栈实现;`buildArgs` 拿到的 `att_id` 已就绪
   (`requires` 声明资产需求,上传编排归内核)。
3. **默认安全 / 错误隔离**:L2 回调抛错由 L1 边界捕获——禁用该插件 + 记 diagnostics,
   **画布不崩**;类型层能挡的错(id 命名空间、通道声明二选一)不留到运行时。
4. **声明式优于命令式**:插件声明"是什么"(icon/match/buildArgs),内核决定"何时、怎么跑";
   作者写的每个决策函数都是可单测纯函数。
5. **稳定契约分离**:L2 是 semver 承诺面(破坏性改动须大版本);L1 可自由重构,
   以"内置 8 工具零改动"为兼容性回归线。
6. **惯例一致**:L2 遵循仓库既有惯例——props 注入可测(upload/canvasFactory 模式)、
   默认值下沉函数体、hooks 规则、`data-*` 测试锚点、i18n t()。

> 与 SES 的关系:SES 管"扩展面对外怎么长"(跨 domain 标准),本节管"canvas-kit 包内
> 怎么分层"(框架内部纪律);L1 正是 SES-U5/U6/U7 等韧性条款的**实现收容处**,
> L2 保证插件作者无需知道这些条款也自动合规。

### 2.3 数据流(叠加 AAS 五通道)

```
┌───────────────────────────── CanvasHost ─────────────────────────────┐
│  CanvasRegistry(插件注册表)                                          │
│    tools ───────► ToolRail + pointer 路由 + overlay + options 条      │
│    actions ─────► 决策链(评分制)→ PromptBar 主按钮标签/执行           │
│    layers ──────► 图层树渲染/拍平                                      │
│    inspectors ──► InspectorDock(选中态属性面板)                       │
│    capabilities ◄─ useSurface("canvas").state.capabilities            │
│                     (模型/尺寸/动作白名单,agent 权威下发,替硬编码)    │
│                                                                       │
│  执行双通道(action 声明选择):                                        │
│    via:"prompt"  → buildPrompt() → onSubmitPrompt(对话流,LLM 在环,  │
│                     canvas-op 代码块,回流历史 ← 现状 buildToolPrompt) │
│    via:"command" → surface.run(action, args)(ui-rpc → agent 确定性    │
│                     handler,不过 LLM ← AAS 触发源 ②)                │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 3. 扩展点契约(`define.ts`)

### 3.1 舞台工具 `defineCanvasTool`

```ts
export interface StagePointerEvent {
  readonly imageX: number;   // 底图像素坐标(内核换算好,插件不碰 viewport)
  readonly imageY: number;
  readonly pressure?: number;
  readonly raw: PointerEvent;
}

export interface ToolCtx {
  readonly stage: StageApi;                    // 只读视口/底图信息
  history: {                                   // 统一 undo 栈(op kind 见 3.2)
    push(op: CanvasOp): void;
  };
  layers: LayersApi;                           // 增删改图层(text 工具用)
  requestRender(): void;                       // 叠加层重绘
}

export interface CanvasToolPlugin {
  readonly id: string;                         // 命名空间化:"builtin:mask" / "acme:sticker"
  readonly label: string;
  readonly icon: React.ComponentType;
  readonly cursor?: string;
  readonly order?: number;                     // 工具轨排序
  readonly onPointerDown?(ev: StagePointerEvent, ctx: ToolCtx): void;
  readonly onPointerMove?(ev: StagePointerEvent, ctx: ToolCtx): void;
  readonly onPointerUp?(ev: StagePointerEvent, ctx: ToolCtx): void;
  /** 舞台叠加层(如笔刷预览圈);渲染进内核统一的 overlay 栈,自带坐标变换。 */
  readonly Overlay?: React.ComponentType<{ stage: StageApi }>;
  /** 工具激活时的选项条(如笔刷三档/颜色);渲染进 ToolRail 下方浮层(内核管 z 序,
      根治 ratio-switch 类浮层互踩)。 */
  readonly Options?: React.ComponentType;
}
export function defineCanvasTool(t: CanvasToolPlugin): CanvasToolPlugin;
```

### 3.2 编辑操作(undo 栈开放)

```ts
export interface CanvasOpKind<T = unknown> {
  readonly kind: string;                       // "builtin:stroke" / "acme:sticker-place"
  /** 拍平时如何把该 op 烤进位图(bitmap-io 回调;不烤则返回 null)。 */
  bake?(op: T, canvas: OffscreenCanvas, stage: StageApi): void;
  /** 撤销语义默认「从栈移除」;需要副作用回滚的 op 自带 revert。 */
  revert?(op: T, ctx: ToolCtx): void;
}
```

内置 `stroke`/`anno` 迁为两个 kind;新工具的操作注册 kind 即进统一 undo/redo,
不再各自维护栈。

### 3.3 生成动作 `defineCanvasAction`(替换 decideGenerate if 链)

```ts
export interface ActionInput {                 // ≈ 现 GenerateDecisionInput,补 capability
  readonly imageId: string;
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly variants: number;
  readonly hasMask: boolean;
  readonly hasExpand: boolean;
  readonly referenceIds: readonly string[];
  readonly capability: CanvasCapability;       // agent 下发(§4),match 可据此避让
}

export interface CanvasActionPlugin {
  readonly id: string;                         // "builtin:inpaint" / "acme:style-transfer"
  readonly label: string;                      // PromptBar 主按钮标签(替 ACTION_LABEL)
  /** 评分制决策:返回 false 不适用;数值越大越优先。内置动作沿现优先级给分:
      outpaint=100 > inpaint=90 > reference=80 > variants=70 > reframe=60 > edit=10(兜底)。
      第三方插队 = 给出高于目标的分数;纯函数,可单测。 */
  match(input: ActionInput): number | false;
  buildArgs(input: ActionInput): Record<string, unknown>;
  /** 执行通道(双通道二选一,见 §2.2): */
  readonly execution:
    | { readonly via: "prompt"; buildPrompt(args: Record<string, unknown>, input: ActionInput): string }
    | { readonly via: "command"; readonly command: string };   // surface.run(command, args)
  /** 前置资产需求:内核统一保障(掩码已烤/批注已拍平上传/扩图画布已合成),
      插件 buildArgs 拿到的是已就绪的 att_id——现 onGenerate 里的资产编排下沉内核。 */
  readonly requires?: { mask?: boolean; flattenAnnotations?: boolean; expandCanvas?: boolean };
}
export function defineCanvasAction(a: CanvasActionPlugin): CanvasActionPlugin;
```

决策器变为纯注册表函数(可单测,替 `decideGenerate`):

```ts
export function resolveAction(reg: CanvasRegistry, input: ActionInput): ResolvedAction {
  const scored = reg.actions
    .map((a) => ({ a, s: a.match(input) }))
    .filter((x): x is { a: CanvasActionPlugin; s: number } => x.s !== false);
  scored.sort((x, y) => y.s - x.s);
  const top = scored[0];            // 内置 edit 恒兜底(match 永远返回 10)
  return { plugin: top.a, args: top.a.buildArgs(input) };
}
```

### 3.4 图层与检查器

```ts
export interface CanvasLayerPlugin<D = unknown> {
  readonly type: string;                       // "builtin:image" / "acme:text"
  readonly Render: React.ComponentType<{ layer: LayerNode<D>; stage: StageApi }>;
  bake(layer: LayerNode<D>, canvas: OffscreenCanvas, stage: StageApi): Promise<void>;
  readonly Inspector?: React.ComponentType<{ layer: LayerNode<D>; update(d: Partial<D>): void }>;
}

export interface CanvasInspectorPlugin {       // 选中态之外的常驻检查器(如血缘视图)
  readonly id: string;
  readonly title: string;
  readonly placement: "dock" | "contextmenu";
  readonly When?: (sel: Selection) => boolean;
  readonly Render: React.ComponentType<{ selection: Selection }>;
}
```

---

## 4. 能力清单:agent 权威下发(替硬编码清单)

模型/尺寸/动作白名单从 UI 常量改为 **surface 快照的 `capabilities` 切片**,由 agent 侧
extension 装配期确定性生成(读 models.json/aigc.json 关模型清单——它本来就在 agent 进程):

```ts
export interface CanvasCapability {
  readonly models: ReadonlyArray<{ id: string; label?: string; sizes?: readonly string[] }>;
  readonly sizes: ReadonlyArray<{ label: string; size: string }>;   // 替 RATIO_OPTIONS,
                                                                    // 网关尺寸知识回归 agent 侧
  readonly actions: readonly string[];         // agent 支持的 command 动作白名单(AAS §4.3)
}
```

- 下发:并入 `surface:canvas` 快照(路线 A,零新帧);`aigc-quick-settings` 同源消费,
  与工具执行读同一偏好 KV 的现状不变。此方案取代 SES-N4 的散 KV 清单键
  (`aigc.models` 等),收敛计划见 SES 头注(v0.2)。
- 退化:`available === false` 或 capability 缺失 → 内置默认清单 + `via:"command"` 动作全隐藏
  (只剩 prompt 通道)——AAS 退化契约的 Canvas 实例。
- 顺带根治两笔历史账:模型清单退避重试(1875dec)与「16:9 选给 gpt-image 被网关拒」
  (`:126` 注释)都源于清单权威错放 UI 侧。

---

## 5. 挂载与分发:插件从哪来

三条车道,复用既有机制、不新造载体:

| 车道 | 声明 | 作用域 | 典型 |
|---|---|---|---|
| ① 同 bundle | `defineWebExtension({ canvasPlugins: [...] })`(新 capability 键) | 该 source 的 Canvas 实例 | aigc-canvas-agent 自带全部内置插件 |
| ② 第三方插件包 | `pi-web.json` 的 `web.canvasPlugins`(第一篇 §5 清单加一键) | 安装后对声明消费它的 Canvas 生效 | 「水印工具包」npm 包 |
| ③ 运行时(agent 命令) | capability.actions 驱动(纯 command 动作可零 UI 代码出现在动作链) | 会话 | agent 只在后端加 handler,前端按钮自动长出 |

注册表 per Canvas 实例(Tier2 renderer 同款命名空间语义):`<extId>:<pluginId>` 前缀,
同 id 拒绝后注册者(先注册者保持)并记 diagnostics(M3 spec 修正:原「后装覆盖先装」表述
与 M1/M2 工具/动作注册的拒绝语义不一致,拍板②改为拒绝语义,文档与实现归位)。车道 ②
走 webext 全套验签(插件是浏览器代码)。

---

## 6. 范例代码

### 6.1 自定义舞台工具:贴纸(第三方插件包)

```tsx
// acme-canvas-stickers/src/sticker-tool.tsx
import { defineCanvasTool, defineCanvasLayer } from "@blksails/pi-web-canvas-kit";
import { StickerIcon, StickerPicker } from "./ui.js";

export const stickerLayer = defineCanvasLayer<{ emoji: string; size: number }>({
  type: "acme:sticker",
  Render: ({ layer }) => <span style={{ fontSize: layer.data.size }}>{layer.data.emoji}</span>,
  async bake(layer, canvas) { /* 拍平:emoji 绘入位图 */ },
  Inspector: ({ layer, update }) => (
    <input type="range" min={16} max={256} value={layer.data.size}
      onChange={(e) => update({ size: Number(e.currentTarget.value) })} />
  ),
});

export const stickerTool = defineCanvasTool({
  id: "acme:sticker",
  label: "贴纸",
  icon: StickerIcon,
  Options: StickerPicker,                      // 工具选项条:选 emoji
  onPointerDown(ev, ctx) {
    const id = ctx.layers.add({
      type: "acme:sticker",
      x: ev.imageX, y: ev.imageY,
      data: { emoji: StickerPicker.current(), size: 64 },
    });
    ctx.history.push({ kind: "acme:sticker-place", layerId: id });   // 进统一 undo 栈
  },
});
```

### 6.2 自定义生成动作:风格迁移(command 通道,不过 LLM)

```ts
// UI 侧插件
export const styleTransferAction = defineCanvasAction({
  id: "acme:style-transfer",
  label: "风格迁移",
  match: (i) =>
    i.referenceIds.length === 1 &&
    i.prompt.startsWith("style:") &&
    i.capability.actions.includes("style_transfer")     // agent 不支持则永不出现
      ? 85                                              // 插在 reference(80) 之前
      : false,
  buildArgs: (i) => ({
    image: i.imageId,
    style_ref: i.referenceIds[0],
    strength: 0.8,
    ...(i.model !== "" ? { model: i.model } : {}),
  }),
  execution: { via: "command", command: "style_transfer" },   // → surface.run(...)
});
```

```ts
// agent 侧(同一插件包的 pi extension;AAS createSurface 的 commands 注册)
const canvas = createSurface<CanvasState>({
  domain: "canvas",
  initialState: EMPTY,
  hydrate: rebuildFromAttachments,
  commands: {
    style_transfer: async (args, ctx) => {
      const { image, style_ref, strength, model } = parse(args);
      const res = await runImageTool({ image, reference_images: [style_ref], prompt: STYLE_PROMPT(strength), model },
        ctx.attachments, undefined, undefined, EDIT_ROUTE_CONFIG);
      if (!res.details.ok) return { error: { code: "style_failed", message: res.details.error } };
      ctx.setState((s) => prependAssets(s, res.details.assets, { derivedFrom: image }));
      return { ids: res.details.assets.map((a) => a.attachmentId) };
    },
  },
});
```

两端由 `pi-web.json` 的 `bindings` 锚定(第一篇两层咬合锚点的 Canvas 版):

```jsonc
{
  "id": "acme-canvas-stickers",
  "pi":  { "extensions": ["extensions/style-transfer.ts"] },
  "web": { "dist": ".pi/web/dist", "canvasPlugins": ["acme:sticker", "acme:style-transfer"] },
  "bindings": { "surfaceCommands": { "canvas": ["style_transfer"] } }
}
```

### 6.3 内置动作自举(inpaint 迁移示意)

```ts
export const inpaintAction = defineCanvasAction({
  id: "builtin:inpaint",
  label: "局部重绘",
  match: (i) => (i.hasMask ? 90 : false),
  requires: { mask: true },                    // 掩码烤制/上传由内核保障
  buildArgs: (i) => withCommon(i, { image: i.imageId, prompt: i.prompt }),
  execution: {
    via: "prompt",                             // 现状语义保持:LLM 在环,回流对话历史
    buildPrompt: (args) => renderCanvasOp("局部重绘", { ...args, tool: "image_edit" }),
  },
});
```

`buildToolPrompt` 泛化为 `renderCanvasOp`(标题行 + canvas-op fence 的通用渲染器),
各内置动作只声明参数——单测面从一个大函数变成每动作独立纯函数。

---

## 7. 与前两篇及 AAS 的关系

| 机制 | 本篇如何消费 |
|---|---|
| AAS 五通道 | State=capability+画廊快照;Command=`via:"command"` 动作;Prompt=`via:"prompt"` 动作;Bulk=requires 资产编排产出 att_;Capability=actions 白名单驱动插件显隐 |
| 第一篇 · 清单 | `web.canvasPlugins` + `bindings.surfaceCommands` 两个新键 |
| 第一篇 · Settings | Canvas 偏好(默认模型/尺寸)可迁 source settings 面板,装配期喂 capability |
| 第二篇 · Artifact | `presentation:"card"` 的生成结果可同时发工具制品卡;Canvas 面板与制品卡指向同一 `att_id`(两视图天然去重,AAS §2.4-C) |
| webext 五层 | 挂载不变:launcherRail/panelRight/promptToolbar 槽;canvasPlugins 是新 capability 键,不是新 tier |

## 8. 分期路线(内置自举 = 回归线)

- **M1 · 内核抽取 + 工具插件化**:canvas-kit 建包,kernel(stage/pointer/history/layers/
  bitmap-io)从单体析出;8 内置工具迁 `defineCanvasTool`;EditOp → CanvasOpKind。
  **验收 = 现有 canvas 单测 + e2e 全绿零改动**(行为回归线);pointer 唯一路由顺带根治
  「层内 stopPropagation 挡不住 stage mousedown」类 bug。
- **M2 · 动作链 + 能力下发**:6 内置动作迁 `defineCanvasAction`(评分制);
  `decideGenerate`/`buildToolPrompt` 退役为兼容 re-export;capability 切片进 surface 快照,
  硬编码清单退为 fallback;`resolveAction`/各动作 match 全部纯函数单测。
- **M3 · 插件车道 + 范例**:`canvasPlugins` capability(车道 ①②)+ 注册表命名空间 +
  `examples/canvas-plugin-stickers`(6.1+6.2 完整双端范例)+ 浏览器 e2e
  (装插件 → 工具轨出现 → 画贴纸 → 风格迁移走 command 通道回流画廊)。
- **前置小修**(可先行,独立价值):`piweb_state` 粘性登记(AAS §8-8,刷新丢画廊的根);
  canvas 组件迁包的 import 兼容(`@blksails/pi-web-ui` 保留 re-export 一个大版本)。

## 9. 未决问题(立 spec 前拍板)

1. **迁包边界**:canvas-kit 独立包(推荐,恢复宿主中立)vs 留在 ui 包下子路径导出
   (省一次搬迁,但中立性判据继续不成立)?
2. **车道 ③ 的 UI 形态**:capability.actions 里 UI 无插件声明的动作,自动长出「通用按钮」
   (label 取命令名)还是仅供已声明插件 match 使用(保守,推荐)?
3. **插件间依赖**:贴纸工具依赖贴纸图层类型——注册表做拓扑校验(缺依赖整插件禁用进
   diagnostics)还是放任运行时报错?
4. **prompt 通道的 canvas-op fence 契约**:是否把 `canvas-op` 块格式提为 protocol 级
   schema(LLM 提示词稳定性 vs 灵活性)?
5. **多 Canvas 实例**:同会话多张底图并行编辑(tab?)——注册表已 per-instance,
   但 surface 快照与偏好 KV 是会话级,需定 key 分桶规则。
