/**
 * `image_generation` 工具注册函数 — 文生图(对齐 OpenAI Images `/v1/images/generations`)。
 *
 * detoolspec-unify-builtin-tools:由原 ToolSpec 数据声明改写为 `pi.registerTool` 注册函数。
 * 手写 `parameters`(Type.Object)+ `execute` 调运行时编排器 {@link runImageTool}。
 * 属 **runtime 层**(含 pi SDK 值导入),仅经 `@blksails/pi-web-tool-kit/runtime` 间接加载。
 *
 * model 路由:
 *  - `gpt-image-2`               NewAPI(默认)—— OpenAI 兼容
 *  - `gpt-image-2-sufy`          sufy(七牛云)—— OpenAI 兼容,providerModel openai/gpt-image-2
 *  - `gemini-3.1-flash-lite-image-sufy` sufy —— Gemini 3.1 Flash Lite,providerModel google/gemini-3.1-flash-lite-image
 *  - `wan2.7-image-pro`          DashScope sync —— 旗舰文生图
 *  - `wan2.7-image-pro-bailian`  token plan multimodal —— 百炼原生格式
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  createDashscopeSyncT2I,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createNewApiImage } from "../providers/newapi.js";
import { createSufyImage } from "../providers/sufy.js";
import { createAiGatewayImage } from "../providers/ai-gateway.js";
import { openRouterImageRoutes } from "../providers/openrouter-models.js";
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

// token plan(阿里云百炼)multimodal-generation 端点 —— 复用 DashScope 原生 input/parameters,
// 末端 url 切换到 token plan 域(curl 实测路径;compatible-mode 报 url error)。base 经
// DASHSCOPE_TOKENPLAN_BASE_URL 可配。token plan key 对官方 dashscope 无效,故打 token plan 末端。
const TOKEN_PLAN_MULTIMODAL_URL =
  "${DASHSCOPE_TOKENPLAN_BASE_URL:-https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1}/services/aigc/multimodal-generation/generation";

const DEFAULT_MODEL = "gpt-image-2";

const ROUTES: readonly ImageRoute[] = [
  createNewApiImage(
    {
      model: "gpt-image-2",
      label: "GPT Image 2 · NewAPI",
      description:
        "OpenAI-compatible gpt-image generation via NewAPI gateway. Needs NEWAPI_API_KEY.",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createSufyImage(
    {
      model: "gpt-image-2-sufy",
      label: "GPT Image 2 · sufy",
      description:
        "OpenAI-compatible gpt-image generation via sufy (七牛云) gateway. Needs SUFY_API_KEY.",
      providerModel: "openai/gpt-image-2",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createSufyImage(
    {
      model: "gemini-3.1-flash-lite-image-sufy",
      label: "Gemini 3.1 Flash Lite Image · sufy",
      description:
        "Google Gemini 3.1 Flash Lite image generation via sufy (七牛云) gateway. Fast & low-cost. Needs SUFY_API_KEY.",
      providerModel: "google/gemini-3.1-flash-lite-image",
    },
    { pricing: { amount: 0.01, currency: "USD", unit: "image" } },
  ),
  ...openRouterImageRoutes(),
  createDashscopeSyncT2I(
    {
      model: "wan2.7-image-pro",
      label: "Wan 2.7 Image Pro",
      description:
        "Wan 2.7 旗舰文生图（multimodal-generation, sync; 10–30s）, Needs DASHSCOPE_API_KEY.",
      providerModel: DASHSCOPE_MODELS.wan27ImagePro,
    },
    { pricing: { amount: 0.5, currency: "CNY", unit: "image" } },
  ),
  createDashscopeSyncT2I(
    {
      model: "wan2.7-image-pro-bailian",
      label: "Wan 2.7 Image Pro · token plan",
      description:
        "Wan 2.7 Image Pro via token plan multimodal-generation (DashScope 原生 input/parameters). " +
        "Needs DASHSCOPE_API_KEY(token plan key); 端点经 DASHSCOPE_TOKENPLAN_BASE_URL 可配。",
      providerModel: DASHSCOPE_MODELS.wan27ImagePro,
    },
    { url: TOKEN_PLAN_MULTIMODAL_URL, pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
  ),
];

// 业务必选项:缺失时经 ctx.ui 交互补全(model/size 选择,prompt 输入)。
const REQUIRED_PARAMS: readonly InteractionParam[] = [
  { param: "model", via: "select", title: "选择生成模型", options: ["$models"] },
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
    title: "输入图像描述",
    placeholder: "用你的语言描述想要的图像(不会被翻译)",
  },
];

const BASE_DESCRIPTION =
  "Generate one or more images from a text prompt. " +
  "Provide a descriptive prompt; optionally specify negative_prompt to exclude unwanted elements, " +
  "and n/size to control count and resolution. background/quality/moderation apply to OpenAI gpt-image models only. " +
  "IMPORTANT: pass `prompt` in the user's original language verbatim; do NOT translate it to English.";

const PARAMETER_FIELDS = {
  prompt: Type.String({
    description:
      "Visual description of the desired image, in the user's original language (do NOT translate to English). " +
      "Be specific about style, subject, lighting, and composition.",
  }),
  n: Type.Optional(
    Type.Integer({ description: "Number of images to generate (1–10). Some models only support n=1." }),
  ),
  size: Type.Optional(
    Type.String({
      description:
        "Output image size, e.g. 1024x1024 / 1280x720 / 720x1280 (model-dependent). " +
        "OMIT unless the user explicitly requests a specific size or aspect ratio in the conversation — " +
        "when omitted, the user's preferred size (set in the UI) or the model default applies. " +
        "Do NOT infer a size from the subject matter.",
    }),
  ),
  negative_prompt: Type.Optional(
    Type.String({ description: "What to exclude from the image. Applies to DashScope/OpenRouter models." }),
  ),
  background: Type.Optional(
    Type.Union([Type.Literal("transparent"), Type.Literal("opaque"), Type.Literal("auto")], {
      description: "Background transparency. gpt-image models only.",
    }),
  ),
  quality: Type.Optional(
    Type.String({ description: "Generation quality (e.g. high/medium/low/auto). OpenAI models only." }),
  ),
  moderation: Type.Optional(
    Type.Union([Type.Literal("low"), Type.Literal("auto")], {
      description: "Content moderation level. gpt-image models only.",
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
 * 生成工具路由表/默认模型导出(aigc-prompt-toolbar:装配期清单下发取 gen∪edit 并集;
 * 与 image-edit.ts 的 IMAGE_EDIT_ROUTES 同款形态)。
 */
