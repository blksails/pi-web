/**
 * vision 模型候选、交互选择与降级链。
 *
 * 候选 = `registry.getAvailable()` ∩ `input` 含 `"image"`。
 * - `getAvailable()` 本身即 `models.filter(hasConfiguredAuth)`,恰好满足「凭据可用」(2.2);
 *   **不得**改用 `getAll()`,否则会把用户选不了的模型列进弹层。
 * - 无任何静态清单 ⇒ 用户在 `models.json` 新增支持图像输入的模型即自动可选(2.3)。
 *
 * 选择顺序:
 *  1. 有 UI 且未显式指定 → `ctx.ui.select`(取消 ⇒ `cancelled`)
 *  2. 显式指定 → 校验在候选中(否则 `unknown_model`)
 *  3. 无 UI → 显式模型 → env 默认模型(须在候选中)→ 候选首个 → `no_vision_model`
 *
 * `ExtensionUIContext.select` 返回**选中的字符串本身**(非索引),故维护 label → model 反查。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionUIContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describeError, fail } from "./errors.js";
import type { VisionFail } from "./types.js";

/** 模型的规范标识:`provider/modelId`(与 auto-title 的模型解析形态一致)。 */
export function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

/** 弹层里展示的标签;以 `provider/id` 打头保证唯一可反查。 */
function modelLabel(model: Model<Api>): string {
  return model.name.length > 0 ? `${modelKey(model)} — ${model.name}` : modelKey(model);
}

/**
 * 候选视觉模型:凭据可用(`getAvailable`)且声明支持图像输入(`input` 含 `"image"`)。
 */
export function listVisionModels(registry: ModelRegistry): Model<Api>[] {
  return registry.getAvailable().filter((m) => m.input.includes("image"));
}

export interface SelectModelInput {
  /** 调用方显式指定的模型(`provider/modelId`);未指定为 `undefined`。 */
  readonly requested: string | undefined;
  readonly registry: ModelRegistry;
  /** `hasUI === false` 时为 `undefined`,且本模块保证绝不触碰。 */
  readonly ui: ExtensionUIContext | undefined;
  readonly hasUI: boolean;
  /** env 默认模型(`provider/modelId`);仅在无 UI 分支参与降级。 */
  readonly defaultModel: string | undefined;
}

/** 在候选中按 `provider/modelId` 查找。 */
function findByKey(models: readonly Model<Api>[], key: string): Model<Api> | undefined {
  return models.find((m) => modelKey(m) === key);
}

/**
 * 选出本次识别所用模型。
 *
 * 后置:返回的 `Model` 必属候选清单;失败 reason ∈
 * `{ no_vision_model, unknown_model, cancelled }`。
 * 不变式:`hasUI === false` 时**绝不**调用 `ui.select`(4.1)。
 */
export async function selectVisionModel(
  input: SelectModelInput,
): Promise<Model<Api> | VisionFail> {
  const { requested, registry, ui, hasUI, defaultModel } = input;

  const candidates = listVisionModels(registry);
  if (candidates.length === 0) {
    return fail("no_vision_model", "没有支持图像输入且凭据可用的模型");
  }

  // 显式指定优先于一切:命中即用,不命中即失败(不静默回退,3.4)。
  if (requested !== undefined && requested.length > 0) {
    const hit = findByKey(candidates, requested);
    if (hit === undefined) {
      return fail("unknown_model", `模型 ${requested} 不在可用视觉模型清单中`);
    }
    return hit;
  }

  // 交互式选择(3.1);仅在 UI 可用时。
  if (hasUI && ui !== undefined) {
    const labels = candidates.map(modelLabel);
    let picked: string | undefined;
    try {
      picked = await ui.select("用哪个模型看这张图？", labels);
    } catch (err) {
      return fail("cancelled", describeError(err));
    }
    if (picked === undefined) return fail("cancelled", "用户取消了模型选择");
    const idx = labels.indexOf(picked);
    const hit = idx >= 0 ? candidates[idx] : undefined;
    if (hit === undefined) {
      // 选择器返回了非候选字符串:按取消处理,不猜测用户意图。
      return fail("cancelled", "选择结果无法对应到候选模型");
    }
    return hit;
  }

  // 无 UI 降级(4.3 → 4.4):env 默认模型须在候选中,否则退到候选首个。
  if (defaultModel !== undefined && defaultModel.length > 0) {
    const hit = findByKey(candidates, defaultModel);
    if (hit !== undefined) return hit;
  }
  return candidates[0] as Model<Api>;
}
