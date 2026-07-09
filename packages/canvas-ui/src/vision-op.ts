/**
 * vision-op — Canvas「解读」按钮的对话通道载荷构造器(spec canvas-vision-readout)。
 *
 * 把「当前工作图 + 问题 + 可选视觉模型」组装成一个 `tool: image_vision` 的 {@link SurfaceOp},
 * 由 `bridge.submitOp` 经 `renderSurfaceOp` 渲染为**用户消息**发进对话流,LLM 据此调用
 * 已实现的 `image_vision` 工具(spec image-vision-tool)。结论因此天然回流对话记录:
 * 可回放、可追问、进 LLM 上下文。
 *
 * 设计要点:
 * - **刻意不复用 `buildSurfaceOp`**:二者 tool 行语义、参数集合、可选项规则完全不同;
 *   强行抽象会把 `generate-actions.test.ts` 的决策守恒线(逐字节断言生成载荷)拖下水。
 * - **tool 行必须内嵌中文指令**:agent 的 systemPrompt **没有**教 LLM 解析 `canvas-op` 围栏,
 *   理解完全依赖 tool 行里的「请直接按下列参数调用,勿追问」(与 `buildSurfaceOp:314` 同形态)。
 *   去掉它,LLM 很可能复述参数而不调用工具。
 * - **`model` 为空时省略该参数行**:`renderSurfaceOp` 跳过空值(surface-op.ts:62),
 *   工具收不到 model 即弹选择层(image-vision-tool Req 3.1);收到则直接用(Req 3.2)。
 * - `model` 的取值是 **`provider/modelId`**(与工具 `model` 参数、`modelKey()` 对齐),
 *   ⚠ 与提示词栏既有「生成模型」选择器的**裸 id** 格式不同,不可混用。
 *
 * 纯函数:零 React、零 I/O、同输入恒同输出。
 */
import type { SurfaceOp } from "@blksails/pi-web-kit";

/** 输入框为空时使用的默认提问(Req 1.3)。 */
export const DEFAULT_READOUT_QUESTION = "描述这张图片的内容。";

/** 标题中意图摘要的最大长度(与 `buildSurfaceOp` 的 48 字截断同规)。 */
const INTENT_MAX = 48;

/**
 * 视觉模型选项。
 *
 * `value` 是 **`provider/modelId`**(工具 `model` 参数的格式);`label` 供展示。
 */
export interface VisionModelOption {
  readonly value: string;
  readonly label: string;
  readonly provider: string;
}

export interface BuildVisionOpInput {
  /** 当前工作图的附件 id(`att_…`)。 */
  readonly imageId: string;
  /** 用户问题;空串 / 全空白 → 使用 {@link DEFAULT_READOUT_QUESTION}。 */
  readonly question: string;
  /** `provider/modelId`;省略 / 空串 → 载荷不带 `model` 行,由工具弹层选择。 */
  readonly model?: string;
}

/** 标题的意图摘要:超长截断,空则不附。 */
function summarizeIntent(question: string): string {
  const q = question.trim();
  if (q === "") return "";
  return q.length > INTENT_MAX ? `${q.slice(0, INTENT_MAX)}…` : q;
}

/**
 * 构造 `image_vision` 的对话通道载荷。
 *
 * 后置:`params` 顺序恒为 `image → question → model?`;`fence` 恒为 `"canvas-op"`;
 * `model` 为空时结果中**不出现** `model` 项。
 */
export function buildVisionOp(input: BuildVisionOpInput): SurfaceOp {
  const question = input.question.trim() === "" ? DEFAULT_READOUT_QUESTION : input.question;

  const params: Array<readonly [string, string]> = [
    ["image", input.imageId],
    ["question", question],
  ];
  // 空 model 不产生参数行 —— 把「是否弹层」的决策权完整交回工具。
  if (typeof input.model === "string" && input.model.trim() !== "") {
    params.push(["model", input.model]);
  }

  const intent = summarizeIntent(question);
  return {
    title: intent !== "" ? `👁 解读 · ${intent}` : "👁 解读",
    tool: "image_vision(请直接按下列参数调用,勿追问、勿复述参数)",
    params,
    fence: "canvas-op",
  };
}

/**
 * 拉取可用视觉模型清单(Req 3.1/3.6)。
 *
 * **任何失败(无 baseUrl / 网络 / 非 2xx / 解析异常 / 形状不符)都返回空数组**,
 * 既不抛也不阻断解读 —— 空清单时载荷不带 `model`,由 `image_vision` 工具弹层兜底。
 *
 * 抽成纯异步函数(而非埋在 hook 里)使其可直接单测 fetch 的四条分支。
 */
export async function fetchVisionModels(
  baseUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly VisionModelOption[]> {
  if (baseUrl === undefined || baseUrl === "") return [];
  try {
    const res = await fetchImpl(`${baseUrl}/vision/models`);
    if (!res.ok) return [];
    const body = (await res.json()) as { models?: unknown };
    if (!Array.isArray(body.models)) return [];
    return body.models.filter(
      (m): m is VisionModelOption =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as VisionModelOption).value === "string" &&
        typeof (m as VisionModelOption).label === "string",
    );
  } catch {
    return [];
  }
}