export const IMAGE_GENERATION_ROUTES: readonly ImageRoute[] = ROUTES;
export const IMAGE_GENERATION_DEFAULT_MODEL = DEFAULT_MODEL;

/**
 * ai-gateway 文生图路由组(spec ai-gateway-providers,design.md §3,Req 5.2)——第一期
 * 静态声明,覆盖网关已配的代表性模型。**不**并入 `ROUTES`/`IMAGE_GENERATION_ROUTES`
 * (那两者始终无条件注册);本组由 runtime 层 `extension.ts` 按
 * `process.env.AI_GATEWAY_BASE_URL` 存在与否决定是否经 `registerImageGeneration` 的
 * `opts.extraRoutes` 并入,未启用套件时图像工具的模型枚举与行为与今天逐字节一致(Req 5.3)。
 */
export const AI_GATEWAY_IMAGE_ROUTES: readonly ImageRoute[] = [
  createAiGatewayImage(
    {
      model: "gpt-image-1",
      label: "GPT Image 1 · ai-gateway",
      description: "OpenAI gpt-image-1 generation via ai-gateway. Needs AI_GATEWAY_API_KEY.",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createAiGatewayImage(
    {
      model: "gpt-image-2",
      label: "GPT Image 2 · ai-gateway",
      description: "OpenAI gpt-image-2 generation via ai-gateway. Needs AI_GATEWAY_API_KEY.",
      providerModel: "gpt-image-2",
    },
    { model: "gpt-image-2-ai-gateway", pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createAiGatewayImage(
    {
      model: "qwen-image",
      label: "Qwen Image · ai-gateway",
      description: "Qwen text-to-image generation via ai-gateway. Needs AI_GATEWAY_API_KEY.",
    },
    { pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
  ),
];

/**
 * 注册 `image_generation` 工具到给定的 pi 扩展上下文。
 * `opts.disabledModels`(aigc-tool-settings):装配期被禁模型集合——被禁模型从 LLM 可见 model
 * 枚举、工具描述与运行时路由集**同源移除**;缺省时行为与既有一致(全量)。
 */
export function registerImageGeneration(
  pi: ExtensionAPI,
  opts?: RegisterImageToolOptions,
): void {
  // extraRoutes(Req 5.2/5.3):runtime 层按 env 条件传入(如 AI_GATEWAY_IMAGE_ROUTES),
  // 与内置 ROUTES 拼接后统一走 filterRoutes(Req 5.4:disabledModels 对两套 provider
  // 统一生效);未传入(套件未启用)时行为与今天逐字节一致。
  const allRoutes: readonly ImageRoute[] =
    opts?.extraRoutes !== undefined ? [...ROUTES, ...opts.extraRoutes] : ROUTES;
  const activeRoutes = filterRoutes(allRoutes, opts?.disabledModels ?? EMPTY_DISABLED, DEFAULT_MODEL);
  pi.registerTool({
    name: "image_generation",
    label: "Text → image",
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
        toolName: "image_generation",
        routes: activeRoutes,
        defaultModel: DEFAULT_MODEL,
        requiredParams: REQUIRED_PARAMS,
        mediaFields: [],
      });
    },
  });
}
