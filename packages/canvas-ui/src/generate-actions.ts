/**
 * generate-actions — 六内置生成动作插件(task 3.1,Req 2.1/2.2/2.3/2.6)。
 *
 * design.md「canvas-ui · generate-actions.ts(六内置动作)」:把 canvas-workbench 内封闭的
 * `decideGenerate` if 链自举迁移为评分制动作插件(defineCanvasAction<SurfaceOp>)。评分与
 * buildArgs 逐分支复刻黄金基准(HEAD 的 decideGenerate 本体);execution 全为对话流通道
 * (via:"prompt"),buildOp 内部走既有 buildSurfaceOp(golden 锁定)。内置六动作 = 行为回归线。
 *
 * 依赖方向(design Allowed Dependencies):本模块单向引 canvas-workbench 的**类型 GenerateDecision**
 * 与**值 buildSurfaceOp**(3.2 才反向让 workbench 引本文件,本任务先单向,零循环);动作契约与
 * SurfaceOp 载荷类型自 canvas-kit / web-kit。
 *
 * mask 透传约定(buildOp 签名保持 (args, input)):调用方(workbench)在掩码上传后把 `att_` 掩码
 * id 经 `args.mask`(string)透传;buildOp 将其取作 buildSurfaceOp 的 opts.maskId 并从传给
 * buildSurfaceOp 的 decision.args 中剔除 —— 保证与现 workbench 调用
 * `buildSurfaceOp(decision, { maskId })`(decision.args 本不含 mask)逐字节等价。
 */
import { defineCanvasAction, type ActionInput, type CanvasRegistry } from "@blksails/pi-web-canvas-kit";
import type { SurfaceOp } from "@blksails/pi-web-kit";
import { buildSurfaceOp, type GenerateDecision } from "./canvas-workbench.js";

/** 内置动作 id(`builtin:` 前缀)→ GenerateDecision 动作(union 字面量保持)。 */
const ACTION_BY_ID = {
  "builtin:outpaint": "outpaint",
  "builtin:inpaint": "inpaint",
  "builtin:reference": "reference",
  "builtin:variants": "variants",
  "builtin:reframe": "reframe",
  "builtin:edit": "edit",
} satisfies Record<string, GenerateDecision["action"]>;

/**
 * 内置插件 id → {@link GenerateDecision}(action + args 透传;args 同引用不复制)。
 * 未知 id 防御性回退 edit(内置六动作恒命中映射表,回退仅为类型完备)。
 */
export function toGenerateDecision(
  pluginId: string,
  args: Record<string, unknown>,
): GenerateDecision {
  const action = (ACTION_BY_ID as Record<string, GenerateDecision["action"]>)[pluginId] ?? "edit";
  return { action, args };
}

/** 公共 base 参数(image + prompt + 非空才带 model/size);逐字复刻 decideGenerate 本体。 */
function baseArgs(input: ActionInput): Record<string, unknown> {
  const base: Record<string, unknown> = { image: input.imageId, prompt: input.prompt };
  if (input.model !== "") base.model = input.model;
  if (input.size !== "") base.size = input.size;
  return base;
}

/**
 * prompt 通道 buildOp 工厂:mask 经 args.mask 透传约定剔除后转 opts.maskId,其余 args 原样
 * 组装为 {@link GenerateDecision} 交 buildSurfaceOp(golden 锁定的参数渲染)。
 */
function makeBuildOp(id: string): (args: Record<string, unknown>) => SurfaceOp {
  return (args) => {
    const { mask, ...rest } = args;
    const maskId = typeof mask === "string" ? mask : undefined;
    return buildSurfaceOp(toGenerateDecision(id, rest), { maskId });
  };
}

// ── 六内置动作插件(评分制;buildArgs 逐分支复刻 decideGenerate)──────────────────

/** 扩图(hasExpand===true;删 size,image 由调用方替换为大画布合成图,mask 同步补充)。 */
const outpaintAction = defineCanvasAction<SurfaceOp>({
  id: "builtin:outpaint",
  label: "扩图",
  match: (input) => (input.hasExpand === true ? 100 : false),
  buildArgs: (input) => {
    const { size: _drop, ...rest } = baseArgs(input);
    void _drop;
    return rest;
  },
  execution: { via: "prompt", buildOp: makeBuildOp("builtin:outpaint") },
});

/** 局部重绘(hasMask;mask 由调用方在上传后经 args.mask 补充)。 */
const inpaintAction = defineCanvasAction<SurfaceOp>({
  id: "builtin:inpaint",
  label: "局部重绘",
  match: (input) => (input.hasMask ? 90 : false),
  buildArgs: (input) => baseArgs(input),
  execution: { via: "prompt", buildOp: makeBuildOp("builtin:inpaint") },
});

/** 融合生成(referenceIds 非空;附 reference_images,variants>=2 才附 n)。 */
const referenceAction = defineCanvasAction<SurfaceOp>({
  id: "builtin:reference",
  label: "融合生成",
  match: (input) => (input.referenceIds.length > 0 ? 80 : false),
  buildArgs: (input) => {
    const args: Record<string, unknown> = {
      ...baseArgs(input),
      reference_images: [...input.referenceIds],
    };
    if (input.variants >= 2) args.n = input.variants;
    return args;
  },
  execution: { via: "prompt", buildOp: makeBuildOp("builtin:reference") },
});

/** 生成变体(variants>=2;附 n)。 */
const variantsAction = defineCanvasAction<SurfaceOp>({
  id: "builtin:variants",
  label: "生成变体",
  match: (input) => (input.variants >= 2 ? 70 : false),
  buildArgs: (input) => ({ ...baseArgs(input), n: input.variants }),
  execution: { via: "prompt", buildOp: makeBuildOp("builtin:variants") },
});

/** 重构比例(prompt 空 && size 非空;base 原样,reframe 默认提示词由 buildSurfaceOp 补)。 */
const reframeAction = defineCanvasAction<SurfaceOp>({
  id: "builtin:reframe",
  label: "重构比例",
  match: (input) => (input.prompt.trim() === "" && input.size !== "" ? 60 : false),
  buildArgs: (input) => baseArgs(input),
  execution: { via: "prompt", buildOp: makeBuildOp("builtin:reframe") },
});

/** 整图编辑(恒适用兜底)。 */
const editAction = defineCanvasAction<SurfaceOp>({
  id: "builtin:edit",
  label: "生成",
  match: () => 10,
  buildArgs: (input) => baseArgs(input),
  execution: { via: "prompt", buildOp: makeBuildOp("builtin:edit") },
});

/**
 * 六内置生成动作(注册序 = 评分降序,便于阅读;resolveAction 按分排序,注册序仅决定同分先者
 * 与 registry.actions 枚举序)。decideGenerate 优先级链的自举复刻。
 */
export const BUILTIN_GENERATE_ACTIONS: readonly CanvasActionPluginOp[] = [
  outpaintAction,
  inpaintAction,
  referenceAction,
  variantsAction,
  reframeAction,
  editAction,
];

// 载荷类型别名(六插件的 TOp 恒为 SurfaceOp)。
type CanvasActionPluginOp = ReturnType<typeof defineCanvasAction<SurfaceOp>>;

/**
 * 六内置动作按序注册进 per-instance 注册表(registerBuiltinTools 同构);返回聚合退订。
 */
export function registerBuiltinGenerateActions(reg: CanvasRegistry): () => void {
  const unregisters = BUILTIN_GENERATE_ACTIONS.map((a) => reg.registerAction(a));
  return () => {
    for (const off of unregisters) off();
  };
}
