/**
 * `image_edit` 工具注册函数 — 图像编辑(对齐 OpenAI Images `/v1/images/edits`)。
 *
 * detoolspec-unify-builtin-tools:由原 ToolSpec 数据声明改写为 `pi.registerTool` 注册函数。
 * 手写 `parameters` + `execute` 调运行时编排器 {@link runImageTool}。`image`/`mask`/
 * `reference_images` 经 `mediaFields` 在发往 provider 前由编排器解析为 data URI。
 *
 * model 路由:
 *  - `gpt-image-2`               NewAPI(默认)—— OpenAI 兼容 edits(整图改写)
 *  - `gpt-image-2-sufy`          sufy(七牛云)—— OpenAI 兼容 edits,providerModel openai/gpt-image-2
 *  - `qwen-image-edit-max`       DashScope —— 最高保真,支持 mask 局部重绘
 *  - `wan2.7-image-edit-bailian` token plan multimodal —— 百炼带图编辑
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  createDashscopeImageEdit,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createNewApiImageEdit } from "../providers/newapi.js";
import { createSufyImageEdit } from "../providers/sufy.js";
import { openRouterImageEditRoutes } from "../providers/openrouter-models.js";
import {
  runImageTool,
  buildModelsDescription,
  optionalModelEnum,
} from "../run-image-tool.js";
import type { ImageRoute, InteractionParam, ToolExecuteDetails } from "../types.js";
import {
  filterRoutes,
  EMPTY_DISABLED,
  type RegisterImageToolOptions,
} from "../model-config.js";

// token plan(阿里云百炼)图像编辑 —— 走 DashScope 原生 messages/content + 同一 multimodal 端点。
const TOKEN_PLAN_MULTIMODAL_URL =
  "${DASHSCOPE_TOKENPLAN_BASE_URL:-https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1}/services/aigc/multimodal-generation/generation";

const DEFAULT_MODEL = "gpt-image-2";

const ROUTES: readonly ImageRoute[] = [
  createNewApiImageEdit(
    {
      model: "gpt-image-2",
      label: "GPT Image 2 · NewAPI",
      description:
        "OpenAI-compatible gpt-image editing via NewAPI gateway. Whole-image rewrite. Needs NEWAPI_API_KEY.",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createSufyImageEdit(
    {
      model: "gpt-image-2-sufy",
      label: "GPT Image 2 · sufy",
      description:
        "OpenAI-compatible gpt-image editing via sufy (七牛云) gateway. Whole-image rewrite. Needs SUFY_API_KEY.",
      providerModel: "openai/gpt-image-2",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  ...openRouterImageEditRoutes(),
  createDashscopeImageEdit(
    {
      model: "qwen-image-edit-max",
      label: "Qwen Image Edit Max · sync",
      description:
        "Best edit fidelity; supports mask inpainting and reference images. Needs DASHSCOPE_API_KEY.",
      providerModel: DASHSCOPE_MODELS.qwenImageEditMax,
    },
    { pricing: { amount: 0.5, currency: "CNY", unit: "image" } },
  ),
  createDashscopeImageEdit(
    {
      model: "wan2.7-image-edit-bailian",
      label: "Wan 2.7 Image Edit · token plan",
      description:
        "Wan 2.7 Image Pro 带图编辑 via token plan multimodal-generation (DashScope 原生 messages/content). " +
        "Needs DASHSCOPE_API_KEY(token plan key); 端点经 DASHSCOPE_TOKENPLAN_BASE_URL 可配。",
      providerModel: DASHSCOPE_MODELS.wan27ImagePro,
    },
    { url: TOKEN_PLAN_MULTIMODAL_URL, pricing: { amount: 0.3, currency: "CNY", unit: "image" } },
  ),
];

/**
 * `image_edit` 的 model 路由表 / 默认 model / 媒体字段(供 aigc-canvas A 档命令处理器复用,
 * 经 AAS 命令通道在子进程内直调 {@link runImageTool},保 provider/models.json 独立性)。
 */
