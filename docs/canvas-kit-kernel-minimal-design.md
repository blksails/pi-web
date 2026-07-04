# canvas-kit 最小内核设计(规范代码)· 供评审

> 状态:pre-design 评审稿(2026-07-04),spec `canvas-kit-m1` 的设计前置。
> 上游:[CanvasKit 设计](./canvas-extension-mechanism-design.md)(§2.2 双层架构标准)。
> 本稿只覆盖 **M1 最小内核**:engine + 指针路由 + 手势 + 历史 + 工具插件点。
> 动作链/能力下发(M2)、webext 插件车道(M3)不在此列。
> 代码为**规范级接口**(normative):落地时字段与语义不得偏离,实现细节可调。

---

## 0. 六个待拍板的设计决策(评审看点)

| # | 决策 | 一句话理由 | 消化了单体里的什么 |
|---|---|---|---|
| D1 | 内核是**框架无关 store**(`createCanvasEngine`),React 经 `useSyncExternalStore` 绑定 | 插件逻辑不依赖 React 生命周期,纯 TS 可单测;组件只是投影 | workbench 里 20+ 个散 `useState` 的隐式耦合 |
| D2 | **手势会话(gesture)归内核**:pointerdown 开启、pointerup 自动收束 | 工具作者写朴素命令式代码,不碰 ref 镜像 | `draftRef`/`annoDraftRef`/`drawing.current` 整套 StrictMode 防御(`:519-527`) |
| D3 | **指针唯一路由**:stage 只挂一套 pointer handler,统一换算坐标后派发给激活工具;平移(move)也是插件 | 双事件 bug 族(mousedown/pointerdown 两套监听)物理根除 | `onStageMouseDown` 与层内 `stopPropagation` 挡不住的 2 倍位移坑(`:1571`) |
| D4 | 工具**能力声明** `requires`,禁用态由内核统一计算 | 禁用逻辑从 UI 硬编码变成声明 | `maskToolsDisabled = !available \|\| upload===undefined \|\| busy`(`:1357`) |
| D5 | **prefs KV 切片**承载跨工具 UI 偏好(笔刷比例/标注色) | annoColor 被 4 个工具共享,放单工具 options 会碎裂 | `brushRatio`/`annoColor` useState(`:437-439`) |
| D6 | M1 历史栈**kind 开放但无 OpKind 注册表**(只存 + 按 kind 过滤);bake/revert 注册表推迟到 M2 | 最小化:M1 的消费方(strokesToMask 等)仍是 bitmap-io 纯函数 | `EditOp` 二元 union(`:139`)→ 开放 `kind: string` |

---

## 1. 分层与导出边界(L1 物理封装)

```jsonc
// packages/canvas-kit/package.json(节选)
{
  "name": "@blksails/pi-web-canvas-kit",
  "exports": {
    ".": "./src/index.ts",              // L2:define*/hooks/components/types
    "./plugins": "./src/plugins/index.ts" // 内置插件集(装配用)
    // ⚠ kernel/* 与 registry/* 无导出条目 —— 作者物理上 import 不到
  }
}
```

```
src/
├── kernel/            # L1(不导出):engine.ts / pointer.ts / gesture.ts / history.ts
│                      #              layers.ts / prefs.ts / guard.ts
├── registry/          # L1(不导出):tool-registry.ts
├── plugins/tools/     # 内置 8 工具(L2 的第一批消费者 = 自举验收)
├── components/        # CanvasHost / CanvasStage / ToolRail / ToolOverlayHost
├── hooks/             # useCanvasEngine / useEngineSelector / useGesture / usePrefs / useHistory
├── define.ts          # L2:defineCanvasTool
├── types.ts           # L2:全部公开类型(下文 §2)
└── index.ts
```

---

## 2. 公开类型(L2 契约,`types.ts`)

