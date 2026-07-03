/**
 * CanvasWorkbench — 格子展开工作台(aigc-canvas · Req 4.1 / 4.6 / 5.2 / 5.4 / 6.x / 10.3)。
 *
 * M2 画布编辑器:舞台(滚轮缩放/移动工具平移)+ 右侧工具轨(移动/画线/箭头/文本/掩码刷/擦除/
 * 撤销重做)+ overlay 画布(掩码粉红 + 标注红)+ 底部居中提示词栏(@多图引用 + 比例/变体参数簇)
 * + 左侧垂直版本条。全部控件为舞台上的浮动层,画板满幅。
 *
 *  - **A 档**:底部「生成」按舞台状态决策动作(见 {@link decideGenerate}):
 *    掩码笔迹 → `inpaint`(笔迹经 `strokesToMask` 光栅化为 **alpha mask PNG**,OpenAI 标准:
 *    透明洞=编辑区)＞ @引用/标注 → `reference`(标注经 `annotationsToImage` 拍平为批注参考图,
 *    标注即指令)＞ 变体数≥2 → `variants` ＞ 仅比例 → `reframe` ＞ `edit`。
 *    `args` 仅 `att_` 引用 + 文本,无二进制。
 *  - **B 档**:掩码/标注/旋转/回贴合成全在本地 Canvas 2D;产物经既有上传接缝落新 `att_` →
 *    `run("register", ...)`(Req 5.2);`available===false` 时仅本地呈现、**不 register**(Req 9.3)。
 *  - **带入对话**:显式动作经 Prompt 通道注入 `att_id`(默认不注入,Req 4.6)。
 *
 * slot 组件经 prop 注入 surface(领域无关搬运)。B 档上传接缝与 canvas 工厂经 props 注入(可测)。
 */
import * as React from "react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset, GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  ArrowLeft,
  ArrowUpRight,
  AtSign,
  Brush,
  Eraser,
  Hand,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minus,
  Plus,
  Redo2,
  RotateCw,
  Slash,
  Sparkles,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Popover, PopoverContent, PopoverAnchor } from "../ui/popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../lib/cn.js";
import {
  annotationsToImage,
  compositeByMask,
  drawAnnotations,
  flattenLayers,
  hasMaskContent,
  rotateImage,
  strokesToMask,
  uploadDataUri,
  type Annotation,
  type CanvasFactory,
  type ImageSourceLike,
  type MaskStroke,
  type UploadFn,
} from "./client-image-ops.js";

const DOMAIN = "canvas";
const PROBE = `surface:${DOMAIN}`;
const STATE_KEY = `surface:${DOMAIN}`;

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/**
 * busy 解锁窗:`surface.run` 结果在 prod 毫秒级配对回包;但 **next dev(StrictMode)** 双跑空闲
 * 控制流 effect 的竞争会令 ui-rpc 回包帧丢失,run 只能等满 ui-rpc bus 15s 超时结算。命令效果
 * 本就经权威快照回流呈现(与 run resolve 无关),故 busy 以短窗 race 解锁,不吊死交互。
 */
const RUN_SETTLE_MS = 4000;
function settleWindow<T>(p: Promise<T>, ms = RUN_SETTLE_MS): Promise<unknown> {
  return Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/** 舞台工具。 */
type StageTool = "move" | "line" | "arrow" | "text" | "mask" | "erase";

/** 笔刷直径预设:占源图**短边**的比例(固定像素对小图荒谬——1×1 占位图一笔全屏)。 */
const BRUSH_RATIOS = [0.025, 0.05, 0.1] as const;

/** 标注线宽:短边比例(固定,不入笔刷三档)。 */
const ANNOTATION_RATIO = 0.008;

/**
 * 模型下拉的内置常用清单(AIGC 图像模型;运行时可用性取决于 provider 配置,宿主可经
 * `modelOptions` prop 覆盖为动态清单)。空值 = 交给工具默认模型。
 */
const DEFAULT_MODEL_OPTIONS: readonly string[] = [
  "gpt-image-2",
  "wan2.7-image-pro",
  "qwen-image-edit-max",
  "qwen-image-2.0",
  "wan2.6-t2i",
  "wanx2.1-t2i-turbo",
];

/** Radix Select 不接受空字符串 item value;以哨兵表示「默认模型」。 */
const MODEL_DEFAULT_SENTINEL = "__default__";

/** 比例参数簇(size="" = 交给模型默认;对齐 gpt-image 支持的输出尺寸)。 */
const RATIO_OPTIONS: readonly { label: string; size: string }[] = [
  { label: "默认", size: "" },
  { label: "1:1", size: "1024x1024" },
  { label: "3:2", size: "1536x1024" },
  { label: "2:3", size: "1024x1536" },
];

/** 浮动层公共观感(舞台上的悬浮控件)。 */
const FLOAT_LAYER =
  "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 shadow-md backdrop-blur";

/** 统一编辑历史项(掩码笔迹与标注共栈,撤销/重做按操作顺序)。 */
type EditOp =
  | { readonly kind: "stroke"; readonly item: MaskStroke }
  | { readonly kind: "anno"; readonly item: Annotation };

/** 舞台图层(M3;位置/尺寸为**底图像素坐标**,后加的在上;独立于 undo 栈)。 */
interface WorkLayer {
  readonly id: string;
  readonly attachmentId: string;
  readonly displayUrl: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 加载后的可绘源(拍平用;异步填充)。 */
  readonly loaded?: LoadedImage;
}

// ── 生成决策(纯函数,export 供单测)────────────────────────────────────────────

export interface GenerateDecisionInput {
  readonly imageId: string;
  readonly prompt: string;
  readonly model: string;
  /** 掩码就绪(有 paint 笔迹且上传接缝可用)。 */
  readonly hasMask: boolean;
  /** 参考图 att_id 序列(@引用 + 已拍平上传的批注图)。 */
  readonly referenceIds: readonly string[];
  /** 变体数(1 = 不走 variants)。 */
  readonly variants: number;
  /** 输出尺寸("" = 默认)。 */
  readonly size: string;
}

export interface GenerateDecision {
  readonly action: "inpaint" | "reference" | "variants" | "reframe" | "edit";
  /** 命令 args(inpaint 的 `mask` 由调用方在掩码上传后补充)。 */
  readonly args: Record<string, unknown>;
}

/**
 * 生成动作决策:掩码 ＞ 引用/标注 ＞ 变体 ＞ 仅比例(空 prompt)→ reframe ＞ edit。
 * size/model 作为参数随主动作附带(schema 各动作均可选支持)。
 */
export function decideGenerate(i: GenerateDecisionInput): GenerateDecision {
  const base: Record<string, unknown> = { image: i.imageId, prompt: i.prompt };
  if (i.model !== "") base.model = i.model;
  if (i.size !== "") base.size = i.size;
  if (i.hasMask) return { action: "inpaint", args: base };
  if (i.referenceIds.length > 0) {
    const args: Record<string, unknown> = { ...base, reference_images: [...i.referenceIds] };
    if (i.variants >= 2) args.n = i.variants;
    return { action: "reference", args };
  }
  if (i.variants >= 2) return { action: "variants", args: { ...base, n: i.variants } };
  if (i.prompt.trim() === "" && i.size !== "") return { action: "reframe", args: base };
  return { action: "edit", args: base };
}

const ACTION_LABEL: Record<GenerateDecision["action"], string> = {
  inpaint: "局部重绘",
  reference: "融合生成",
  variants: "生成变体",
  reframe: "重构比例",
  edit: "生成",
};

/**
 * 把生成决策组装为**经对话流**的用户消息(LLM 据此调 `image_edit` 工具;参数用 `att_` 引用,
 * attachment-bridge 在工具侧解析)。操作因此天然回流对话历史:用户消息 + 工具卡片 + 结果图
 * 全部可见、可回放、进 LLM 上下文(后续"刚才那张再调亮"能接上)。export 供单测。
 */
export function buildToolPrompt(d: GenerateDecision, opts?: { maskId?: string }): string {
  const a = d.args;
  const lines: string[] = [
    `请直接调用 image_edit 工具执行以下${ACTION_LABEL[d.action]}(参数已备齐,不要追问):`,
    `- image: ${String(a.image)}`,
  ];
  if (opts?.maskId !== undefined) {
    lines.push(`- mask: ${opts.maskId}(alpha mask,透明区=需要重绘的区域)`);
  }
  const refs = a.reference_images;
  if (Array.isArray(refs) && refs.length > 0) {
    lines.push(`- reference_images: ${refs.map(String).join(", ")}(首张若为批注图,按其箭头/文字指示修改)`);
  }
  if (typeof a.prompt === "string" && a.prompt.trim() !== "") {
    lines.push(`- prompt: ${a.prompt}`);
  } else if (d.action === "reframe") {
    lines.push(`- prompt: 保持画面内容,仅按目标尺寸重构比例`);
  }
  if (typeof a.size === "string") lines.push(`- size: ${a.size}`);
  if (typeof a.n === "number") lines.push(`- n: ${a.n}`);
  if (typeof a.model === "string") lines.push(`- model: ${a.model}`);
  return lines.join("\n");
}

/** 从 asset 派生只读元信息摘要片段(缺项跳过)。 */
function summarizeGenParams(asset: GalleryAsset): string[] {
  const parts: string[] = [];
  const gp = asset.genParams as Record<string, unknown> | undefined;
  const size = gp?.size;
  if (typeof size === "string" && size !== "") parts.push(size);
  parts.push(asset.origin === "upload" ? "上传" : "工具生成");
  if (asset.derivedFrom !== undefined && asset.derivedFrom !== "") {
    parts.push(`派生自 …${asset.derivedFrom.slice(-6)}`);
  }
  const modelName = gp?.model;
  if (typeof modelName === "string" && modelName !== "") parts.push(modelName);
  return parts;
}

/** 已加载的可绘图像(尺寸显式携带,便于注入 fake 测试)。 */
export interface LoadedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/** 图像加载器签名(浏览器默认 new Image;测试注入 fake)。 */
export type ImageLoader = (url: string) => Promise<LoadedImage>;

function defaultImageLoader(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () =>
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`图像加载失败: ${url}`));
    img.src = url;
  });
}