export const IMAGE_EDIT_ROUTES: readonly ImageRoute[] = ROUTES;
export const IMAGE_EDIT_DEFAULT_MODEL = DEFAULT_MODEL;
export const IMAGE_EDIT_MEDIA_FIELDS: readonly string[] = [
  "image",
  "mask",
  "reference_images",
];

const REQUIRED_PARAMS: readonly InteractionParam[] = [
  { param: "model", via: "select", title: "选择编辑模型", options: ["$models"] },
  {
    param: "size",
    via: "select",
    title: "选择输出尺寸",
    options: ["1024x1024", "1536x1024", "1024x1536", "auto"],
    fallback: "auto",
  },
  {
    param: "prompt",
    via: "input",
    title: "输入编辑指令",
    placeholder: "用你的语言描述要做的修改(不会被翻译)",
  },
];

const BASE_DESCRIPTION =
  "Edit an existing image based on a text prompt. " +
  "Supports inpainting (mask-aware) via DashScope and whole-image rewrite via NewAPI. " +
  "Provide image and prompt; optionally provide mask (B/W, white = repaint region) and reference_images. " +
  "IMPORTANT: pass `prompt` in the user's original language verbatim; do NOT translate it to English.";

const PARAMETER_FIELDS = {
  image: Type.String({
    description:
      "Attachment id (att_...) or URL of the image to edit. " +
      "Attachment ids are resolved to data URIs before being sent to the provider.",
  }),
  prompt: Type.String({
    description:
      "What to change, in the user's original language (do NOT translate to English). " +
      "Concrete descriptions work better than abstract ones.",
  }),
  mask: Type.Optional(
    Type.String({
      description:
        "Optional B/W mask: white = region to redraw, black = keep. " +
        "When provided the edit runs in inpaint mode (DashScope models).",
    }),
  ),
  n: Type.Optional(Type.Integer({ description: "Number of images to generate (1–10)." })),
  size: Type.Optional(
    Type.String({
      description:
        "Output image size, e.g. 1024x1024 (model-dependent). " +
        "OMIT unless the user explicitly requests a specific size or aspect ratio in the conversation — " +
        "when omitted, the user's preferred size (set in the UI) or the model default applies. " +
        "Do NOT infer a size from the subject matter.",
    }),
  ),
  reference_images: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional reference images for style/character consistency. " +
        "Main image + mask + reference images must total ≤ 3 (DashScope limit).",
    }),
  ),
  response_format: Type.Optional(
    Type.Union([Type.Literal("url"), Type.Literal("b64_json")], {
      description: "Output format. OpenAI models only.",
    }),
  ),
};

/** 按活跃路由现建工具 parameters(model 枚举随过滤收敛,aigc-tool-settings)。 */
function buildParameters(routes: readonly ImageRoute[]) {
  return Type.Object({
    ...PARAMETER_FIELDS,
    model: optionalModelEnum(routes, DEFAULT_MODEL),
  });
}

/**
 * 注册 `image_edit` 工具到给定的 pi 扩展上下文。
 * `opts.disabledModels`(aigc-tool-settings):装配期被禁模型集合——同源从枚举/描述/路由集移除;
 * 缺省时行为与既有一致(全量)。
 */
export function registerImageEdit(pi: ExtensionAPI, opts?: RegisterImageToolOptions): void {
  const activeRoutes = filterRoutes(ROUTES, opts?.disabledModels ?? EMPTY_DISABLED, DEFAULT_MODEL);
  pi.registerTool({
    name: "image_edit",
    label: "Image edit",
    description: buildModelsDescription(BASE_DESCRIPTION, activeRoutes, DEFAULT_MODEL),
    parameters: buildParameters(activeRoutes),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      const emit =
        typeof onUpdate === "function"
          ? (onUpdate as (p: AgentToolResult<ToolExecuteDetails>) => void)
          : undefined;
      return runImageTool(params, ctx, signal, emit, {
        toolName: "image_edit",
        routes: activeRoutes,
        defaultModel: DEFAULT_MODEL,
        requiredParams: REQUIRED_PARAMS,
        mediaFields: ["image", "mask", "reference_images"],
      });
    },
  });
}