```ts
// ── 标识 ──────────────────────────────────────────────────────────────────────
/** 工具 id:命名空间强制(类型层挡裸名)。内置恒 `builtin:`。 */
export type CanvasToolId = `${string}:${string}`;

// ── 坐标与舞台(只读投影)──────────────────────────────────────────────────────
/** 指针事件:内核已换算**底图像素坐标**;作者永远不碰 viewport/scale/rect。 */
export interface StagePointerEvent {
  readonly imageX: number;
  readonly imageY: number;
  readonly clientX: number;   // 浮层定位用(文本编辑器等)
  readonly clientY: number;
  readonly raw: PointerEvent;
}

/** 舞台只读信息(渲染与换算由内核负责,此处仅供工具决策)。 */
export interface StageInfo {
  /** 底图自然尺寸;未加载为 null(工具此时收不到指针事件,见 §3 路由不变量)。 */
  readonly natural: { readonly w: number; readonly h: number } | null;
  /** 短边像素(笔刷/标注尺寸按比例换算的基准)。 */
  readonly shortEdge: number;
  readonly scale: number;
}

// ── 历史(D6:kind 开放,无注册表)─────────────────────────────────────────────
export interface CanvasOp<D = unknown> {
  readonly kind: `${string}:${string}`;   // 如 "builtin:stroke" / "builtin:anno"
  readonly data: D;
}

// ── 图层(M1 仅图像层,类型开放留给 M2+)──────────────────────────────────────
export interface CanvasLayer {
  readonly id: string;
  readonly attachmentId: string;
  readonly displayUrl: string;
  readonly x: number; readonly y: number;
  readonly w: number; readonly h: number;
}

// ── 工具上下文(ToolCtx:L2 能看见的全部内核能力)────────────────────────────────
export interface GestureApi {
  /** 读当前手势草稿(pointerdown→pointerup 生命周期,内核自动清理)。 */
  data<D>(): D | undefined;
  /** 写草稿(触发 Overlay 订阅重绘)。 */
  set<D>(data: D): void;
}

export interface ToolCtx {
  readonly stage: StageInfo;
  readonly gesture: GestureApi;                       // D2
  readonly history: {
    push(op: CanvasOp): void;                          // 入统一 undo 栈
  };
  readonly layers: {
    add(input: Omit<CanvasLayer, "id">): string;
    update(id: string, patch: Partial<Omit<CanvasLayer, "id">>): void;
    remove(id: string): void;
  };
  readonly prefs: {                                    // D5:跨工具 UI 偏好
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
  };
  /** 浮层请求(文本编辑器一类"up 时才挂载"的交互;内核保证挂载时序,消化 pendingText 坑)。 */
  openFloatingInput(at: { left: number; top: number }, onCommit: (value: string) => void): void;
}

// ── 工具插件(L2 核心契约)────────────────────────────────────────────────────
export interface CanvasToolPlugin {
  readonly id: CanvasToolId;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly cursor?: string;          // 激活时 overlay 光标
  readonly order?: number;           // 工具轨排序(缺省按注册序)
  /**
   * 能力声明(D4):内核据宿主注入计算禁用态,禁用工具在工具轨置灰。
   * upload=需要上传接缝;surface=需要 A 档可用(探针);busyBlocks=生成中禁用(默认 true)。
   */
  readonly requires?: {
    readonly upload?: boolean;
    readonly surface?: boolean;
    readonly busyBlocks?: boolean;
  };
  readonly onPointerDown?: (ev: StagePointerEvent, ctx: ToolCtx) => void;
  readonly onPointerMove?: (ev: StagePointerEvent, ctx: ToolCtx) => void;
  readonly onPointerUp?: (ev: StagePointerEvent, ctx: ToolCtx) => void;
  /** 舞台叠加层(与底图同坐标系渲染,内核负责变换;读 useGesture/useHistory 绘制)。 */
  readonly Overlay?: React.ComponentType;
  /** 工具激活时的选项条(渲染进工具轨下方,内核管 z 序)。 */
  readonly Options?: React.ComponentType;
}
```

```ts
// define.ts(L2)—— 恒等 + 编译期校验,零运行时开销(agent-kit defineAgent 同款惯例)
export function defineCanvasTool(t: CanvasToolPlugin): CanvasToolPlugin {
  return t;
}
```

---

## 3. 内核 engine(L1,`kernel/engine.ts`)