/**
 * 等待快照中出现「派生自 baseId 的新资产」(inpaint 模型结果回流;排除已知 id 与合成品自身)。
 * 超时回 null(生图失败/过慢 → 放弃回贴,模型原始结果仍在画廊,仅降级)。
 */
function waitForNewDerivedAsset(
  surface: WebExtSurfaceAccess,
  baseId: string,
  knownIds: ReadonlySet<string>,
  timeoutMs: number,
): Promise<GalleryAsset | null> {
  const check = (): GalleryAsset | undefined =>
    (surface.getState<GalleryState>(STATE_KEY)?.assets ?? []).find((a) => {
      if (knownIds.has(a.attachmentId) || a.derivedFrom !== baseId) return false;
      const op = (a.genParams as Record<string, unknown> | undefined)?.op;
      return op !== "inpaint-composite";
    });
  const hit = check();
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
    const unsub = surface.subscribe(STATE_KEY, () => {
      const h = check();
      if (h !== undefined) {
        clearTimeout(timer);
        unsub();
        resolve(h);
      }
    });
  });
}

/** inpaint 回流后的掩码回贴任务超时(生图可能要数十秒)。 */
const COMPOSE_BACK_TIMEOUT_MS = 120_000;

/**
 * 掩码回贴(后台任务):等 inpaint 模型结果回流 → 掩码外贴回原图/掩码内取新图 →
 * 上传合成图 → `register`(derivedFrom=原图,op:"inpaint-composite")。
 * gpt-image 系 edits 是整图重生成,掩码外漂移只能靠本地回贴根治;失败静默降级
 * (模型原始结果已在画廊)。导出仅供单测(UI 画笔路径由浏览器 e2e 覆盖)。
 */
export async function composeInpaintBack(args: {
  surface: WebExtSurfaceAccess;
  baseId: string;
  baseDisplayUrl: string;
  baseName: string;
  strokes: readonly MaskStroke[];
  prompt: string;
  /** 发 inpaint **之前**的资产 id 集合(此后新出现的 derivedFrom=baseId 即模型结果;发后收集会漏判秒回结果)。 */
  knownIds: ReadonlySet<string>;
  upload: UploadFn;
  uploadBaseUrl: string;
  sessionId: string;
  canvasFactory?: CanvasFactory;
  imageLoader: ImageLoader;
  timeoutMs?: number;
}): Promise<void> {
  try {
    const patchAsset = await waitForNewDerivedAsset(
      args.surface,
      args.baseId,
      args.knownIds,
      args.timeoutMs ?? COMPOSE_BACK_TIMEOUT_MS,
    );
    if (patchAsset === null) return;
    const [base, patch] = await Promise.all([
      args.imageLoader(args.baseDisplayUrl),
      args.imageLoader(patchAsset.displayUrl),
    ]);
    const opts = args.canvasFactory !== undefined ? { canvasFactory: args.canvasFactory } : {};
    const uri = compositeByMask(
      { width: base.width, height: base.height, source: base.source },
      patch.source,
      args.strokes,
      opts,
    );
    const { attachmentId } = await uploadDataUri({
      dataUri: uri,
      name: `inpaint-${args.baseName}`,
      baseUrl: args.uploadBaseUrl,
      sessionId: args.sessionId,
      upload: args.upload,
    });
    await args.surface.run(DOMAIN, "register", {
      attachmentId,
      derivedFrom: args.baseId,
      genParams: { op: "inpaint-composite", prompt: args.prompt, from: patchAsset.attachmentId },
    });
  } catch {
    // 回贴失败:静默降级(模型原始结果已在画廊)。
  }
}

