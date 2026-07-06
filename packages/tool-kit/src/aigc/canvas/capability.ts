/**
 * canvas/capability — Canvas 能力清单的装配期确定性生成(canvas-actions-m2 / Req 4.1/4.7)。
 *
 * agent 权威下发:模型/尺寸/动作清单由 agent 侧生成并经 surface:canvas 快照下发(task 2.2+),
 * 使 UI 呈现的选项与 agent 真实能力一致(不再出现「16:9 选给 gpt-image 被网关拒」类失配)。
 * models 来自 {@link deriveActiveModels}(与 `publishAigcCatalog` 同一推导);provider 决定该模型
 * 受支持尺寸族;全局 sizes 三档守恒(= workbench RATIO_OPTIONS);actions 为 A 档六命令白名单。
 *
 * 返回形状与 task 2.2 将落的 `CanvasCapabilitySchema`(zod)一致,届时双向可赋值经 canvas-ui
 * 静态断言防漂移;本任务先以本地类型表达。属 runtime 层(经 active-models 间接引路由表)。
 */
import { deriveActiveModels } from "../active-models.js";
import { resolveAigcToolSettings } from "../model-config.js";

/** 单个模型的能力条目。 */
export interface CanvasCapabilityModel {
  readonly id: string;
  readonly label?: string;
  /** 该模型受支持尺寸集(缺省=不收窄,全局 sizes 全可用)。 */
  readonly sizes?: readonly string[];
}

/** 全局尺寸档位(label + 具体尺寸)。 */
export interface CanvasCapabilitySize {
  readonly label: string;
  readonly size: string;
}

/** Canvas 能力清单(可用模型 / 可用尺寸 / 支持的命令动作白名单)。 */
export interface CanvasCapability {
  readonly models: readonly CanvasCapabilityModel[];
  readonly sizes: readonly CanvasCapabilitySize[];
  readonly actions: readonly string[];
}

/** dashscope 系尺寸族(wan/qwen)。 */
const DASHSCOPE_SIZES: readonly string[] = ["1024x1024", "1280x720", "720x1280"];
/** 其余系(newapi/sufy/openrouter,gpt/gemini)尺寸族。 */
const DEFAULT_SIZES: readonly string[] = ["1024x1024", "1536x1024", "1024x1536"];

/** 全局三档 = 现 workbench RATIO_OPTIONS 守恒(模型未选时 UI 零变)。 */
const GLOBAL_SIZES: readonly CanvasCapabilitySize[] = [
  { label: "1:1", size: "1024x1024" },
  { label: "16:9", size: "1280x720" },
  { label: "9:16", size: "720x1280" },
];

/** A 档六命令白名单(register/sync/delete 为 B 档基础设施,不进白名单)。 */
const CANVAS_ACTIONS: readonly string[] = [
  "edit",
  "inpaint",
  "reference",
  "variants",
  "outpaint",
  "reframe",
];

/** provider → 尺寸族。dashscope 走竖横档,其余走方形/横竖档。 */
function sizesForProvider(provider?: string): readonly string[] {
  return provider === "dashscope" ? DASHSCOPE_SIZES : DEFAULT_SIZES;
}

/**
 * 装配期确定性生成 Canvas 能力清单。
 *  - `deps.disabledModels` 缺省 → 内部 {@link resolveAigcToolSettings} 读持久设置的被禁集合;
 *  - 读设置抛错 → 兜底「全量 catalog(空 disabled)」确定性输出,不抛、不阻塞装配(与 hydrate
 *    退化同哲学)。
 */
export function buildCanvasCapability(deps?: {
  disabledModels?: ReadonlySet<string>;
}): CanvasCapability {
  let disabled: ReadonlySet<string>;
  if (deps?.disabledModels !== undefined) {
    disabled = deps.disabledModels;
  } else {
    try {
      disabled = resolveAigcToolSettings().disabledModels;
    } catch {
      disabled = new Set<string>(); // 读设置异常 → 兜底空集(全量),确定性不阻塞
    }
  }
  const models: CanvasCapabilityModel[] = deriveActiveModels(disabled).map((e) => ({
    id: e.model,
    label: e.label,
    sizes: sizesForProvider(e.provider),
  }));
  return { models, sizes: GLOBAL_SIZES, actions: CANVAS_ACTIONS };
}