```ts
/** 引擎快照(不可变;切片引用未变则严格相等 —— useSyncExternalStore 友好)。 */
export interface EngineSnapshot {
  readonly stage: StageInfo & {
    readonly offset: { readonly x: number; readonly y: number };
    readonly expand: ExpandEdges;
  };
  readonly ops: readonly CanvasOp[];
  readonly redoOps: readonly CanvasOp[];
  readonly layers: readonly CanvasLayer[];
  readonly selectedLayer: string | null;
  readonly activeToolId: CanvasToolId;
  readonly gesture: unknown | undefined;       // 当前手势草稿(Overlay 订阅)
  readonly prefs: Readonly<Record<string, unknown>>;
  /** 禁用工具集(D4:由 requires × 宿主能力计算,含诊断禁用)。 */
  readonly disabledTools: ReadonlySet<CanvasToolId>;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface EngineInit {
  readonly tools: readonly CanvasToolPlugin[];
  /** 宿主能力(SlotHost 注入的投影;undefined 即缺失,对应 requires 禁用)。 */
  readonly caps: { readonly upload: boolean; readonly surface: boolean };
  readonly initialToolId?: CanvasToolId;       // 缺省第一个非禁用工具
}

export interface CanvasEngine {
  getSnapshot(): EngineSnapshot;
  subscribe(listener: () => void): () => void;
  /** 命令面(组件/工具经此改状态;全部同步、可单测): */
  readonly actions: {
    setActiveTool(id: CanvasToolId): void;
    setBusy(busy: boolean): void;              // 宿主 busy 投影(影响 disabledTools)
    undo(): void;
    redo(): void;
    clearOps(kinds?: readonly string[]): void; // 快照式消费由调用方传 kind 过滤
    setNatural(size: { w: number; h: number } | null): void;
    // …stage 平移/缩放/expand 同风格,略
  };
  /** 指针路由入口(§4):返回挂到 overlay 元素上的一组 handler。 */
  pointerHandlers(): StagePointerHandlers;
  /** 逐 kind 取 ops(工具/编排消费,如 strokesToMask 的输入)。 */
  opsOf<D>(kind: `${string}:${string}`): readonly D[];
}

export function createCanvasEngine(init: EngineInit): CanvasEngine;
```

**不变量(normative)**:

- E1 快照不可变、切片稳定引用;所有 mutation 走 `actions`(便于单测与追溯)。
- E2 `disabledTools` 是唯一禁用真源:`requires.upload && !caps.upload`、
  `requires.surface && !caps.surface`、`busy && busyBlocks!==false`、以及**错误隔离禁用**(§5)。
- E3 切换底图(`setNatural` 变更)= 复位视图 + 清历史/图层/手势(单体 `:539` 的清空 effect 收编为原子 action)。

---

## 4. 指针唯一路由(L1,`kernel/pointer.ts`)· D2+D3

```ts
export interface StagePointerHandlers {
  readonly onPointerDown: (e: React.PointerEvent) => void;
  readonly onPointerMove: (e: React.PointerEvent) => void;
  readonly onPointerUp: (e: React.PointerEvent) => void;
  readonly onPointerCancel: (e: React.PointerEvent) => void;
  readonly onWheel?: never;   // 滚轮缩放由 CanvasStage 内核自装(native 非 passive)
}
```

**路由规则(normative)**:

- P1 **stage 上只存在这一套指针监听**。mouse* 事件一律不用;层拖拽/扩图手柄等元素级交互
  也经内核 `beginElementDrag(session)` 登记,由同一路由派发——`stopPropagation` 类
  补丁从此无处可写。
- P2 事件到达即换算 `imageX/imageY`(经 overlay rect,天然含 transform);
  `natural === null` 时**不派发**(消化"掩码画不上"的空 overlay 坑,`:553`)。
- P3 pointerdown:`setPointerCapture` → 开手势会话 → 派发激活工具 `onPointerDown`;
  move/up 只派发给**同一工具**(会话锁定,切工具不串);up/cancel 后内核清 gesture。
- P4 工具回调**同步**执行;回调抛错走 §5 错误隔离,路由自身永不中断。

---

## 5. 错误隔离(L1,`kernel/guard.ts`)· 双层标准推论 3

```ts
export interface PluginDiagnostic {
  readonly pluginId: CanvasToolId;
  readonly hook: string;            // "onPointerDown" | "Overlay" | …
  readonly error: string;
  readonly at: number;              // 单调计数(非时钟;可重放)
}
```

**规则(normative)**:

- G1 所有插件回调经 guard 包裹:抛错 → 记 `diagnostics` + 该插件加入 `disabledTools`
  (工具轨置灰 + title 显示诊断),**画布不崩、手势安全收束**。
- G2 `Overlay`/`Options` 组件经 `ExtErrorBoundary`(复用 webext 既有边界)同策略隔离。
- G3 内置插件(`builtin:`)同样过 guard——自举即验收,不开后门。

---

## 6. React 绑定(L2,`hooks/` + `components/`)