export interface CanvasWorkbenchProps {
  readonly surface?: WebExtSurfaceAccess;
  /** 当前工作图(初始;可经左侧版本条切换)。 */
  readonly asset: GalleryAsset;
  /** 全部资产(供版本条 / @引用选择)。 */
  readonly assets: readonly GalleryAsset[];
  readonly onClose: () => void;
  /** 带入对话(显式 Prompt 注入 att_id);缺失则不提供该动作。 */
  readonly onBringToConversation?: (attachmentId: string) => void;
  /** 复用历史参数(C 档;预填表单)。 */
  readonly onReuseParams?: (asset: GalleryAsset) => void;
  // ── B 档上传接缝(可注入,测试用)──────────────────────────────────────────────
  readonly upload?: UploadFn;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly canvasFactory?: CanvasFactory;
  /** 模型下拉候选(缺省用内置常用清单)。 */
  readonly modelOptions?: readonly string[];
  /** 图像加载器(掩码回贴合成用;缺省浏览器 Image,测试注入 fake)。 */
  readonly imageLoader?: ImageLoader;
  /**
   * 经宿主 Prompt 通道发用户消息:提供时,「生成」组装 image_edit 指令**走对话流**
   * (LLM 调工具执行,操作回流对话历史);缺失时回退旁路 surface 命令(不过 LLM,兼容旧宿主)。
   */
  readonly onSubmitPrompt?: (text: string) => void;
}

