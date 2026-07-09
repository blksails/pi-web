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
import {
  renderSurfaceOp,
  type SurfaceOp,
  type WebExtSurfaceAccess,
  type ConversationAccess,
} from "@blksails/pi-web-kit";
import { useConversationBridge } from "@blksails/pi-web-react";
// 解读载荷构造器(spec canvas-vision-readout):与 buildSurfaceOp 平行、互不 import。
import { buildVisionOp, type VisionModelOption } from "./vision-op.js";
import type { GalleryAsset, GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  ArrowLeft,
  AtSign,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minus,
  Eye,
  Plus,
  Redo2,
  RotateCw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@blksails/pi-web-primitives";
import { Card } from "@blksails/pi-web-primitives";
import { Input } from "@blksails/pi-web-primitives";
import { Popover, PopoverContent, PopoverAnchor } from "@blksails/pi-web-primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@blksails/pi-web-primitives";
import { Textarea } from "@blksails/pi-web-primitives";
import { cn } from "@blksails/pi-web-primitives";
import {
  ANNOTATION_COLOR,
  BRUSH_RATIOS,
  PREF_ANNO_COLOR,
  PREF_BRUSH_RATIO,
  PREF_EXPAND_EDGES,
  annotationsToImage,
  compositeByMask,
  createCanvasKernel,
  expandedSize,
  flattenLayers,
  hasExpand,
  hasMaskContent,
  outpaintImage,
  outpaintMask,
  registerBuiltinTools,
  registerPluginBundles,
  resolveAction,
  rotateImage,
  strokesToMask,
  uploadDataUri,
  type Annotation,
  type CanvasCapability,
  type CanvasFactory,
  type CanvasLike,
  type Ctx2DLike,
  type ExpandEdges,
  type ImageSourceLike,
  type LoadedImage,
  type MaskStroke,
  type RouterPointerEvent,
  type ToolDiagnostic,
  type UploadFn,
  type WorkLayer,
} from "@blksails/pi-web-canvas-kit";
import {
  BUILTIN_GENERATE_ACTIONS,
  registerBuiltinGenerateActions,
  toGenerateDecision,
} from "./generate-actions.js";
import type { NamespacedPluginBundles } from "./plugin-aggregation.js";

const DOMAIN = "canvas";
const PROBE = `surface:${DOMAIN}`;
const STATE_KEY = `surface:${DOMAIN}`;

/**
 * busy 解锁窗:`surface.run` 结果在 prod 毫秒级配对回包;但 **next dev(StrictMode)** 双跑空闲
 * 控制流 effect 的竞争会令 ui-rpc 回包帧丢失,run 只能等满 ui-rpc bus 15s 超时结算。命令效果
 * 本就经权威快照回流呈现(与 run resolve 无关),故 busy 以短窗 race 解锁,不吊死交互。
 */
const RUN_SETTLE_MS = 4000;
function settleWindow<T>(p: Promise<T>, ms = RUN_SETTLE_MS): Promise<unknown> {
  return Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
}

// ── 舞台工具装配(4.2 注册表驱动:工具本体在 canvas-kit builtin/,此处只留装配策略)──

/** 移动工具 id(领域策略锚:双击复位视图/舞台 grab 光标归属)。 */
const MOVE_TOOL_ID = "builtin:move";

/** 扩图工具 id(领域策略锚:手柄 DOM 留 workbench(design 裁定)+ 扩图态 fitPad)。 */
const EXPAND_TOOL_ID = "builtin:expand";

/** 工具轨长 title(3.1 留账①:不在 CanvasTool 声明面,装配侧另行保持;缺省用 label)。 */
const TOOL_RAIL_TITLES: Readonly<Record<string, string>> = {
  [EXPAND_TOOL_ID]: "扩图(拖动边框向外扩,生成填充新区域)",
  "builtin:draw": "画笔(标注即指令)",
  "builtin:line": "画线(标注即指令)",
  "builtin:arrow": "箭头(标注即指令)",
  "builtin:text": "文本(标注即指令)",
};

/** 不受「A 档 + 上传接缝」禁用门约束的工具(纯本地视口手势;其余同旧 maskToolsDisabled)。 */
const BACKEND_FREE_TOOLS: ReadonlySet<string> = new Set([MOVE_TOOL_ID]);

/** 工具 data-* 锚点值:剥 `builtin:` 前缀(既有锚点 `data-canvas-tool="move"` 等零变)。 */
const toolAnchor = (id: string): string => id.replace(/^builtin:/, "");

/**
 * 工具轨按钮 title 组装(Req 6.3/6.4;裁定 B 插件缺依赖)。两条禁用来源:
 * ① **插件缺依赖**(task 3.1;`pluginReason` 非空 = 该工具在 registry.disabledPluginTools):
 *    直接以缺依赖原因串(含具体缺失项)拼 title —— 拓扑校验诊断按**捆 id** 归属,resolveToolRailTitle
 *    按工具 id 匹配 diagnostics 取不到,故经 registry.disabledPluginToolReason 显式取回原因;
 * ② **runtime 回调抛错禁用**(在 `disabledTools` 中且 `diagnostics` 存在该工具**语义**条目——
 *    `kind` 缺省或 `"tool"`;`"action"` 条目属动作面不入工具轨):拼首条诊断原因。
 * 否则逐字节维持原 title——门控禁用(上传接缝/A 档未就绪)与无诊断均零变。纯函数,可独立单测。
 */
export function resolveToolRailTitle(
  baseTitle: string,
  toolId: string,
  disabledTools: readonly string[],
  diagnostics: readonly ToolDiagnostic[],
  pluginReason?: string,
): string {
  // ① 插件缺依赖恒禁用:原因来自禁用集读面(裁定 B;先于 runtime 诊断 —— 缺依赖工具从不激活,
  //    不会另有回调抛错诊断,二者不并存)。
  if (pluginReason !== undefined) return `${baseTitle}(已禁用:${pluginReason})`;
  if (!disabledTools.includes(toolId)) return baseTitle;
  const entry = diagnostics.find((d) => d.toolId === toolId && d.kind !== "action");
  return entry === undefined ? baseTitle : `${baseTitle}(已禁用:${entry.error})`;
}

/** 四边零扩展(扩图复位/初值;prefs 键 PREF_EXPAND_EDGES 的缺省值)。 */
const NO_EXPAND: ExpandEdges = { top: 0, right: 0, bottom: 0, left: 0 };

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

/**
 * 视觉模型偏好的本地存储键(spec canvas-vision-readout,Req 3.2)。
 *
 * 与 `AigcQuickSettings` 的 `pi-web.aigc.*` 同前缀风格。刻意用 localStorage 而非 state 桥 KV:
 * 提示词栏的**生成**模型选择器就是纯本地 state,引入 KV 会让同栏两个下拉的持久化机制不一致。
 */
const VISION_MODEL_LS_KEY = "pi-web.vision.model";

/** 读视觉模型偏好;隐私模式 / SSR 下静默退化为「本次会话内有效」。 */
function readVisionModelPref(): string {
  try {
    return window.localStorage.getItem(VISION_MODEL_LS_KEY) ?? "";
  } catch {
    return "";
  }
}

/** 写视觉模型偏好;失败静默忽略。 */
function writeVisionModelPref(value: string): void {
  try {
    if (value === "") window.localStorage.removeItem(VISION_MODEL_LS_KEY);
    else window.localStorage.setItem(VISION_MODEL_LS_KEY, value);
  } catch {
    /* 隐私模式等:跨会话记忆静默不可用,会话内偏好不受影响 */
  }
}

/**
 * 比例参数簇(仅 1:1 / 16:9 / 9:16 三档)。初始 ratioSize="" 时 trigger 显示「跟随原图」,选比例即带 size。
 * ⚠️ 16:9 / 9:16(1280×720 / 720×1280)是 wan/dashscope 系尺寸;gpt-image(默认 NewAPI/sufy)只支持
 * 1:1(1024²)/1536×1024/1024×1536 —— 选 16:9/9:16 走 gpt-image 会被网关拒绝,须配 wan 模型。
 */
const RATIO_OPTIONS: readonly { label: string; size: string }[] = [
  { label: "1:1", size: "1024x1024" },
  { label: "16:9", size: "1280x720" },
  { label: "9:16", size: "720x1280" },
];

/** 浮动层公共观感(舞台上的悬浮控件)。 */
const FLOAT_LAYER =
  "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 shadow-md backdrop-blur";

/**
 * 插件图层 Inspector 编辑图层 data 的统一历史 op(task 3.2,Req 1.6)。进 undo 栈,经 1.2
 * op 行为钩子 revert=写回 prev、apply=写回 next(裁定 C 的 data 变体;放置类 op 归 3.3)。
 */
const LAYER_DATA_OP = "builtin:layer-data";

// ── 生成决策(纯函数,export 供单测)────────────────────────────────────────────

export interface GenerateDecisionInput {
  readonly imageId: string;
  readonly prompt: string;
  readonly model: string;
  /** 扩图就绪(四边扩展量任一 >0 且上传接缝可用;优先级最高——改变画布本身)。 */
  readonly hasExpand?: boolean;
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
  readonly action: "outpaint" | "inpaint" | "reference" | "variants" | "reframe" | "edit";
  /** 命令 args(inpaint 的 `mask` 由调用方在掩码上传后补充)。 */
  readonly args: Record<string, unknown>;
}

/** 空能力清单常量(退化路径喂入;内置六动作 via:"prompt" 不受 command 白名单门控,Req 2.6)。 */
const EMPTY_CAPABILITY: CanvasCapability = { models: [], sizes: [], actions: [] };

/**
 * resolveAction 空候选(理论不可达:edit 恒 `match`→10)的防御性回退,逐字复刻旧 if 链的
 * edit 兜底:base = image + prompt(+ 非空 model/size)。
 */
function fallbackEditDecision(i: {
  readonly imageId: string;
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
}): GenerateDecision {
  const base: Record<string, unknown> = { image: i.imageId, prompt: i.prompt };
  if (i.model !== "") base.model = i.model;
  if (i.size !== "") base.size = i.size;
  return { action: "edit", args: base };
}

/**
 * 生成动作决策:掩码 ＞ 引用/标注 ＞ 变体 ＞ 仅比例(空 prompt)→ reframe ＞ edit。
 * size/model 作为参数随主动作附带(schema 各动作均可选支持)。
 *
 * 实现自 task 3.2 起委托评分制动作插件链:组装 {@link ActionInput}(capability 喂空清单常量,
 * 内置六动作 via:"prompt" 不受白名单门控)→ `resolveAction(BUILTIN_GENERATE_ACTIONS)` →
 * {@link toGenerateDecision}。签名 / 导出 / 语义与旧封闭 if 链逐项等价(generate-actions.test.ts
 * 决策守恒线锁定)。
 *
 * @deprecated 兼容一个大版本;新代码直连 `resolveAction` + `BUILTIN_GENERATE_ACTIONS`
 *   (canvas-kit),按需要以 {@link toGenerateDecision} 映射胜者插件 id。
 */
export function decideGenerate(i: GenerateDecisionInput): GenerateDecision {
  const resolved = resolveAction(BUILTIN_GENERATE_ACTIONS, {
    imageId: i.imageId,
    prompt: i.prompt,
    model: i.model,
    size: i.size,
    variants: i.variants,
    hasMask: i.hasMask,
    hasExpand: i.hasExpand === true,
    referenceIds: i.referenceIds,
    capability: EMPTY_CAPABILITY,
  });
  if (resolved === null) return fallbackEditDecision(i);
  return toGenerateDecision(resolved.plugin.id, resolved.args);
}

const ACTION_LABEL: Record<GenerateDecision["action"], string> = {
  outpaint: "扩图",
  inpaint: "局部重绘",
  reference: "融合生成",
  variants: "生成变体",
  reframe: "重构比例",
  edit: "生成",
};

/**
 * 把生成决策析出为与通道无关的 {@link SurfaceOp}:领域参数组装(工具行执行注解、mask/
 * reference_images 值内注解、reframe 默认提示词、省略规则、标题行意图 ≤48 截断)原样迁移,
 * fence 固定 `canvas-op`。**不声明 fallback**(canvas 生成无控制面等价,command 态不可提交)。
 * export 供门面/单测。参数按 tool→image→mask→reference_images→prompt→size→n→model 有序组装。
 */
export function buildSurfaceOp(d: GenerateDecision, opts?: { maskId?: string }): SurfaceOp {
  const a = d.args;
  const params: Array<readonly [string, string]> = [["image", String(a.image)]];
  if (opts?.maskId !== undefined) {
    params.push(["mask", `${opts.maskId}(alpha mask,透明区=需要重绘的区域)`]);
  }
  const refs = a.reference_images;
  if (Array.isArray(refs) && refs.length > 0) {
    params.push([
      "reference_images",
      `${refs.map(String).join(", ")}(首张若为批注图,按其箭头/文字指示修改)`,
    ]);
  }
  if (typeof a.prompt === "string" && a.prompt.trim() !== "") {
    params.push(["prompt", a.prompt]);
  } else if (d.action === "reframe") {
    params.push(["prompt", "保持画面内容,仅按目标尺寸重构比例"]);
  }
  if (typeof a.size === "string") params.push(["size", a.size]);
  if (typeof a.n === "number") params.push(["n", `${a.n}`]);
  if (typeof a.model === "string") params.push(["model", a.model]);
  const intent =
    typeof a.prompt === "string" && a.prompt.trim() !== ""
      ? a.prompt.trim().length > 48
        ? `${a.prompt.trim().slice(0, 48)}…`
        : a.prompt.trim()
      : "";
  const title = intent !== "" ? `🎨 ${ACTION_LABEL[d.action]} · ${intent}` : `🎨 ${ACTION_LABEL[d.action]}`;
  return {
    title,
    tool: "image_edit(请直接按下列参数调用,勿追问、勿复述参数)",
    params,
    fence: "canvas-op",
  };
}

/**
 * 把生成决策组装为**经对话流**的用户消息(LLM 据此调 `image_edit` 工具;参数用 `att_` 引用,
 * attachment-bridge 在工具侧解析)。操作因此天然回流对话历史:用户消息 + 工具卡片 + 结果图
 * 全部可见、可回放、进 LLM 上下文(后续"刚才那张再调亮"能接上)。薄包装于 {@link buildSurfaceOp}
 * + {@link renderSurfaceOp};export 与签名不变。
 *
 * @deprecated 兼容一个大版本;新代码经动作插件 `execution.buildOp` + {@link renderSurfaceOp}
 *   取对话流载荷(BUILTIN_GENERATE_ACTIONS 内置六动作 via:"prompt" 即用此通道)。
 */
export function buildToolPrompt(d: GenerateDecision, opts?: { maskId?: string }): string {
  return renderSurfaceOp(buildSurfaceOp(d, opts));
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

// LoadedImage 已收编进 canvas-kit 类型 canonical 家;此处转发保持 workbench 既有导出面。
export type { LoadedImage } from "@blksails/pi-web-canvas-kit";

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
  /**
   * 可选视觉模型清单(spec canvas-vision-readout,Req 3.1)。
   * 由宿主(CanvasLauncher)从 `GET /api/vision/models` 拉取注入;缺省 `[]`
   * (选择器空态,解读仍可用 —— 此时载荷不带 model,由工具弹层兜底)。
   */
  readonly visionModelOptions?: readonly VisionModelOption[];
  /** 图像加载器(掩码回贴合成用;缺省浏览器 Image,测试注入 fake)。 */
  readonly imageLoader?: ImageLoader;
  /**
   * 会话能力对象(契约 §4.2;经宿主 Prompt 通道提交用户消息)。与 `onSubmitPrompt` 同族,
   * 二者在场时 conversation 优先(见 {@link useConversationBridge});承载「生成走对话流」能力。
   */
  readonly conversation?: ConversationAccess;
  /**
   * 经宿主 Prompt 通道发用户消息:提供时,「生成」组装 image_edit 指令**走对话流**
   * (LLM 调工具执行,操作回流对话历史);缺失时回退旁路 surface 命令(不过 LLM,兼容旧宿主)。
   *
   * @deprecated 使用 `conversation`;此裸回调为过渡别名,行为与之等价(契约 §4.2)。
   */
  readonly onSubmitPrompt?: (text: string) => void;
  /** 宿主转发的当前轮流式图像预览(由糊变清);配合 surface `livePreview` 显示渐进图。 */
  readonly livePreviewImage?: string;
  /** 轮末 idle 边沿信号(宿主每轮结束 bump);作 livePreview 卡死自愈锚点。 */
  readonly syncSignal?: unknown;
  /**
   * 外部插件捆(按来源命名空间分组;CanvasPanel 经 collectCanvasPluginBundles 从已装载扩展
   * 聚合而来,task 3.1)。kernel 装配期在内置工具/动作注册后逐来源 registerPluginBundles
   * (`<namespace>:` 前缀化 + requires 拓扑校验);缺依赖捆内工具进轨但恒禁用(裁定 B)。
   * 缺省(无外部插件)→ 工具轨仅内置,行为逐点与现状一致(Req 4.3)。
   */
  readonly plugins?: readonly NamespacedPluginBundles[];
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
  visionModelOptions,
  imageLoader,
  conversation,
  onSubmitPrompt,
  livePreviewImage,
  syncSignal,
  plugins,
}: CanvasWorkbenchProps): React.JSX.Element {
  const available = surface !== undefined && surface.hasCommand(PROBE);
  // 对话桥门面(契约 §4.5):三处提交点经 bridge.submitOp 分道(prompt 优先经会话能力/别名),
  // 轮末 livePreview 自愈经 bridge.onTurnEnd 订阅 syncSignal 边沿。
  const bridge = useConversationBridge({
    ...(conversation !== undefined ? { conversation } : {}),
    ...(onSubmitPrompt !== undefined ? { onSubmitPrompt } : {}),
    ...(surface !== undefined ? { surface } : {}),
    syncSignal,
    domain: DOMAIN,
  });
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState<string>("");
  // 视觉模型偏好(Req 3.2):`""` = 未设定 → 解读载荷不带 model → 工具弹层选择(Req 3.4)。
  // ⚠ 取值是 `provider/modelId`,与上面**生成**模型选择器的裸 id 格式不同,不可混用。
  const [visionModel, setVisionModel] = React.useState<string>("");
  React.useEffect(() => {
    const pref = readVisionModelPref();
    if (pref !== "") setVisionModel(pref);
  }, []);
  const [busy, setBusy] = React.useState(false);
  const [currentId, setCurrentId] = React.useState<string>(asset.attachmentId);
  // 生成中的临时渐进预览(流式 partial_images 由糊变清):订阅权威快照 livePreview,渲染为舞台叠层。
  const [livePreview, setLivePreview] = React.useState<GalleryState["livePreview"]>(
    () => surface?.getState<GalleryState>(STATE_KEY)?.livePreview ?? null,
  );
  // 能力清单(agent 权威;task 3.3):纳入同一订阅态,agent 侧晚到的 capability 帧刷新
  // 模型/尺寸选项与决策门控输入。缺失(旧快照/退化)= undefined,消费侧 ?? 链回退硬编码。
  const [capabilities, setCapabilities] = React.useState<GalleryState["capabilities"]>(
    () => surface?.getState<GalleryState>(STATE_KEY)?.capabilities,
  );
  React.useEffect(() => {
    if (surface === undefined) return;
    const read = (): void => {
      const s = surface.getState<GalleryState>(STATE_KEY);
      setLivePreview(s?.livePreview ?? null);
      setCapabilities(s?.capabilities);
    };
    read();
    return surface.subscribe(STATE_KEY, read);
  }, [surface]);
  // 轮末兜底自愈:清除帧(livePreview:null)在 dev 帧投递不稳/长流式高频窗口下可能丢失,
  // 叠层会卡死在「生成中」。轮末 idle 边沿(bridge.onTurnEnd,首见不触发仅变化触发)时生成必已
  // 结束 → 无条件清叠层。
  React.useEffect(() => bridge.onTurnEnd(() => setLivePreview(null)), [bridge]);
  // ── M2 状态:@引用 / 参数簇 ──────────────────────────────────────────────────
  const [refs, setRefs] = React.useState<readonly string[]>([]);
  const [refOpen, setRefOpen] = React.useState(false);
  const [ratioSize, setRatioSize] = React.useState<string>("");
  const [variantsN, setVariantsN] = React.useState(1);
  const [sizeOpen, setSizeOpen] = React.useState(false);
  const [customW, setCustomW] = React.useState("");
  const [customH, setCustomH] = React.useState("");
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);
  /** natural 的 ref 镜像(kernel env 访问器在事件回调期读取;经 effect 与 state 同步)。 */
  const naturalRef = React.useRef<{ w: number; h: number } | null>(null);

  // ── 交互内核(4.1 状态搬家 + 4.2 注册表驱动):per mount,8 内置工具自举 ─────────
  // StrictMode 双跑 useMemo 会各建一份(纯状态容器零副作用,弃置其一安全);DOM 量取
  // 与 pointer capture 经 env 接缝延迟到调用时,kernel 本身零 DOM 依赖。
  // prefs 初值注入(硬账③,同键契约):annoColor/brushRatio/expandEdges。
  const kernel = React.useMemo(() => {
    const k = createCanvasKernel({
      getRect: () => overlayRef.current?.getBoundingClientRect() ?? null,
      getNaturalSize: () => naturalRef.current,
      capturePointer: (target, pointerId) => {
        (target as unknown as Element).setPointerCapture?.(pointerId);
      },
      initialPrefs: {
        [PREF_ANNO_COLOR]: ANNOTATION_COLOR,
        [PREF_BRUSH_RATIO]: BRUSH_RATIOS[1],
        [PREF_EXPAND_EDGES]: NO_EXPAND,
      },
    });
    registerBuiltinTools(k.registry);
    // 六内置生成动作同位注册进同一 per-instance 注册表(task 3.2);退订随 kernel(per-mount,
    // 卸载即弃)生命周期,与 registerBuiltinTools 的既有装配形态一致,无需捕获 unregister。
    registerBuiltinGenerateActions(k.registry);
    // 外部插件捆(task 3.1):内置注册后逐来源命名空间 registerPluginBundles(前缀化 + requires
    // 拓扑校验;缺依赖捆内工具进轨恒禁用,裁定 B)。退订随 kernel 生命周期,同内置装配形态。
    // 装配同步于首帧前(与内置同位),故工具轨首渲即含插件工具(禁用态一并就位)。
    for (const { namespace, bundles } of plugins ?? []) {
      registerPluginBundles(k.registry, bundles, { namespace });
    }
    // 插件图层 Inspector data 编辑的 undo/redo 行为(task 3.2,Req 1.6;裁定 C data 变体):
    // op.item 携 {layerId, prev, next},撤销写回 prev、重做写回 next。装配期一次注册(未注册
    // 该 kind 时纯栈语义零变);内置图像图层不产此 op,零影响。
    k.opBehaviors.registerOpBehavior(LAYER_DATA_OP, {
      revert: (op) => {
        const it = op.item as { layerId: string; prev: unknown };
        k.layers.updateData(it.layerId, it.prev);
      },
      apply: (op) => {
        const it = op.item as { layerId: string; next: unknown };
        k.layers.updateData(it.layerId, it.next);
      },
    });
    k.tools.setActiveTool(MOVE_TOOL_ID);
    return k;
    // plugins 来自 source 声明,mount 时即就位且经 CanvasPanel useMemo 稳定引用;身份变化
    // (罕见:扩展集变更)才重建 kernel(新画布)——per-mount 契约由稳定引用维持。
  }, [plugins]);

  // 工具通道快照(激活工具/draft/禁用)与 prefs 快照(选项条双向绑定/扩图边)。
  const toolsSnap = React.useSyncExternalStore(
    kernel.tools.subscribe,
    kernel.tools.getSnapshot,
    kernel.tools.getSnapshot,
  );
  const prefsSnap = React.useSyncExternalStore(
    kernel.prefs.subscribe,
    kernel.prefs.getSnapshot,
    kernel.prefs.getSnapshot,
  );
  const activeToolId = toolsSnap.activeToolId;
  const activeCanvasTool = kernel.registry.tools.find((t) => t.id === activeToolId) ?? null;
  /** overlay 命中门控(硬账②):工具声明 overlayInteractive 才开 pointer-events。 */
  const overlayInteractive = activeCanvasTool?.overlayInteractive === true;
  // ── 扩图:四边扩展量(源图像素;>0 即扩图意图,生成走 outpaint)—— prefs KV(4.2)──
  const expand = (prefsSnap[PREF_EXPAND_EDGES] as ExpandEdges | undefined) ?? NO_EXPAND;

  // ── M3 状态:图层(树状态/选中/id 序列归 layers 内核,4.1)──────────────────────
  const layersSnap = React.useSyncExternalStore(
    kernel.layers.subscribe,
    kernel.layers.getSnapshot,
    kernel.layers.getSnapshot,
  );
  const layers = layersSnap.layers;
  const selectedLayer = layersSnap.selectedId;

  // 当前工作图:优先内部选择,回退到 prop。prop 变化(父切换)时同步。
  const current = React.useMemo(
    () => assets.find((a) => a.attachmentId === currentId) ?? asset,
    [assets, currentId, asset],
  );
  React.useEffect(() => setCurrentId(asset.attachmentId), [asset.attachmentId]);

  // ── 舞台缩放 / 平移(移动工具)—— 视口状态归 stage 内核(4.1)──────────────────
  const viewport = React.useSyncExternalStore(
    kernel.stage.subscribe,
    kernel.stage.getViewport,
    kernel.stage.getViewport,
  );
  const scale = viewport.scale;
  const offset = viewport.offset;

  // ── 编辑历史(掩码笔迹 + 标注共栈;撤销/重做按操作顺序)—— 双栈归 history 内核(4.1)
  const history = React.useSyncExternalStore(
    kernel.history.subscribe,
    kernel.history.getSnapshot,
    kernel.history.getSnapshot,
  );
  const ops = history.ops;
  const strokes = React.useMemo(
    () => ops.filter((o) => o.kind === "stroke").map((o) => o.item as MaskStroke),
    [ops],
  );
  const annotations = React.useMemo(
    () => ops.filter((o) => o.kind === "anno").map((o) => o.item as Annotation),
    [ops],
  );
  // 源图自然尺寸(overlay 坐标系)与舞台尺寸(contain-fit 计算)。
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const [stageSize, setStageSize] = React.useState<{ w: number; h: number } | null>(null);

  // naturalRef 镜像:kernel env 访问器在指针回调期读取(事件必发生在 effect 提交后)。
  React.useEffect(() => {
    naturalRef.current = natural;
  }, [natural]);

  const resetView = React.useCallback(() => {
    kernel.stage.reset();
  }, [kernel]);

  // 切换工作图 → 复位视图 + 清空编辑历史/图层/进行中 draft(含文本编辑器)+ 扩图边
  // (prefs 同键复位)+ 重新量自然尺寸。
  React.useEffect(() => {
    resetView();
    kernel.history.clear();
    kernel.tools.context.draft.set(null);
    kernel.layers.clear();
    kernel.prefs.set(PREF_EXPAND_EDGES, NO_EXPAND);
    setNatural(null);
  }, [current.attachmentId, resetView, kernel]);

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
      kernel.stage.zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [kernel]);

  // overlay 预览重绘(4.2 注册表驱动):已提交 ops 按 opKinds 注册表回放(提交序)
  // + 激活工具 rasterizeDraft(进行中手势预览)。清屏留装配层(canvas 元素属 DOM)。
  React.useEffect(() => {
    const cv = overlayRef.current;
    if (cv === null || natural === null) return;
    const ctx = cv.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // 真实 CanvasRenderingContext2D 是 Ctx2DLike 的超集(fillStyle 为 union),收窄安全。
    kernel.renderOverlay(ctx as unknown as Ctx2DLike, { w: natural.w, h: natural.h });
  }, [ops, toolsSnap.draft, natural, kernel]);

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

  // 扩展后画布(hasExpand 时 wrapper 按 extended 布局,原图/overlay/图层带偏移定位)。
  const ext = natural !== null ? expandedSize({ width: natural.w, height: natural.h }, expand) : null;
  const expanding = hasExpand(expand);

  const maskReady = hasMaskContent(strokes) && upload !== undefined;
  const expandReady = expanding && upload !== undefined;
  // 切换模型令已选尺寸落在新模型受支持集外 → 复位为 ""(跟随原图),不静默发不支持组合(4.3)。
  // 仅在 model 真正切换时触发(prevModelRef 守卫):同模型下的自定义 W×H 输入/尺寸选择不受影响。
  const prevModelRef = React.useRef(model);
  React.useEffect(() => {
    if (model === prevModelRef.current) return;
    prevModelRef.current = model;
    if (ratioSize === "") return;
    const supported = capabilities?.models.find((m) => m.id === model)?.sizes;
    if (supported !== undefined && !supported.includes(ratioSize)) setRatioSize("");
  }, [model, capabilities, ratioSize]);

  // 快照能力清单(agent 权威,4.4/4.5 门控用;缺失→空清单 = command 动作全排除)。经响应式
  // capabilities 态派生,决策输入与模型/尺寸选项消费(见底部提示词栏)同源(task 3.3)。
  const snapshotCapability = capabilities ?? EMPTY_CAPABILITY;
  // 决策预览(生成按钮的动作/文案;inpaint 的 mask 与标注拍平图在 generate 时才上传)。经注册表
  // 评分制决策(kernel.registry.actions),胜者插件 id 经 toGenerateDecision 映射回 GenerateDecision
  // ——data-canvas-action 与 ACTION_LABEL 消费面零变(内置六动作 label 逐字等同 ACTION_LABEL)。
  const previewResolved = resolveAction(kernel.registry.actions, {
    imageId: current.attachmentId,
    prompt,
    model,
    size: ratioSize,
    variants: variantsN,
    hasMask: maskReady,
    hasExpand: expandReady,
    referenceIds: annotations.length > 0 && upload !== undefined ? ["__anno__", ...refs] : refs,
    capability: snapshotCapability,
  });
  const decisionPreview: GenerateDecision =
    previewResolved !== null
      ? toGenerateDecision(previewResolved.plugin.id, previewResolved.args)
      : fallbackEditDecision({ imageId: current.attachmentId, prompt, model, size: ratioSize });

  /**
   * 解读:对当前工作图提问,经**与生成相同的对话通道**发出(spec canvas-vision-readout)。
   *
   * 与 {@link generate} 刻意保持平行且互不干扰(Req 4.2/4.3/4.4):
   *  - **不进入** `resolveAction` 评分制 —— 解读由显式按钮触发,不与生成动作竞争;
   *  - **不调用** `consumeSent` —— 掩码 / 参考图 / 标注只服务生成,解读只看当前工作图,
   *    点击后它们原样保留,供后续生成使用;
   *  - **不上传**标注拍平图;
   *  - 发出后**保留**输入框文字(与生成按钮既有行为一致,Req 1.4)。
   *
   * 结论由 `image_vision` 工具产出并回流对话记录(工具卡 + 助手回复),
   * Canvas 侧不另建结论展示区(Req 2.4),也不解释失败(Req 5.1 交给工具)。
   */
  const readout = React.useCallback(async (): Promise<void> => {
    if (bridge.opChannel !== "prompt") return;
    setBusy(true);
    try {
      await bridge.submitOp(
        buildVisionOp({
          imageId: current.attachmentId,
          question: prompt,
          // 空偏好 → 不带 model 参数 → 工具弹层选择(3.4);非空 → 直接用(3.3)。
          ...(visionModel !== "" ? { model: visionModel } : {}),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [bridge, current.attachmentId, prompt, visionModel]);

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
      // 注册表评分制决策(task 3.2):actionInput.capability = 快照能力(缺失→空清单,command
      // 动作全排除,内置六 prompt 动作不受门控);胜者插件 id 经 toGenerateDecision 映射回
      // decision——下游通道选择/资产编排/consumeSent/settleWindow 结构逐行零变。
      const resolved = resolveAction(kernel.registry.actions, {
        imageId: current.attachmentId,
        prompt,
        model,
        size: ratioSize,
        variants: variantsN,
        hasMask: hasMaskContent(strokes) && upload !== undefined,
        hasExpand: hasExpand(expand) && upload !== undefined,
        referenceIds,
        capability: surface.getState<GalleryState>(STATE_KEY)?.capabilities ?? EMPTY_CAPABILITY,
      });
      const decision: GenerateDecision =
        resolved !== null
          ? toGenerateDecision(resolved.plugin.id, resolved.args)
          : fallbackEditDecision({ imageId: current.attachmentId, prompt, model, size: ratioSize });

      // 消费快照:只清「本次发送时存在的」引用/标注/笔迹 —— 飞行期间用户可能已新加,
      // 全量清空会把新输入吞掉(竞争)。
      const sentRefs = new Set(refs);
      const sentAnnos = new Set(annotations);
      const sentStrokes = new Set(strokes);
      const consumeSent = (withStrokes: boolean): void => {
        setRefs((prev) => prev.filter((r) => !sentRefs.has(r)));
        // history.prune = 按谓词过滤 ops + 清空重做栈(原 setOps(filter)+setRedoOps([]))。
        kernel.history.prune((o) => {
          if (o.kind === "anno") return !sentAnnos.has(o.item as Annotation);
          return withStrokes ? !sentStrokes.has(o.item as MaskStroke) : true;
        });
      };

      // 插件 command 动作(task 3.4 remediation;design System Flows「按胜者 via 分道」):
      // 胜出插件声明 via:"command" → 直接经命令通道派发其声明命令(capability.actions 门控已在
      // resolveAction 内保证白名单命中),不塌缩为 GenerateDecision(六内置 id 之外映射会回退
      // edit,曾致插件命令动作永远走 image_edit 对话流)。内置六动作全 via:"prompt",不进此分支
      // ——下游既有编排逐行零变。引用消费与 reference 同构(参考图已随命令发出)。
      if (resolved !== null && resolved.plugin.execution.via === "command") {
        await settleWindow(
          surface.run(DOMAIN, resolved.plugin.execution.command, resolved.args),
        );
        consumeSent(false);
        return;
      }

      if (decision.action === "outpaint" && upload !== undefined) {
        // 扩图:本地合成「大画布+原图居位」输入图 + alpha mask(扩展区透明=生成)。
        const src = sourceSize();
        const opts = canvasFactory !== undefined ? { canvasFactory } : {};
        const bigUri = outpaintImage(src, expand, opts);
        const maskUri = outpaintMask({ width: src.width, height: src.height }, expand, opts);
        const [big, maskUp] = await Promise.all([
          uploadDataUri({
            dataUri: bigUri,
            name: `outpaint-${current.name}`,
            baseUrl: baseUrl ?? "",
            sessionId: sessionId ?? "",
            upload,
          }),
          uploadDataUri({
            dataUri: maskUri,
            name: `outpaint-mask-${current.name}`,
            baseUrl: baseUrl ?? "",
            sessionId: sessionId ?? "",
            upload,
          }),
        ]);
        const args: Record<string, unknown> = {
          ...decision.args,
          image: big.attachmentId,
          prompt:
            prompt.trim() !== ""
              ? prompt
              : "向外自然延展画面内容,与原图风格/光影无缝衔接",
        };
        if (bridge.opChannel === "prompt") {
          void bridge.submitOp(
            buildSurfaceOp({ action: "outpaint", args }, { maskId: maskUp.attachmentId }),
          );
        } else {
          await settleWindow(
            surface.run(DOMAIN, "outpaint", { ...args, mask: maskUp.attachmentId }),
          );
        }
        kernel.prefs.set(PREF_EXPAND_EDGES, NO_EXPAND);
        return;
      }

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
        if (bridge.opChannel === "prompt") {
          // 走对话流(A 方案):LLM 调 image_edit,操作回流对话历史。
          // ⚠回贴暂不随此路径启动:工具产物经轮末 sync 收编,快照资产无 derivedFrom=基图
          // 锚点,waitForNewDerivedAsset 匹配不到(误配风险大于收益);恢复待工具结果 meta 带血缘。
          void bridge.submitOp(buildSurfaceOp(decision, { maskId }));
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

      if (bridge.opChannel === "prompt") {
        // 走对话流(A 方案默认):组装 image_edit 指令为用户消息,LLM 调工具执行。
        void bridge.submitOp(buildSurfaceOp(decision));
        if (decision.action === "reference") consumeSent(false);
        return;
      }
      // 回退:旁路 surface 命令(不过 LLM;兼容未接 Prompt 通道的宿主/测试)。
      await settleWindow(surface.run(DOMAIN, decision.action, decision.args));
      if (decision.action === "reference") consumeSent(false);
    } finally {
      setBusy(false);
    }
  }, [available, surface, refs, annotations, strokes, expand, upload, canvasFactory, current, baseUrl, sessionId, prompt, model, variantsN, ratioSize, imageLoader, bridge, kernel]);

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

  // ── 指针唯一入口(4.2:PointerRouter;命中判定经 DOM data-* 标记,散点分支拆除)──
  // 容器级 pointer 事件全量喂路由:层/手柄/overlay/stage 命中互斥会话,双事件守卫内建
  // (onMouseDown stopPropagation 补丁族结构性根治);capture 经 env 接缝在 down 目标上
  // 设置,后续事件钉住目标冒泡回容器,扩图手柄小目标拖动续流(硬账⑥)。
  const routerEvent = (e: React.PointerEvent): RouterPointerEvent => ({
    pointerId: e.pointerId,
    clientX: e.clientX,
    clientY: e.clientY,
    target: e.target as Element | null,
  });

  // ── M3:图层(加/拖放/变换/拍平;全 B 档本地)──────────────────────────────────
  const loader = imageLoader ?? defaultImageLoader;

  /** 加一层:初始宽 = 底图宽 40%,高按图像纵横比(加载后修正);落点居中(缺省底图中心)。 */
  const addLayer = React.useCallback(
    (
      att: { attachmentId: string; displayUrl: string },
      at?: { x: number; y: number },
      meta?: { kind: string; data?: unknown },
    ): void => {
      // 初始几何/占位策略/id 序列归 layers 内核(natural 未量到由 store 退化 1024 占位)。
      const id = kernel.layers.add(att, at ?? null, natural, meta ?? null);
      // 插件图层(kind 声明)以 Render 呈现,无位图源;不走图像 loader(displayUrl 为空)。
      if (meta !== undefined) return;
      void loader(att.displayUrl)
        .then((img) => kernel.layers.markLoaded(id, img))
        .catch(() => {
          // 加载失败:层保留占位(拍平时跳过;markLoaded 不调用)。
        });
    },
    [kernel, natural, loader],
  );

  /**
   * 放置插件图层(task 3.2「点击置层」seam):贴纸类工具激活期舞台按下 → 据工具 createLayer
   * 声明在按下处新建一个插件图层(工具上下文 layers 只读,写路径归装配层)。坐标经 overlay
   * rect 换算底图像素(rect 不可得 → 落点居中,由 store 退化处理)。
   */
  const placePluginLayer = React.useCallback(
    (create: { kind: string; data?: unknown }, e: React.PointerEvent): void => {
      const cv = overlayRef.current;
      let at: { x: number; y: number } | undefined;
      if (cv !== null && natural !== null) {
        const rect = cv.getBoundingClientRect();
        if (rect.width > 0) {
          at = {
            x: ((e.clientX - rect.left) / rect.width) * natural.w,
            y: ((e.clientY - rect.top) / rect.height) * natural.h,
          };
        }
      }
      addLayer({ attachmentId: "", displayUrl: "" }, at, { kind: create.kind, data: create.data });
    },
    [addLayer, natural],
  );

  /**
   * 插件图层 Inspector 编辑回写(task 3.2,Req 1.3/1.6):更新该层 data 并把「旧值→新值」
   * 提交为 LAYER_DATA_OP 进统一 undo 栈(装配期已注册 revert/apply 写回)。
   */
  const onInspectorUpdate = React.useCallback(
    (id: string, data: unknown): void => {
      const prev = kernel.layers.get(id)?.data;
      kernel.layers.updateData(id, data);
      kernel.history.commit({ kind: LAYER_DATA_OP, item: { layerId: id, prev, next: data } });
    },
    [kernel],
  );

  /** OS 图片文件 → 上传接缝落 att_ → register 进画廊(origin=upload)→ 成层。拖放与粘贴共用。 */
  const importFile = React.useCallback(
    (file: File, at?: { x: number; y: number }): void => {
      if (upload === undefined) return;
      void upload(baseUrl ?? "", sessionId ?? "", file).then(async (res) => {
        if (available && surface !== undefined) {
          await settleWindow(
            surface.run(DOMAIN, "register", { attachmentId: res.attachment.id }),
          );
        }
        addLayer({ attachmentId: res.attachment.id, displayUrl: res.displayUrl }, at);
      });
    },
    [upload, baseUrl, sessionId, available, surface, addLayer],
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
    // OS 文件:落 att_ → 成层。
    const file = e.dataTransfer.files?.[0];
    if (file !== undefined) importFile(file, at);
  };

  /**
   * 粘贴图片(Cmd/Ctrl+V):剪贴板含图片文件 → 复用 importFile 落图层(居中)。
   * document 级监听(舞台 div 不可聚焦难收 paste 事件),仅在剪贴板**含图片**时接管——
   * 纯文本粘贴(如往提示词框)不受影响;无上传接缝时静默降级。
   */
  React.useEffect(() => {
    if (upload === undefined) return undefined;
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items;
      if (items === undefined) return;
      for (const it of Array.from(items)) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file !== null) {
            e.preventDefault();
            importFile(file); // 无坐标 → 舞台居中
            return;
          }
        }
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload, importFile]);

  /** 拍平:底图 + 依序各层 → 上传 att_ → register(derivedFrom=底图)→ 清层。 */
  const flatten = React.useCallback(async (): Promise<void> => {
    if (upload === undefined || layers.length === 0) return;
    setBusy(true);
    try {
      // 确保所有图像层已加载(占位未完成的现场补载;失败层跳过)。插件图层(kind 声明)无位图源,
      // 不走 loader —— 拍平时经插件 bake 烤入(下)。
      const resolved = await Promise.all(
        layers.map(async (l) => {
          if (l.kind !== undefined || l.loaded !== undefined) return l;
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
      // 合成输入:依序各层 → 插件图层(kind 命中 registry.layers)经 bake 烤进 per-layer 画布
      // (bake 抛错跳过该层 + 诊断,不阻塞产物,Req 1.4);图像图层保持 loaded.source(既有
      // drawImage 逐字节零变)。per-layer 画布经注入 canvasFactory(jsdom fake / 生产 DOM)。
      const mkCanvas =
        canvasFactory ?? (() => document.createElement("canvas") as unknown as CanvasLike);
      const flattenInputs: Array<{
        source: CanvasImageSource | CanvasLike;
        x: number;
        y: number;
        w: number;
        h: number;
      }> = [];
      for (const l of resolved) {
        const plugin =
          l.kind !== undefined
            ? kernel.registry.layers.find((p) => p.type === l.kind)
            : undefined;
        if (plugin !== undefined) {
          const bw = Math.max(1, Math.round(l.w));
          const bh = Math.max(1, Math.round(l.h));
          const cv = mkCanvas();
          cv.width = bw;
          cv.height = bh;
          const bctx = cv.getContext("2d");
          if (bctx === null) continue;
          try {
            await plugin.bake(bctx, l, { w: bw, h: bh });
            flattenInputs.push({ source: cv, x: l.x, y: l.y, w: l.w, h: l.h });
          } catch (err) {
            // bake 抛错:跳过该层 + 诊断(kind:"plugin"),产物不阻塞(与 hydrate 退化同哲学)。
            kernel.registry.recordPluginDiagnostic(l.kind!, `图层拍平 bake 抛错: ${String(err)}`);
          }
        } else if (l.loaded !== undefined) {
          flattenInputs.push({ source: l.loaded.source, x: l.x, y: l.y, w: l.w, h: l.h });
        }
      }
      const uri = flattenLayers(src, flattenInputs, opts);
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
      kernel.layers.clear();
    } finally {
      setBusy(false);
    }
  }, [upload, layers, loader, canvasFactory, current, baseUrl, sessionId, available, surface, kernel]);

  // 嗅探:真实像素尺寸(natural);扩展时显示扩展后画布。
  const sniff =
    natural !== null
      ? expanding && ext !== null
        ? `${natural.w}×${natural.h} → ${ext.width}×${ext.height}`
        : `${natural.w}×${natural.h}`
      : undefined;
  const summary = [...(sniff !== undefined ? [sniff] : []), ...summarizeGenParams(current)].join(" · ");
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
              "relative block aspect-square w-full shrink-0 overflow-hidden rounded-md border transition-[opacity,border-color,box-shadow]",
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

  // ── 区块:右侧工具轨(4.2:map registry.tools 注册表驱动;新工具注册自动纳入)────
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
      {kernel.registry.tools.map((t) => (
        <Button
          key={t.id}
          variant={activeToolId === t.id ? "default" : "ghost"}
          size="icon"
          className="h-8 w-8"
          aria-pressed={activeToolId === t.id}
          aria-label={t.label}
          title={resolveToolRailTitle(
            TOOL_RAIL_TITLES[t.id] ?? t.label,
            t.id,
            toolsSnap.disabledTools,
            kernel.registry.diagnostics,
            // 插件缺依赖恒禁用时取回原因(裁定 B;非插件工具 → undefined,title 逐字节零变)。
            kernel.registry.disabledPluginToolReason(t.id),
          )}
          data-canvas-tool={toolAnchor(t.id)}
          disabled={
            (!BACKEND_FREE_TOOLS.has(t.id) && maskToolsDisabled) ||
            toolsSnap.disabledTools.includes(t.id) ||
            // 插件缺依赖 → 恒禁用(裁定 B;工具进轨但置灰,tooltip 显缺失项)。
            kernel.registry.disabledPluginTools.has(t.id)
          }
          onClick={() => kernel.tools.setActiveTool(t.id)}
        >
          {t.icon}
        </Button>
      ))}

      {/* 选项条 = 激活工具贡献(4.2;data-canvas-anno-colors/brush-sizes 锚点由内置实现保持)。 */}
      {activeCanvasTool?.optionsBar !== undefined
        ? activeCanvasTool.optionsBar(kernel.tools.context)
        : null}

      <div className="my-0.5 h-px w-6 bg-[hsl(var(--border))]" />
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="撤销" data-canvas-undo disabled={!history.canUndo} onClick={() => kernel.history.undo()}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="重做" data-canvas-redo disabled={!history.canRedo} onClick={() => kernel.history.redo()}>
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
  // 扩图态四周预留手柄操作区:右侧工具轨/左侧版本条是更高 z 的浮层(wrapper 因 transform
  // 自成 stacking context,内部手柄 z 压不过它们),贴边时手柄会被盖住不可点。
  const fitPad = activeToolId === EXPAND_TOOL_ID ? 56 : 0;
  const fit =
    ext !== null && stageSize !== null
      ? Math.min(
          Math.max(64, stageSize.w - fitPad * 2) / ext.width,
          Math.max(64, stageSize.h - fitPad * 2) / ext.height,
        )
      : null;
  const wrapperStyle: React.CSSProperties =
    ext !== null && fit !== null
      ? {
          width: ext.width * fit,
          height: ext.height * fit,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }
      : { width: "100%", height: "100%", transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` };
  // eslint-disable-next-line no-lone-blocks -- (占位:原重复 expanding 定义已上移)
  /** 原图区在扩展画布内的百分比定位(无扩展时 = 满幅)。 */
  const baseRect =
    natural !== null && ext !== null
      ? {
          left: `${(expand.left / ext.width) * 100}%`,
          top: `${(expand.top / ext.height) * 100}%`,
          width: `${(natural.w / ext.width) * 100}%`,
          height: `${(natural.h / ext.height) * 100}%`,
        }
      : { left: "0%", top: "0%", width: "100%", height: "100%" };

  const zoomPct = Math.round(scale * 100);
  // 舞台光标:overlay 手势工具的 cursor 施加在 overlay 画布上(见下);舞台级工具
  // (move)的 cursor 施加在舞台容器上,grab 类在手势中(draft 在场)切 grabbing。
  const stageCursor =
    activeCanvasTool !== null && !overlayInteractive && activeCanvasTool.cursor !== undefined
      ? activeCanvasTool.cursor === "grab" && toolsSnap.draft !== null
        ? "grabbing"
        : activeCanvasTool.cursor
      : undefined;
  const stage = (
    <Card
      ref={stageRef}
      data-canvas-stage
      data-canvas-active-tool={activeToolId !== null ? toolAnchor(activeToolId) : undefined}
      className="canvas-checkerboard relative flex h-full w-full items-center justify-center overflow-hidden p-0"
      onPointerDown={(e) => {
        // 插件图层「点击置层」(task 3.2):贴纸类工具声明 createLayer 时,舞台按下先放置一层
        // (装配层写路径);随后仍交指针路由(插件工具无 onDown,路由无副作用)。
        if (activeCanvasTool?.createLayer !== undefined) {
          placePluginLayer(activeCanvasTool.createLayer, e);
        }
        kernel.pointer.onPointerDown(routerEvent(e));
      }}
      onPointerMove={(e) => kernel.pointer.onPointerMove(routerEvent(e))}
      onPointerUp={(e) => kernel.pointer.onPointerUp(routerEvent(e))}
      onPointerCancel={(e) => kernel.pointer.onPointerCancel(routerEvent(e))}
      onDoubleClick={activeToolId === MOVE_TOOL_ID ? resetView : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onStageDrop}
      style={{ cursor: stageCursor }}
    >
      {/* 流式渐进预览叠层(由糊变清):生成中盖住舞台。有小尺寸预览则显图,否则显指示;
          完整渐进图由对话流工具卡承载(4:6 布局下与 Canvas 并列可见)。出终图即清。 */}
      {livePreview != null ? (
        <div
          data-canvas-live-preview
          data-canvas-live-preview-stage={livePreview.stage}
          className="absolute inset-0 z-[40] flex flex-col items-center justify-center gap-3 bg-[hsl(var(--background))]/75 backdrop-blur-sm"
        >
          {(livePreviewImage ?? livePreview.displayUrl) !== undefined ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={livePreviewImage ?? livePreview.displayUrl}
              alt="生成中预览"
              className="max-h-[80%] max-w-[80%] rounded-md object-contain shadow-lg"
            />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
          )}
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-full bg-[hsl(var(--background))]/90 px-3 py-1 text-xs text-[hsl(var(--muted-foreground))] shadow"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {livePreview.stage === "finalizing" ? "正在保存…" : "生成中 · 由糊变清"}
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "relative shrink-0 will-change-transform",
          expanding && "outline-dashed outline-1 outline-[hsl(var(--primary))]",
        )}
        style={wrapperStyle}
      >
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
          className="absolute select-none object-fill"
          style={baseRect}
          crossOrigin="anonymous"
        />
        {/* 图层(底图之上、掩码/标注 overlay 之下;百分比定位随 wrapper 缩放)。 */}
        {natural !== null
          ? layers.map((l) => {
              // 插件图层(task 3.2):kind 命中 registry.layers → 定位容器内渲染插件 Render(替换
              // img,随视口 scale 缩放);无 kind(或 kind 未注册)走既有 img,逐字节零变(Req 1.5)。
              const layerPlugin =
                l.kind !== undefined
                  ? kernel.registry.layers.find((p) => p.type === l.kind)
                  : undefined;
              const PluginRender = layerPlugin?.Render;
              return (
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
                  left: `${((expand.left + l.x) / (ext?.width ?? natural.w)) * 100}%`,
                  top: `${((expand.top + l.y) / (ext?.height ?? natural.h)) * 100}%`,
                  width: `${(l.w / (ext?.width ?? natural.w)) * 100}%`,
                  height: `${(l.h / (ext?.height ?? natural.h)) * 100}%`,
                  cursor: "move",
                }}
                // 层拖拽/缩放 = 工具无关内核手势:pointer 事件冒泡到舞台容器经路由
                // 命中 data-canvas-layer 标记分派(独占会话,双事件补丁族不再需要)。
              >
                {PluginRender !== undefined ? (
                  <div data-canvas-plugin-layer className="h-full w-full">
                    <PluginRender layer={l} scale={scale} />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.displayUrl}
                    alt=""
                    draggable={false}
                    className="h-full w-full select-none object-fill"
                    crossOrigin="anonymous"
                  />
                )}
                {selectedLayer === l.id ? (
                  <span
                    data-canvas-layer-resize
                    aria-label="缩放图层"
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-[hsl(var(--background))] bg-[hsl(var(--primary))]"
                  />
                ) : null}
              </div>
              );
            })
          : null}
        {natural !== null ? (
          <canvas
            ref={overlayRef}
            data-canvas-mask-overlay
            width={natural.w}
            height={natural.h}
            style={{
              ...baseRect,
              ...(overlayInteractive && activeCanvasTool?.cursor !== undefined
                ? { cursor: activeCanvasTool.cursor }
                : {}),
            }}
            className={cn(
              "absolute z-[3]",
              // overlayInteractive 门控保持(硬账②):非 overlay 手势工具下 overlay 不夺
              // 命中(pointer-events-none),move 的舞台平移/层拖拽照常穿透。
              !overlayInteractive && "pointer-events-none",
            )}
          />
        ) : null}
        {/* 扩图手柄:四边中点,拖动向外扩(源图像素);仅扩图工具激活时显示。手柄 DOM 留
            workbench(design 裁定),事件经 data-canvas-expand-handle 标记走路由 —— down 时
            capture 钉住手柄,后续事件冒泡回容器,小目标拖动续流(硬账⑥)。 */}
        {activeToolId === EXPAND_TOOL_ID && natural !== null
          ? (
              [
                { edge: "top" as const, cls: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
                { edge: "right" as const, cls: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" },
                { edge: "bottom" as const, cls: "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize" },
                { edge: "left" as const, cls: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" },
              ].map((h) => (
                <span
                  key={h.edge}
                  data-canvas-expand-handle={h.edge}
                  aria-label={`向${h.edge === "top" ? "上" : h.edge === "right" ? "右" : h.edge === "bottom" ? "下" : "左"}扩展`}
                  className={cn(
                    "absolute z-[4] h-3 w-3 rounded-sm border border-[hsl(var(--background))] bg-[hsl(var(--primary))] shadow",
                    h.cls,
                  )}
                />
              ))
            )
          : null}
        {/* 激活工具 DOM 叠层贡献(text 编辑器等):挂进与 overlay 画布重合的定位容器
            (硬账①:natural 百分比定位的等价性前提);容器本身不夺命中,贡献内容自带
            pointer-events-auto。 */}
        {natural !== null && activeCanvasTool?.overlayReact !== undefined
          ? (() => {
              const contributed = activeCanvasTool.overlayReact(kernel.tools.context);
              return contributed !== null && contributed !== undefined ? (
                <div
                  data-canvas-tool-overlay
                  className="pointer-events-none absolute z-20"
                  style={baseRect}
                >
                  {contributed}
                </div>
              ) : null;
            })()
          : null}
      </div>
      {/* 扩展信息条(扩图态顶部中央;与层浮条并存时下移)。 */}
      {expanding && ext !== null ? (
        <div
          data-canvas-expand-bar
          className={cn(
            "absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2.5 py-0.5 text-xs shadow-sm backdrop-blur",
            layers.length > 0 ? "top-11" : "top-2",
          )}
        >
          <span className="text-[hsl(var(--muted-foreground))]">
            扩图 → {ext.width}×{ext.height}
          </span>
          <button
            type="button"
            data-canvas-expand-reset
            onClick={() => kernel.prefs.set(PREF_EXPAND_EDGES, NO_EXPAND)}
            className="text-[hsl(var(--muted-foreground))] underline-offset-2 hover:underline"
          >
            复位
          </button>
        </div>
      ) : null}
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
                // remove(选中层)含清选中(:1694 语义在 store 内)。
                if (selectedLayer !== null) kernel.layers.remove(selectedLayer);
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
            onClick={() => kernel.layers.clear()}
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
      {/* 插件图层 Inspector 浮层(task 3.2,Req 1.3):选中的插件图层其 kind 命中 registry.layers
          且插件有 Inspector 时,贴右上角浮层渲染;编辑经 onInspectorUpdate 回写 data + 进 undo 栈。
          非插件图层/无 Inspector → 不渲染(既有图像图层无检查器,零影响)。 */}
      {(() => {
        if (selectedLayer === null) return null;
        const sel = layers.find((l) => l.id === selectedLayer);
        if (sel === undefined || sel.kind === undefined) return null;
        const Inspector = kernel.registry.layers.find((p) => p.type === sel.kind)?.Inspector;
        if (Inspector === undefined) return null;
        return (
          <div data-canvas-inspector className={cn("absolute right-2 top-2 z-30 p-2", FLOAT_LAYER)}>
            <Inspector layer={sel} update={(data) => onInspectorUpdate(sel.id, data)} />
          </div>
        );
      })()}
      {/* 缩放胶囊:左下角(中央底部让位给浮动提示词栏,右下角避开宿主比例切换器)。 */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]/85 px-1 py-0.5 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="缩小" onClick={() => kernel.stage.zoomBy(0.83)}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{zoomPct}%</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="放大" onClick={() => kernel.stage.zoomBy(1.2)}>
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
  // 模型选项优先级(task 3.3,design 裁定):capability > modelOptions prop > DEFAULT。真实 agent
  // 下发的清单应胜出;prop 是测试/宿主覆盖接缝,退到 capability 之后;二者皆缺才回内置常量。
  const knownModels = capabilities?.models.map((m) => m.id) ?? modelOptions ?? DEFAULT_MODEL_OPTIONS;
  // 视觉模型清单:纯由宿主注入(agent 装配期拿不到 modelRegistry,无法经 capabilities 下发)。
  // 缺省空数组 → 选择器空态,解读仍可用(Req 3.5/3.6/5.4)。
  const visionModelItems: readonly VisionModelOption[] = visionModelOptions ?? [];
  // 复用历史参数可能带来清单外的 model:并入候选兜底(否则 Select 显示为空)。
  const modelItems =
    model !== "" && !knownModels.includes(model) ? [model, ...knownModels] : knownModels;
  // 尺寸选项:全局档位取 capability.sizes(缺失回退 RATIO_OPTIONS);当前选中模型在 capability 中
  // 声明了受支持尺寸集 → 收窄为交集(顺序按全局列表,4.3);未选模型 = 不收窄(守恒)。
  const globalSizes = capabilities?.sizes ?? RATIO_OPTIONS;
  const selectedModelSizes =
    model !== "" ? capabilities?.models.find((m) => m.id === model)?.sizes : undefined;
  const ratioOptions =
    selectedModelSizes !== undefined
      ? globalSizes.filter((r) => selectedModelSizes.includes(r.size))
      : globalSizes;
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
        {/* 降级三态呈现(Req 8.4–8.6,按 bridge.opChannel):prompt 无提示;command 呈现
            「操作不进入对话、LLM 不在环」可感知降级(生成仍经控制面旁路 surface.run 执行,
            仅不入对话流,故按钮不禁用——见 generate 回退分支与 Req 8.3 既有单测零改动);
            unavailable 沿用「surface 不可用」横幅。 */}
        {bridge.opChannel === "unavailable" ? (
          <div data-canvas-degrade="unavailable" className="text-xs text-[hsl(var(--muted-foreground))]">
            surface 不可用,仅本地工具可用
          </div>
        ) : bridge.opChannel === "command" ? (
          <div data-canvas-degrade="command" className="text-xs text-[hsl(var(--muted-foreground))]">
            操作不进入对话(LLM 不在环)
          </div>
        ) : null}
        <Popover open={refOpen} onOpenChange={setRefOpen}>
          <PopoverAnchor asChild>
            <Textarea
              data-canvas-prompt
              aria-label="修改描述提示词"
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
                    "relative aspect-square overflow-hidden rounded border transition-[opacity,border-color,box-shadow]",
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
                    <img src={a.displayUrl} alt="" width={16} height={16} className="h-4 w-4 rounded-full object-cover" />
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
                onClick={() => kernel.history.clear()}
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
            <SelectTrigger data-canvas-model aria-label="生成模型" className="h-8 w-36 text-xs">
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

          {/* 视觉模型选择器(spec canvas-vision-readout,Req 3.1/3.2/3.5)。
              ⚠ 取值是 `provider/modelId`(工具 model 参数格式),与上面**生成**模型的裸 id 不同。
              清单为空 → 展示空态说明;解读按钮**不受影响**仍可用(载荷不带 model,工具弹层兜底)。 */}
          <Select
            value={visionModel === "" ? MODEL_DEFAULT_SENTINEL : visionModel}
            onValueChange={(v) => {
              const next = v === MODEL_DEFAULT_SENTINEL ? "" : v;
              setVisionModel(next);
              writeVisionModelPref(next);
            }}
          >
            <SelectTrigger
              data-canvas-vision-model
              aria-label="视觉模型"
              className="h-8 w-40 text-xs"
            >
              <SelectValue placeholder="视觉模型" />
            </SelectTrigger>
            <SelectContent>
              {visionModelItems.length === 0 ? (
                <SelectItem value={MODEL_DEFAULT_SENTINEL} disabled>
                  没有可用的视觉模型
                </SelectItem>
              ) : (
                <>
                  <SelectItem value={MODEL_DEFAULT_SENTINEL}>每次询问</SelectItem>
                  {visionModelItems.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>

          {/* 输出尺寸(嗅探+预设比例+自定义)。 */}
          <Popover open={sizeOpen} onOpenChange={setSizeOpen}>
            <PopoverAnchor asChild>
              <button
                type="button"
                data-canvas-size-trigger
                onClick={() => setSizeOpen(true)}
                className="rounded border border-[hsl(var(--border))] px-1.5 py-1 text-[10px] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
              >
                尺寸·
                {ratioSize === ""
                  ? natural !== null
                    ? `跟随 ${natural.w}×${natural.h}`
                    : "跟随原图"
                  : (globalSizes.find((r) => r.size === ratioSize)?.label ?? ratioSize)}
              </button>
            </PopoverAnchor>
            <PopoverContent align="start" side="top" className="w-56 p-2 text-xs">
              <div className="mb-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                输出尺寸
              </div>
              <div className="flex flex-col gap-0.5">
                {ratioOptions.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    data-canvas-ratio={r.label}
                    aria-pressed={ratioSize === r.size}
                    onClick={() => {
                      setRatioSize(r.size);
                      setSizeOpen(false);
                    }}
                    className={cn(
                      "rounded px-1.5 py-1 text-left transition-colors",
                      ratioSize === r.size
                        ? "bg-[hsl(var(--accent))] font-medium"
                        : "hover:bg-[hsl(var(--muted))]",
                    )}
                  >
                    {r.size === ""
                      ? `跟随原图${natural !== null ? `(${natural.w}×${natural.h})` : ""}`
                      : `${r.label}(${r.size})`}
                  </button>
                ))}
                <div className="mt-1 flex items-center gap-1 border-t border-[hsl(var(--border))] pt-1.5">
                  <span className="text-[hsl(var(--muted-foreground))]">自定义</span>
                  <Input
                    data-canvas-size-custom-w
                    aria-label="自定义宽度(像素)"
                    inputMode="numeric"
                    value={customW}
                    onChange={(e) => setCustomW(e.target.value.replace(/\D/g, ""))}
                    placeholder="宽"
                    className="h-6 w-14 px-1 text-xs"
                  />
                  ×
                  <Input
                    data-canvas-size-custom-h
                    aria-label="自定义高度(像素)"
                    inputMode="numeric"
                    value={customH}
                    onChange={(e) => setCustomH(e.target.value.replace(/\D/g, ""))}
                    placeholder="高"
                    className="h-6 w-14 px-1 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    data-canvas-size-apply
                    disabled={customW === "" || customH === ""}
                    onClick={() => {
                      setRatioSize(`${customW}x${customH}`);
                      setSizeOpen(false);
                    }}
                  >
                    应用
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

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
          {/* 解读按钮(spec canvas-vision-readout,Req 1.1):与生成按钮并列。
              走 prompt 通道即可,**不需要** surface(生成才需 A 档命令探针),
              故清单未就绪 / 拉取失败时它仍然可用(Req 3.6/5.4)。 */}
          <Button
            variant="outline"
            size="sm"
            data-canvas-readout
            aria-label="解读"
            title="解读这张图（把输入框文字当作问题）"
            disabled={bridge.opChannel !== "prompt" || busy}
            onClick={() => void readout()}
          >
            <Eye className="mr-1 h-4 w-4" />
            解读
          </Button>
          <Button
            variant="default"
            size="sm"
            data-canvas-generate
            data-canvas-action={
              // 插件 command 胜者(task 3.4 remediation):锚值=去命名空间的插件 id、标签=插件
              // label(内置六动作走既有 decision.action/ACTION_LABEL,逐字节零变——builtin 恒
              // via:"prompt" 不进此分支)。
              previewResolved !== null && previewResolved.plugin.execution.via === "command"
                ? (previewResolved.plugin.id.split(":").pop() ?? previewResolved.plugin.id)
                : decisionPreview.action
            }
            disabled={genDisabled}
            onClick={() => void generate()}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {previewResolved !== null && previewResolved.plugin.execution.via === "command"
              ? previewResolved.plugin.label
              : ACTION_LABEL[decisionPreview.action]}
          </Button>
        </div>
      </Card>
    </div>
  );

  // 画板最大化:舞台独占 header 下全幅;版本条/工具轨/提示词栏均为舞台上的浮动层。
  return (
    <div
      data-canvas-workbench
      data-att-id={current.attachmentId}
      data-canvas-op-channel={bridge.opChannel}
      className="flex h-full min-h-0 flex-col gap-2 p-2"
    >
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