```ts
// hooks(全部薄封装 useSyncExternalStore,无自有状态)
export function useCanvasEngine(init: EngineInit): CanvasEngine;          // useMemo 持有
export function useEngineSelector<T>(e: CanvasEngine, sel: (s: EngineSnapshot) => T): T;
export function useGesture<D>(e: CanvasEngine): D | undefined;            // Overlay 用
export function usePrefs<T>(e: CanvasEngine, key: string): [T | undefined, (v: T) => void];
```

```tsx
// components/CanvasHost.tsx —— 组合根(M1 由 CanvasWorkbench 内部使用)
export interface CanvasHostProps {
  readonly engine: CanvasEngine;
  readonly imageUrl: string;                 // 当前底图
  readonly children?: React.ReactNode;       // 编排层浮层(版本条/提示词栏等,M1 留在 workbench)
}
// 内部装配:CanvasStage(img + overlay canvas + pointerHandlers + 滚轮缩放)
//        + ToolOverlayHost(激活工具 Overlay,同坐标系变换)
//        + ToolRail(注册表驱动:按 order 渲染、disabledTools 置灰、Options 下挂)
```

---

## 7. 自举示例:掩码刷迁移前后(内置工具即规范用例)

```ts
// plugins/tools/mask.ts —— 全部复杂性(ref 镜像/StrictMode/capture/坐标)已不可见
import { defineCanvasTool } from "../../define.js";
import type { MaskStroke } from "../../types.js";
import { Brush } from "lucide-react";
import { MaskOverlay } from "./mask-overlay.js";
import { BrushOptions, BRUSH_RATIO_DEFAULT } from "./brush-options.js";

export const maskTool = defineCanvasTool({
  id: "builtin:mask",
  label: "掩码刷",
  icon: Brush,
  cursor: "crosshair",
  requires: { upload: true, surface: true },          // D4:替 maskToolsDisabled
  onPointerDown(ev, ctx) {
    const ratio = ctx.prefs.get<number>("brushRatio") ?? BRUSH_RATIO_DEFAULT;
    const size = Math.max(1, Math.round(ctx.stage.shortEdge * ratio));
    ctx.gesture.set<MaskStroke>({ mode: "paint", size, points: [{ x: ev.imageX, y: ev.imageY }] });
  },
  onPointerMove(ev, ctx) {
    const d = ctx.gesture.data<MaskStroke>();
    if (d !== undefined)
      ctx.gesture.set({ ...d, points: [...d.points, { x: ev.imageX, y: ev.imageY }] });
  },
  onPointerUp(_ev, ctx) {
    const d = ctx.gesture.data<MaskStroke>();
    if (d !== undefined && d.points.length > 0)
      ctx.history.push({ kind: "builtin:stroke", data: d });
    // gesture 由内核自动清理 —— 无 draftRef、无 drawing.current
  },
  Overlay: MaskOverlay,     // useGesture + useEngineSelector(opsOf) 重绘半透明粉红
  Options: BrushOptions,    // usePrefs("brushRatio") 三档
});
```

对照单体:同一能力现在横跨 `:437,:519-527,:847,:1089-1191,:1372,:1400-1422` 六处;
迁移后是**一个文件一个对象字面量**——这就是 L2 的验收样貌。

**M1 编排边界**:`generate`(决策/上传编排/双通道)、版本条、提示词栏**留在
CanvasWorkbench**(它变成 canvas-kit 的组合根消费者),消费接缝仅 `engine.opsOf("builtin:stroke")`
/ `opsOf("builtin:anno")` 替代今日的 `strokes`/`annotations` useMemo——动作链插件化是 M2。

---

## 8. 验收映射(供 requirements 阶段引用)

| 验收 | 判据 |
|---|---|
| 行为回归线 | `packages/ui/test/canvas/*` 与 e2e canvas 闭环零改动全绿(`data-canvas-*` 锚点悉数保留) |
| 双层封装 | `@blksails/pi-web-canvas-kit` 无 `./kernel` 导出;插件文件 grep 无 `useRef`/`setPointerCapture`/`stopPropagation` |
| 唯一路由 | stage/层/手柄的 mouse* 监听为 0;指针监听仅 `pointerHandlers()` 一处挂载 |
| 错误隔离 | 新增单测:工具回调抛错 → 画布存活 + 工具置灰 + diagnostics 有记录 |
| 自举 | 8 内置工具全部经 `defineCanvasTool` + registry,无内核私通道 |
```