export function CanvasWorkbench({
  surface,
  asset,
  assets,
  onClose,
  onBringToConversation,
  onReuseParams,
  upload,
  baseUrl,
  sessionId,
  canvasFactory,
  modelOptions,
  imageLoader,
  onSubmitPrompt,
}: CanvasWorkbenchProps): React.JSX.Element {
  const available = surface !== undefined && surface.hasCommand(PROBE);
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [tool, setTool] = React.useState<StageTool>("move");
  /** 笔刷占源图短边比例(实际像素在落笔时按 natural 换算)。 */
  const [brushRatio, setBrushRatio] = React.useState<number>(BRUSH_RATIOS[1]);
  const [currentId, setCurrentId] = React.useState<string>(asset.attachmentId);
  // ── M2 状态:@引用 / 参数簇 / 文本标注编辑器 ─────────────────────────────────
  const [refs, setRefs] = React.useState<readonly string[]>([]);
  const [refOpen, setRefOpen] = React.useState(false);
  const [ratioSize, setRatioSize] = React.useState<string>("");
  const [variantsN, setVariantsN] = React.useState(1);
  const [textEditor, setTextEditor] = React.useState<{
    nx: number;
    ny: number;
    left: number;
    top: number;
    value: string;
  } | null>(null);
  // ── M3 状态:图层 ────────────────────────────────────────────────────────────
  const [layers, setLayers] = React.useState<readonly WorkLayer[]>([]);
  const [selectedLayer, setSelectedLayer] = React.useState<string | null>(null);
  const layerSeq = React.useRef(0);
  /** 图层拖动/缩放会话(pointer capture 于层元素上)。 */
  const layerDrag = React.useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);

  // 当前工作图:优先内部选择,回退到 prop。prop 变化(父切换)时同步。
  const current = React.useMemo(
    () => assets.find((a) => a.attachmentId === currentId) ?? asset,
    [assets, currentId, asset],
  );
  React.useEffect(() => setCurrentId(asset.attachmentId), [asset.attachmentId]);

  // ── 舞台缩放 / 平移(移动工具)────────────────────────────────────────────────
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const drag = React.useRef<{ active: boolean; x: number; y: number } | null>(null);

  // ── 编辑历史(掩码笔迹 + 标注共栈;撤销/重做按操作顺序)─────────────────────────
  const [ops, setOps] = React.useState<readonly EditOp[]>([]);
  const [redoOps, setRedoOps] = React.useState<readonly EditOp[]>([]);
  const strokes = React.useMemo(
    () => ops.filter((o): o is Extract<EditOp, { kind: "stroke" }> => o.kind === "stroke").map((o) => o.item),
    [ops],
  );
  const annotations = React.useMemo(
    () => ops.filter((o): o is Extract<EditOp, { kind: "anno" }> => o.kind === "anno").map((o) => o.item),
    [ops],
  );
  const [draft, setDraft] = React.useState<MaskStroke | null>(null);
  /** draft 的同步镜像(pointerup 收笔用;避免在 setState updater 里做副作用,StrictMode 双调安全)。 */
  const draftRef = React.useRef<MaskStroke | null>(null);
  const [annoDraft, setAnnoDraft] = React.useState<Annotation | null>(null);
  const annoDraftRef = React.useRef<Annotation | null>(null);
  const drawing = React.useRef(false);
  /** 文本标注待开编辑器(pointerdown 记录,pointerup 才挂载 —— down 时挂载会被同次点击的
   * mouseup/click 焦点转移立刻 blur 掉,编辑器闪现即消)。 */
  const pendingText = React.useRef<{ nx: number; ny: number; left: number; top: number } | null>(null);

  // 源图自然尺寸(overlay 坐标系)与舞台尺寸(contain-fit 计算)。
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const [stageSize, setStageSize] = React.useState<{ w: number; h: number } | null>(null);

  const resetView = React.useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 切换工作图 → 复位视图 + 清空编辑历史/图层 + 重新量自然尺寸。
  React.useEffect(() => {
    resetView();
    setOps([]);
    setRedoOps([]);
    setDraft(null);
    setAnnoDraft(null);
    setTextEditor(null);
    setLayers([]);
    setSelectedLayer(null);
    setNatural(null);
  }, [current.attachmentId, resetView]);

  // 自然尺寸兜底:图片命中缓存时(挂载前已 complete)React onLoad 不触发,同步量取;
  // 否则 natural 恒 null → overlay 不渲染 → 掩码刷画不上。置于清空 effect 之后(同 deps 顺序执行)。
  React.useEffect(() => {
    const el = imgRef.current;
    if (el !== null && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      setNatural({ w: el.naturalWidth, h: el.naturalHeight });
    }
  }, [current.attachmentId]);

  // 舞台尺寸(ResizeObserver;jsdom 缺失时跳过,布局退化为 CSS contain)。
  React.useEffect(() => {
    const el = stageRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const measure = (): void => setStageSize({ w: el.offsetWidth, h: el.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // 滚轮缩放(native 非 passive,才能 preventDefault 阻止页面滚动)。
  React.useEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setScale((s) => clampZoom(s * (e.deltaY < 0 ? 1.12 : 0.89)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // overlay 预览重绘:掩码笔迹(半透明粉红=编辑区,对应 alpha mask 透明洞;erase destination-out
  // 收回)按 ops 顺序回放,标注(红)叠加最上。
  React.useEffect(() => {
    const cv = overlayRef.current;
    if (cv === null || natural === null) return;
    const ctx = cv.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const allStrokes = draft !== null ? [...strokes, draft] : strokes;
    for (const s of allStrokes) {
      if (s.points.length === 0) continue;
      ctx.save();
      ctx.globalCompositeOperation = s.mode === "erase" ? "destination-out" : "source-over";
      ctx.strokeStyle = "rgba(236,72,153,0.5)";
      ctx.lineWidth = s.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const [first, ...rest] = s.points;
      ctx.moveTo(first!.x, first!.y);
      if (rest.length === 0) ctx.lineTo(first!.x + 0.01, first!.y);
      else for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
    const allAnnos = annoDraft !== null ? [...annotations, annoDraft] : annotations;
    // 真实 CanvasRenderingContext2D 是 Ctx2DLike 的超集(fillStyle 为 union),收窄安全。
    drawAnnotations(ctx as unknown as import("./client-image-ops.js").Ctx2DLike, allAnnos);
  }, [strokes, annotations, draft, annoDraft, natural]);

  /** 当前工作图的像素尺寸(用于 B 档坐标对齐);未加载时退化占位。 */
  const sourceSize = (): { width: number; height: number; source?: CanvasImageSource } => {
    const el = imgRef.current;
    const width = el?.naturalWidth && el.naturalWidth > 0 ? el.naturalWidth : 1024;
    const height = el?.naturalHeight && el.naturalHeight > 0 ? el.naturalHeight : 1024;
    return { width, height, ...(el !== null ? { source: el } : {}) };
  };

  /** B 档:本地旋转 90° → 上传 att_ → register(乐观回流画廊)。 */
  const rotateAndRegister = React.useCallback(async (): Promise<void> => {
    if (upload === undefined) return;
    const src: ImageSourceLike = sourceSize();
    const opts = canvasFactory !== undefined ? { canvasFactory } : {};
    const dataUri = rotateImage(src, 90, opts);
    setBusy(true);
    try {
      const { attachmentId } = await uploadDataUri({
        dataUri,
        name: `rotate-${current.name}`,
        baseUrl: baseUrl ?? "",
        sessionId: sessionId ?? "",
        upload,
      });
      // 退化态(无 surface)→ 仅本地呈现,不 register(Req 9.3)。
      if (available && surface !== undefined) {
        await settleWindow(
          surface.run(DOMAIN, "register", {
            attachmentId,
            derivedFrom: current.attachmentId,
            genParams: { op: "rotate", degrees: 90 },
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [upload, canvasFactory, current, baseUrl, sessionId, available, surface]);

  const maskReady = hasMaskContent(strokes) && upload !== undefined;
  // 决策预览(生成按钮的动作/文案;inpaint 的 mask 与标注拍平图在 generate 时才上传)。
  const decisionPreview = decideGenerate({
    imageId: current.attachmentId,
    prompt,
    model,
    hasMask: maskReady,
    referenceIds: annotations.length > 0 && upload !== undefined ? ["__anno__", ...refs] : refs,
    variants: variantsN,
    size: ratioSize,
  });

  /** 主生成:按决策发对应 A 档动作;掩码/标注产物先经上传接缝落 att_。 */
  const generate = React.useCallback(async (): Promise<void> => {
    if (!available || surface === undefined) return;
    setBusy(true);
    try {
      // 标注拍平 → 批注参考图 att_(标注即指令,并入 reference_images 首位)。
      const referenceIds: string[] = [...refs];
      if (annotations.length > 0 && upload !== undefined) {
        const src = sourceSize();
        const opts = canvasFactory !== undefined ? { canvasFactory } : {};
        const annoUri = annotationsToImage(src, annotations, opts);
        const { attachmentId: annoId } = await uploadDataUri({
          dataUri: annoUri,
          name: `anno-${current.name}`,
          baseUrl: baseUrl ?? "",
          sessionId: sessionId ?? "",
          upload,
        });
        referenceIds.unshift(annoId);
      }
      const decision = decideGenerate({
        imageId: current.attachmentId,
        prompt,
        model,
        hasMask: hasMaskContent(strokes) && upload !== undefined,
        referenceIds,
        variants: variantsN,
        size: ratioSize,
      });

      // 消费快照:只清「本次发送时存在的」引用/标注/笔迹 —— 飞行期间用户可能已新加,
      // 全量清空会把新输入吞掉(竞争)。
      const sentRefs = new Set(refs);
      const sentAnnos = new Set(annotations);
      const sentStrokes = new Set(strokes);
      const consumeSent = (withStrokes: boolean): void => {
        setRefs((prev) => prev.filter((r) => !sentRefs.has(r)));
        setOps((prev) =>
          prev.filter((o) => {
            if (o.kind === "anno") return !sentAnnos.has(o.item);
            return withStrokes ? !sentStrokes.has(o.item) : true;
          }),
        );
        setRedoOps([]);
      };

      if (decision.action === "inpaint" && upload !== undefined) {
        const src = sourceSize();
        const opts = canvasFactory !== undefined ? { canvasFactory } : {};
        const maskUri = strokesToMask({ width: src.width, height: src.height }, strokes, opts);
        // 回贴任务的输入快照:笔迹 + 基图 + 发命令**前**的资产 id 集(见 composeInpaintBack)。
        const strokesSnapshot = strokes;
        const baseSnapshot = current;
        const knownIds = new Set(
          (surface.getState<GalleryState>(STATE_KEY)?.assets ?? []).map((a) => a.attachmentId),
        );
        const { attachmentId: maskId } = await uploadDataUri({
          dataUri: maskUri,
          name: `mask-${current.name}`,
          baseUrl: baseUrl ?? "",
          sessionId: sessionId ?? "",
          upload,
        });
        if (onSubmitPrompt !== undefined) {
          // 走对话流(A 方案):LLM 调 image_edit,操作回流对话历史。
          // ⚠回贴暂不随此路径启动:工具产物经轮末 sync 收编,快照资产无 derivedFrom=基图
          // 锚点,waitForNewDerivedAsset 匹配不到(误配风险大于收益);恢复待工具结果 meta 带血缘。
          onSubmitPrompt(buildToolPrompt(decision, { maskId }));
          consumeSent(true);
          return;
        }
        await settleWindow(
          surface.run(DOMAIN, "inpaint", { ...decision.args, mask: maskId }),
        );
        // 掩码已消费:清空;像素级局部化交给后台回贴(不阻塞 busy)。
        consumeSent(true);
        void composeInpaintBack({
          surface,
          baseId: baseSnapshot.attachmentId,
          baseDisplayUrl: baseSnapshot.displayUrl,
          baseName: baseSnapshot.name,
          strokes: strokesSnapshot,
          prompt,
          knownIds,
          upload,
          uploadBaseUrl: baseUrl ?? "",
          sessionId: sessionId ?? "",
          ...(canvasFactory !== undefined ? { canvasFactory } : {}),
          imageLoader: imageLoader ?? defaultImageLoader,
        });
        return;
      }

      if (onSubmitPrompt !== undefined) {
        // 走对话流(A 方案默认):组装 image_edit 指令为用户消息,LLM 调工具执行。
        onSubmitPrompt(buildToolPrompt(decision));
        if (decision.action === "reference") consumeSent(false);
        return;
      }
      // 回退:旁路 surface 命令(不过 LLM;兼容未接 Prompt 通道的宿主/测试)。
      await settleWindow(surface.run(DOMAIN, decision.action, decision.args));
      if (decision.action === "reference") consumeSent(false);
    } finally {
      setBusy(false);
    }
  }, [available, surface, refs, annotations, strokes, upload, canvasFactory, current, baseUrl, sessionId, prompt, model, variantsN, ratioSize, imageLoader, onSubmitPrompt]);

  /** 版本条选中 → 切工作图 + 复用其参数(预填表单 + 通知宿主)。 */
  const selectAsset = React.useCallback(
    (a: GalleryAsset): void => {
      setCurrentId(a.attachmentId);
      const gp = a.genParams as Record<string, unknown> | undefined;
      if (gp !== undefined) {
        if (typeof gp.prompt === "string") setPrompt(gp.prompt);
        if (typeof gp.model === "string") setModel(gp.model);
        onReuseParams?.(a);
      }
    },
    [onReuseParams],
  );

  // ── 指针 → 源图像素坐标(经 overlay 的 BoundingClientRect,天然含 transform)────
  const toNatural = (e: React.PointerEvent): { x: number; y: number } | null => {
    const cv = overlayRef.current;
    if (cv === null || natural === null) return null;
    const rect = cv.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * natural.w,
      y: ((e.clientY - rect.top) / rect.height) * natural.h,
    };
  };

  const drawingTool = tool === "mask" || tool === "erase";
  const annoLineTool = tool === "line" || tool === "arrow";
  const overlayInteractive = drawingTool || annoLineTool || tool === "text";

  // ── M3:图层(加/拖放/变换/拍平;全 B 档本地)──────────────────────────────────
  const loader = imageLoader ?? defaultImageLoader;

  /** 加一层:初始宽 = 底图宽 40%,高按图像纵横比(加载后修正);落点居中(缺省底图中心)。 */
  const addLayer = React.useCallback(
    (att: { attachmentId: string; displayUrl: string }, at?: { x: number; y: number }): void => {
      // natural 未量到(jsdom / 未加载)退化 1024 占位,与 sourceSize 同策略。
      const nat = natural ?? { w: 1024, h: 1024 };
      layerSeq.current += 1;
      const id = `layer-${layerSeq.current}`;
      const w0 = nat.w * 0.4;
      const h0 = w0; // 占位方形,加载后按真实纵横比修正
      const cx0 = at?.x ?? nat.w / 2;
      const cy0 = at?.y ?? nat.h / 2;
      const layer: WorkLayer = {
        id,
        attachmentId: att.attachmentId,
        displayUrl: att.displayUrl,
        x: cx0 - w0 / 2,
        y: cy0 - h0 / 2,
        w: w0,
        h: h0,
      };
      setLayers((prev) => [...prev, layer]);
      setSelectedLayer(id);
      void loader(att.displayUrl)
        .then((img) => {
          const ratio = img.width > 0 ? img.height / img.width : 1;
          setLayers((prev) =>
            prev.map((l) =>
              l.id === id
                ? { ...l, loaded: img, h: l.w * ratio, y: cy0 - (l.w * ratio) / 2 }
                : l,
            ),
          );
        })
        .catch(() => {
          // 加载失败:层保留占位(拍平时跳过)。
        });
    },
    [natural, loader],
  );

  /** stage drop:画廊资产(text/att-id)或 OS 文件(经上传接缝落 att_ 并 register)。 */
  const onStageDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const cv = overlayRef.current;
    if (cv === null || natural === null) return;
    const rect = cv.getBoundingClientRect();
    const at =
      rect.width > 0
        ? {
            x: ((e.clientX - rect.left) / rect.width) * natural.w,
            y: ((e.clientY - rect.top) / rect.height) * natural.h,
          }
        : undefined;
    const attId = e.dataTransfer.getData("text/att-id");
    if (attId !== "") {
      const a = assets.find((x) => x.attachmentId === attId);
      if (a !== undefined) addLayer(a, at);
      return;
    }
    // OS 文件:上传落 att_ → register 进画廊(origin=upload)→ 成层。
    const file = e.dataTransfer.files?.[0];
    if (file !== undefined && upload !== undefined) {
      void upload(baseUrl ?? "", sessionId ?? "", file).then(async (res) => {
        if (available && surface !== undefined) {
          await settleWindow(
            surface.run(DOMAIN, "register", { attachmentId: res.attachment.id }),
          );
        }
        addLayer({ attachmentId: res.attachment.id, displayUrl: res.displayUrl }, at);
      });
    }
  };

  /** 层指针交互:move 模式拖动 / resize 模式右下角手柄等比缩放。 */
  const onLayerPointerDown = (e: React.PointerEvent, id: string, mode: "move" | "resize"): void => {
    e.stopPropagation();
    const l = layers.find((x) => x.id === id);
    if (l === undefined) return;
    setSelectedLayer(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    layerDrag.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: l.x, y: l.y, w: l.w, h: l.h },
    };
  };
  const onLayerPointerMove = (e: React.PointerEvent): void => {
    const d = layerDrag.current;
    const cv = overlayRef.current;
    if (d === null || cv === null || natural === null) return;
    const rect = cv.getBoundingClientRect();
    if (rect.width <= 0) return;
    const dx = ((e.clientX - d.startX) / rect.width) * natural.w;
    const dy = ((e.clientY - d.startY) / rect.height) * natural.h;
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== d.id) return l;
        if (d.mode === "move") return { ...l, x: d.orig.x + dx, y: d.orig.y + dy };
        // 等比缩放(右下角手柄;以横向位移为准,钳最小 24px)。
        const ratio = d.orig.w > 0 ? d.orig.h / d.orig.w : 1;
        const w = Math.max(24, d.orig.w + dx);
        return { ...l, w, h: w * ratio };
      }),
    );
  };
  const onLayerPointerUp = (): void => {
    layerDrag.current = null;
  };

  /** 拍平:底图 + 依序各层 → 上传 att_ → register(derivedFrom=底图)→ 清层。 */
  const flatten = React.useCallback(async (): Promise<void> => {
    if (upload === undefined || layers.length === 0) return;
    setBusy(true);
    try {
      // 确保所有层已加载(占位未完成的现场补载;失败层跳过)。
      const resolved = await Promise.all(
        layers.map(async (l) => {
          if (l.loaded !== undefined) return l;
          try {
            const img = await loader(l.displayUrl);
            return { ...l, loaded: img } as WorkLayer;
          } catch {
            return l;
          }
        }),
      );
      const src = sourceSize();
      const opts = canvasFactory !== undefined ? { canvasFactory } : {};
      const uri = flattenLayers(
        src,
        resolved
          .filter((l) => l.loaded !== undefined)
          .map((l) => ({ source: l.loaded!.source, x: l.x, y: l.y, w: l.w, h: l.h })),
        opts,
      );
      const { attachmentId } = await uploadDataUri({
        dataUri: uri,
        name: `flatten-${current.name}`,
        baseUrl: baseUrl ?? "",
        sessionId: sessionId ?? "",
        upload,
      });
      if (available && surface !== undefined) {
        await settleWindow(
          surface.run(DOMAIN, "register", {
            attachmentId,
            derivedFrom: current.attachmentId,
            genParams: { op: "flatten", layers: layers.map((l) => l.attachmentId) },
          }),
        );
      }
      setLayers([]);
      setSelectedLayer(null);
    } finally {
      setBusy(false);
    }
  }, [upload, layers, loader, canvasFactory, current, baseUrl, sessionId, available, surface]);

  const shortEdge = natural !== null ? Math.min(natural.w, natural.h) : 1024;
  const annoSize = Math.max(3, Math.round(shortEdge * ANNOTATION_RATIO));

  const onOverlayPointerDown = (e: React.PointerEvent): void => {
    const p = toNatural(e);
    if (p === null) return;
    if (drawingTool) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drawing.current = true;
      // 笔刷直径 = 短边 × 比例(钳到 ≥1px)。
      const size = Math.max(1, Math.round(shortEdge * brushRatio));
      const d: MaskStroke = { mode: tool === "mask" ? "paint" : "erase", size, points: [p] };
      draftRef.current = d;
      setDraft(d);
      return;
    }
    if (annoLineTool) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drawing.current = true;
      const d: Annotation = { kind: tool, from: p, to: p, size: annoSize };
      annoDraftRef.current = d;
      setAnnoDraft(d);
      return;
    }
    if (tool === "text") {
      // 记录位置,pointerup 才开编辑器(见 pendingText 注释)。
      const stageEl = stageRef.current;
      if (stageEl === null) return;
      const srect = stageEl.getBoundingClientRect();
      pendingText.current = {
        nx: p.x,
        ny: p.y,
        left: e.clientX - srect.left,
        top: e.clientY - srect.top,
      };
    }
  };
  const onOverlayPointerMove = (e: React.PointerEvent): void => {
    if (!drawing.current) return;
    const p = toNatural(e);
    if (p === null) return;
    if (draftRef.current !== null) {
      const d: MaskStroke = { ...draftRef.current, points: [...draftRef.current.points, p] };
      draftRef.current = d;
      setDraft(d);
      return;
    }
    if (annoDraftRef.current !== null) {
      const d: Annotation = { ...annoDraftRef.current, to: p };
      annoDraftRef.current = d;
      setAnnoDraft(d);
    }
  };
  const onOverlayPointerUp = (): void => {
    // 文本标注:up 时才挂编辑器(down 挂载会被同次点击的焦点转移 blur 掉)。
    if (pendingText.current !== null) {
      const t = pendingText.current;
      pendingText.current = null;
      setTextEditor({ ...t, value: "" });
      return;
    }
    if (!drawing.current) return;
    drawing.current = false;
    const d = draftRef.current;
    draftRef.current = null;
    if (d !== null) {
      setOps([...ops, { kind: "stroke", item: d }]);
      setRedoOps([]);
      setDraft(null);
      return;
    }
    const a = annoDraftRef.current;
    annoDraftRef.current = null;
    if (a !== null) {
      // 零长度拖拽(点按)→ 丢弃。
      const len = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y);
      if (len >= 2) {
        setOps([...ops, { kind: "anno", item: a }]);
        setRedoOps([]);
      }
      setAnnoDraft(null);
    }
  };

  const commitText = (): void => {
    if (textEditor === null) return;
    const value = textEditor.value.trim();
    if (value !== "") {
      const anno: Annotation = {
        kind: "text",
        from: { x: textEditor.nx, y: textEditor.ny },
        to: { x: textEditor.nx, y: textEditor.ny },
        text: value,
        size: annoSize * 2,
      };
      setOps([...ops, { kind: "anno", item: anno }]);
      setRedoOps([]);
    }
    setTextEditor(null);
  };

  const undo = (): void => {
    if (ops.length === 0) return;
    const last = ops[ops.length - 1]!;
    setOps(ops.slice(0, -1));
    setRedoOps([...redoOps, last]);
  };
  const redo = (): void => {
    if (redoOps.length === 0) return;
    const last = redoOps[redoOps.length - 1]!;
    setRedoOps(redoOps.slice(0, -1));
    setOps([...ops, last]);
  };

  // ── 舞台平移(移动工具)──────────────────────────────────────────────────────
  const onStageMouseDown = (e: React.MouseEvent): void => {
    if (tool !== "move") return;
    drag.current = { active: true, x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const onStageMouseMove = (e: React.MouseEvent): void => {
    const d = drag.current;
    if (d === null || !d.active) return;
    setOffset({ x: e.clientX - d.x, y: e.clientY - d.y });
  };
  const endDrag = (): void => {
    drag.current = null;
  };

  const summary = summarizeGenParams(current).join(" · ");
  const genDisabled = !available || busy;

  // ── 区块:Header ────────────────────────────────────────────────────────────
  const header = (
    <Card className="flex items-center gap-2 p-2">
      <Button variant="ghost" size="icon" data-canvas-workbench-close onClick={onClose} aria-label="返回画廊">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{current.name}</div>
        {summary !== "" ? (
          <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">{summary}</div>
        ) : null}
      </div>
      {onBringToConversation !== undefined ? (
        <Button
          variant="ghost"
          size="sm"
          data-canvas-bring-to-conversation
          onClick={() => onBringToConversation(current.attachmentId)}
        >
          <MessageSquarePlus className="mr-1 h-4 w-4" />
          带入对话
        </Button>
      ) : null}
    </Card>
  );

  // ── 区块:垂直版本条(左沿浮动层;点缩略切换工作图)────────────────────────────
  const versionRail = (
    <div
      data-canvas-version-rail
      className={cn(
        "pi-scrollbar-thin absolute left-2 top-2 z-10 flex max-h-[calc(100%-4.5rem)] w-[68px] flex-col gap-2 overflow-y-auto p-1",
        FLOAT_LAYER,
      )}
    >
      <div className="px-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">版本</div>
      {assets.map((a) => (
        <div
          key={a.attachmentId}
          className="group relative"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/att-id", a.attachmentId);
            e.dataTransfer.effectAllowed = "copy";
          }}
        >
          <button
            type="button"
            data-canvas-version-item
            data-att-id={a.attachmentId}
            aria-pressed={a.attachmentId === current.attachmentId}
            onClick={() => selectAsset(a)}
            className={cn(
              "relative block aspect-square w-full shrink-0 overflow-hidden rounded-md border transition-all",
              a.attachmentId === current.attachmentId
                ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] opacity-70 hover:opacity-100",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.displayUrl} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
            {a.derivedFrom !== undefined ? (
              <span className="absolute left-0.5 top-0.5 rounded bg-black/50 px-1 text-[8px] text-white">派生</span>
            ) : null}
          </button>
          {/* ⊕ 加为图层(hover 显;拖拽到舞台等效)。当前工作图不自叠。 */}
          {a.attachmentId !== current.attachmentId ? (
            <button
              type="button"
              data-canvas-layer-add
              data-att-id={a.attachmentId}
              aria-label="加为图层"
              title="加为图层(或直接拖到画布)"
              onClick={() => addLayer(a)}
              className="absolute bottom-0.5 right-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] leading-none text-white group-hover:flex"
            >
              +
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );

  // ── 区块:右侧工具轨 ─────────────────────────────────────────────────────────
  const toolBtn = (
    key: StageTool,
    icon: React.ReactNode,
    label: string,
    disabled: boolean,
    title?: string,
  ): React.JSX.Element => (
    <Button
      key={key}
      variant={tool === key ? "default" : "ghost"}
      size="icon"
      className="h-8 w-8"
      aria-pressed={tool === key}
      aria-label={label}
      title={title ?? label}
      data-canvas-tool={key}
      disabled={disabled}
      onClick={() => setTool(key)}
    >
      {icon}
    </Button>
  );

  // 掩码工具需要 A 档 inpaint(available)+ 上传接缝;标注同理(拍平图需上传)。缺一禁用。
  const maskToolsDisabled = !available || upload === undefined || busy;
  const toolRail = (
    <div
      data-canvas-tool-rail
      className={cn(
        "absolute right-2 top-1/2 z-10 flex w-10 -translate-y-1/2 flex-col items-center gap-1 p-1",
        FLOAT_LAYER,
      )}
    >
      {toolBtn("move", <Hand className="h-4 w-4" />, "移动", false)}
      {toolBtn("line", <Slash className="h-4 w-4" />, "画线", maskToolsDisabled, "画线(标注即指令)")}
      {toolBtn("arrow", <ArrowUpRight className="h-4 w-4" />, "箭头", maskToolsDisabled, "箭头(标注即指令)")}
      {toolBtn("text", <Type className="h-4 w-4" />, "文本", maskToolsDisabled, "文本(标注即指令)")}
      {toolBtn("mask", <Brush className="h-4 w-4" />, "掩码刷", maskToolsDisabled)}
      {toolBtn("erase", <Eraser className="h-4 w-4" />, "擦除", maskToolsDisabled)}

      {drawingTool ? (
        <div className="flex flex-col items-center gap-1 py-1" data-canvas-brush-sizes>
          {BRUSH_RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={brushRatio === r}
              aria-label={`笔刷 ${Math.round(r * 100)}%`}
              title={`笔刷(短边 ${Math.round(r * 100)}%)`}
              onClick={() => setBrushRatio(r)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                brushRatio === r ? "bg-[hsl(var(--accent))]" : "hover:bg-[hsl(var(--muted))]",
              )}
            >
              <span
                className="rounded-full bg-[hsl(var(--foreground))]"
                style={{ width: 4 + (r / 0.1) * 10, height: 4 + (r / 0.1) * 10 }}
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="my-0.5 h-px w-6 bg-[hsl(var(--border))]" />
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="撤销" data-canvas-undo disabled={ops.length === 0} onClick={undo}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="重做" data-canvas-redo disabled={redoOps.length === 0} onClick={redo}>
        <Redo2 className="h-4 w-4" />
      </Button>
      <div className="my-0.5 h-px w-6 bg-[hsl(var(--border))]" />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="旋转 90°"
        title="旋转 90°(本地)"
        data-canvas-b-rotate
        disabled={busy || upload === undefined}
        onClick={() => void rotateAndRegister()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
      </Button>
    </div>
  );

  // ── 区块:Stage(contain-fit wrapper + overlay 画布 + 缩放胶囊)────────────────
  const fit =
    natural !== null && stageSize !== null
      ? Math.min(stageSize.w / natural.w, stageSize.h / natural.h)
      : null;
  const wrapperStyle: React.CSSProperties =
    natural !== null && fit !== null
      ? {
          width: natural.w * fit,
          height: natural.h * fit,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }
      : { width: "100%", height: "100%", transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` };

  const zoomPct = Math.round(scale * 100);
  const stage = (
    <Card
      ref={stageRef}
      data-canvas-stage
      data-canvas-active-tool={tool}
      className="canvas-checkerboard relative flex h-full w-full items-center justify-center overflow-hidden p-0"
      onMouseDown={onStageMouseDown}
      onMouseMove={onStageMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onDoubleClick={tool === "move" ? resetView : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onStageDrop}
      style={{ cursor: tool === "move" ? (drag.current?.active ? "grabbing" : "grab") : undefined }}
    >
      <div className="relative shrink-0 will-change-transform" style={wrapperStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          data-canvas-workbench-image
          src={current.displayUrl}
          alt={current.name}
          draggable={false}
          onLoad={() => {
            const el = imgRef.current;
            if (el !== null && el.naturalWidth > 0 && el.naturalHeight > 0) {
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }
          }}
          className="h-full w-full select-none object-contain"
          crossOrigin="anonymous"
        />
        {/* 图层(底图之上、掩码/标注 overlay 之下;百分比定位随 wrapper 缩放)。 */}
        {natural !== null
          ? layers.map((l) => (
              <div
                key={l.id}
                data-canvas-layer
                data-layer-id={l.id}
                data-att-id={l.attachmentId}
                className={cn(
                  "absolute",
                  selectedLayer === l.id
                    ? "z-[2] ring-2 ring-[hsl(var(--primary))]"
                    : "z-[1]",
                )}
                style={{
                  left: `${(l.x / natural.w) * 100}%`,
                  top: `${(l.y / natural.h) * 100}%`,
                  width: `${(l.w / natural.w) * 100}%`,
                  height: `${(l.h / natural.h) * 100}%`,
                  cursor: "move",
                }}
                onPointerDown={(e) => onLayerPointerDown(e, l.id, "move")}
                onPointerMove={onLayerPointerMove}
                onPointerUp={onLayerPointerUp}
                onPointerCancel={onLayerPointerUp}
                // 阻断 mousedown 冒泡:stage 平移监听 mousedown(与 pointerdown 是不同事件,
                // 层内 pointerdown 的 stopPropagation 挡不住它)→ 否则拖层时画布同步平移(2 倍位移)。
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={l.displayUrl}
                  alt=""
                  draggable={false}
                  className="h-full w-full select-none object-fill"
                  crossOrigin="anonymous"
                />
                {selectedLayer === l.id ? (
                  <span
                    data-canvas-layer-resize
                    aria-label="缩放图层"
                    onPointerDown={(e) => onLayerPointerDown(e, l.id, "resize")}
                    onPointerMove={onLayerPointerMove}
                    onPointerUp={onLayerPointerUp}
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-[hsl(var(--background))] bg-[hsl(var(--primary))]"
                  />
                ) : null}
              </div>
            ))
          : null}
        {natural !== null ? (
          <canvas
            ref={overlayRef}
            data-canvas-mask-overlay
            width={natural.w}
            height={natural.h}
            className={cn(
              "absolute inset-0 z-[3] h-full w-full",
              overlayInteractive
                ? tool === "text"
                  ? "cursor-text"
                  : "cursor-crosshair"
                : "pointer-events-none",
            )}
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerCancel={onOverlayPointerUp}
          />
        ) : null}
      </div>
      {/* 图层浮条(有层时顶部中央):拍平/删除选中/清空。 */}
      {layers.length > 0 ? (
        <div
          data-canvas-layer-bar
          className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2 py-0.5 text-xs shadow-sm backdrop-blur"
        >
          <span className="text-[hsl(var(--muted-foreground))]">图层 {layers.length}</span>
          {selectedLayer !== null ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              data-canvas-layer-remove
              onClick={() => {
                setLayers((prev) => prev.filter((l) => l.id !== selectedLayer));
                setSelectedLayer(null);
              }}
            >
              删除选中
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            data-canvas-layer-clear
            onClick={() => {
              setLayers([]);
              setSelectedLayer(null);
            }}
          >
            清空
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-6 px-2 text-xs"
            data-canvas-layer-flatten
            disabled={busy || upload === undefined}
            onClick={() => void flatten()}
          >
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            拍平
          </Button>
        </div>
      ) : null}
      {/* 文本标注编辑器(浮动;回车确认,Esc 取消)。 */}
      {textEditor !== null ? (
        <div
          className="absolute z-20"
          style={{ left: textEditor.left, top: textEditor.top }}
        >
          <Input
            autoFocus
            data-canvas-text-editor
            value={textEditor.value}
            placeholder="标注文本,回车确认"
            onChange={(e) => setTextEditor({ ...textEditor, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") setTextEditor(null);
            }}
            onBlur={commitText}
            className="h-7 w-44 text-xs"
          />
        </div>
      ) : null}
      {/* 缩放胶囊:左下角(中央底部让位给浮动提示词栏,右下角避开宿主比例切换器)。 */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/85 px-1 py-0.5 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="缩小" onClick={() => setScale((s) => clampZoom(s * 0.83))}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{zoomPct}%</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="放大" onClick={() => setScale((s) => clampZoom(s * 1.2))}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="适应" onClick={resetView}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );

  // ── 区块:底部提示词栏(舞台上的居中浮动层;@引用 + 参数簇)────────────────────
  // z-50:宿主右下角面板比例切换器(z-40 绝对定位浮层)与栏尾「生成」按钮在常见视口
  // 重叠并拦截点击;内容交互优先,提升本栏层级(反向仅遮浮层一角)。
  const knownModels = modelOptions ?? DEFAULT_MODEL_OPTIONS;
  // 复用历史参数可能带来清单外的 model:并入候选兜底(否则 Select 显示为空)。
  const modelItems =
    model !== "" && !knownModels.includes(model) ? [model, ...knownModels] : knownModels;
  const refCandidates = assets.filter((a) => a.attachmentId !== current.attachmentId);
  const editSummaryBits: string[] = [];
  if (strokes.length > 0) editSummaryBits.push(`掩码 ${strokes.length}`);
  if (annotations.length > 0) editSummaryBits.push(`标注 ${annotations.length}`);

  const promptBar = (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-50 flex justify-center px-14">
      <Card
        data-canvas-prompt-bar
        className={cn("pointer-events-auto flex w-full max-w-xl flex-col gap-2 p-2", FLOAT_LAYER)}
      >
        {!available ? (
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            surface 不可用,仅本地工具可用
          </div>
        ) : null}
        <Popover open={refOpen} onOpenChange={setRefOpen}>
          <PopoverAnchor asChild>
            <Textarea
              data-canvas-prompt
              value={prompt}
              onChange={(e) => {
                const v = e.target.value;
                setPrompt(v);
                // 输入 @ 触发引用选择(选中后去掉末尾 @)。
                if (v.endsWith("@") && refCandidates.length > 0) setRefOpen(true);
              }}
              placeholder="描述修改…(@ 引用画廊图;掩码刷圈选后为局部重绘)"
              rows={2}
              className="pi-scrollbar-thin resize-none"
            />
          </PopoverAnchor>
          <PopoverContent align="start" side="top" className="w-72 p-2">
            <div className="mb-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
              引用画廊图(并入 reference_images)
            </div>
            <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto">
              {refCandidates.map((a) => (
                <button
                  key={a.attachmentId}
                  type="button"
                  data-canvas-ref-option
                  data-att-id={a.attachmentId}
                  aria-pressed={refs.includes(a.attachmentId)}
                  onClick={() => {
                    setRefs(
                      refs.includes(a.attachmentId)
                        ? refs.filter((r) => r !== a.attachmentId)
                        : [...refs, a.attachmentId],
                    );
                    if (prompt.endsWith("@")) setPrompt(prompt.slice(0, -1));
                  }}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded border transition-all",
                    refs.includes(a.attachmentId)
                      ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] opacity-80 hover:opacity-100",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.displayUrl} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {refs.length > 0 || editSummaryBits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {refs.map((id) => {
              const a = assets.find((x) => x.attachmentId === id);
              return (
                <span
                  key={id}
                  data-canvas-ref-chip
                  data-att-id={id}
                  className="flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] py-0.5 pl-0.5 pr-1.5 text-[10px]"
                >
                  {a !== undefined ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.displayUrl} alt="" className="h-4 w-4 rounded-full object-cover" />
                  ) : null}
                  @…{id.slice(-6)}
                  <button
                    type="button"
                    aria-label="移除引用"
                    onClick={() => setRefs(refs.filter((r) => r !== id))}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {editSummaryBits.length > 0 ? (
              <button
                type="button"
                data-canvas-mask-clear
                onClick={() => {
                  setOps([]);
                  setRedoOps([]);
                }}
                className="text-[10px] text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline"
              >
                {editSummaryBits.join(" · ")} · 清除
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-1.5">
          <Select
            value={model === "" ? MODEL_DEFAULT_SENTINEL : model}
            onValueChange={(v) => setModel(v === MODEL_DEFAULT_SENTINEL ? "" : v)}
          >
            <SelectTrigger data-canvas-model className="h-8 w-36 text-xs">
              <SelectValue placeholder="默认模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MODEL_DEFAULT_SENTINEL}>默认模型</SelectItem>
              {modelItems.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 比例 chips。 */}
          <div className="flex items-center gap-0.5" role="group" aria-label="输出比例">
            {RATIO_OPTIONS.map((r) => (
              <button
                key={r.label}
                type="button"
                data-canvas-ratio={r.label}
                aria-pressed={ratioSize === r.size}
                onClick={() => setRatioSize(r.size)}
                className={cn(
                  "rounded px-1.5 py-1 text-[10px] transition-colors",
                  ratioSize === r.size
                    ? "bg-[hsl(var(--accent))] font-medium"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* 变体数 stepper。 */}
          <div className="flex items-center gap-0.5 text-[10px]" aria-label="变体数">
            <button
              type="button"
              data-canvas-variants-dec
              aria-label="减少变体"
              disabled={variantsN <= 1}
              onClick={() => setVariantsN((n) => Math.max(1, n - 1))}
              className="rounded px-1 py-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
            >
              −
            </button>
            <span data-canvas-variants-n className="min-w-[1.75rem] text-center tabular-nums">
              ×{variantsN}
            </span>
            <button
              type="button"
              data-canvas-variants-inc
              aria-label="增加变体"
              disabled={variantsN >= 4}
              onClick={() => setVariantsN((n) => Math.min(4, n + 1))}
              className="rounded px-1 py-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
            >
              ＋
            </button>
          </div>

          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="引用画廊图"
            data-canvas-ref-trigger
            disabled={refCandidates.length === 0}
            onClick={() => setRefOpen(true)}
          >
            <AtSign className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="sm"
            data-canvas-generate
            data-canvas-action={decisionPreview.action}
            disabled={genDisabled}
            onClick={() => void generate()}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {ACTION_LABEL[decisionPreview.action]}
          </Button>
        </div>
      </Card>
    </div>
  );

  // 画板最大化:舞台独占 header 下全幅;版本条/工具轨/提示词栏均为舞台上的浮动层。
  return (
    <div data-canvas-workbench data-att-id={current.attachmentId} className="flex h-full min-h-0 flex-col gap-2 p-2">
      {header}
      <div className="relative min-h-0 flex-1">
        {stage}
        {versionRail}
        {toolRail}
        {promptBar}
      </div>
    </div>
  );
}
