/**
 * `image_edit` 工具注册函数 — 图像编辑(对齐 OpenAI Images `/v1/images/edits`)。
 *
 * detoolspec-unify-builtin-tools:由原 ToolSpec 数据声明改写为 `pi.registerTool` 注册函数。
 * 手写 `parameters` + `execute` 调运行时编排器 {@link runImageTool}。
 *
 * ★ 图像入参契约(2026-07-29 起):单一 `images: string[]` —— **首项 = 待编辑主图,其余 = 参考图**。
 * 取代原先的 `image`(单数)+ `reference_images` 两个字段。`images` 与 `mask` 经 `mediaFields`
 * 在发往 provider 前由编排器逐项解析为 data URI。
 *
 * model 路由:
 *  - `gpt-image-2`               NewAPI(默认)—— OpenAI 兼容 edits(整图改写)
 *  - `gemini-3.1-flash-image-newapi` NewAPI —— Gemini 3.1 Flash,忠实编辑(保输入应用指令)
 *  - `gpt-image-2-sufy`          sufy(七牛云)—— OpenAI 兼容 edits,providerModel openai/gpt-image-2
 *  - `gemini-3.1-flash-lite-image-sufy` sufy —— Gemini 3.1 Flash Lite,忠实编辑(保输入应用指令)
 *  - `qwen-image-edit-max`       DashScope —— 最高保真,支持 mask 局部重绘
 *  - `wan2.7-image-edit-bailian` token plan multimodal —— 百炼带图编辑
 */
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  createDashscopeImageEdit,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createNewApiImageEdit, createNewApiGeminiImageEdit } from "../providers/newapi.js";
import { createSufyImageEdit } from "../providers/sufy.js";
import { createAiGatewayImageEdit } from "../providers/ai-gateway.js";
import { createCloudflareImageEdit } from "../providers/cloudflare.js";
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
  // 与 image-generation.ts 同一路由键(`-newapi` 后缀避让 OpenRouter 占用的裸键)。
  // ★同样走 Gemini 原生 relay:输入图经 contents[].parts[].inlineData 随请求提交,
  // 与文生图共用一个端点(Gemini 无独立 edits 端点)。详见 gemini-relay.ts 头注释。
  createNewApiGeminiImageEdit({
    model: "gemini-3.1-flash-image-newapi",
    label: "Gemini 3.1 Flash Image · NewAPI",
    description:
      "Google Gemini 3.1 Flash image editing via NewAPI gemini relay. " +
      "Faithful edit (keeps input, applies instruction). Slow (~170s). Needs NEWAPI_API_KEY.",
    providerModel: "gemini-3.1-flash-image",
  }),
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
  createSufyImageEdit(
    {
      model: "gemini-3.1-flash-lite-image-sufy",
      label: "Gemini 3.1 Flash Lite Image · sufy",
      description:
        "Google Gemini 3.1 Flash Lite image editing via sufy (七牛云) gateway. Faithful edit (keeps input, applies instruction). Fast & low-cost. Needs SUFY_API_KEY.",
      providerModel: "google/gemini-3.1-flash-lite-image",
    },
    { pricing: { amount: 0.01, currency: "USD", unit: "image" } },
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
  // `images` 是**数组**字段:编排器的 mediaFields 解析支持 string | string[],逐项解析为 data URI。
  // 取代原先的 "image" + "reference_images" 两个字段(首项主图、其余参考图)。
  "images",
  "mask",
];

/**
 * ai-gateway 图像编辑路由组(spec ai-gateway-providers,design.md §3,Req 5.2)——第一期
 * 静态声明,与 `AI_GATEWAY_IMAGE_ROUTES`(image-generation.ts)同一批网关已配模型。**不**
 * 并入 `ROUTES`/`IMAGE_EDIT_ROUTES`(那两者始终无条件注册);由 runtime 层 `extension.ts`
 * 按网关 base URL env 存在与否决定是否经 `registerImageEdit` 的
 * `opts.extraRoutes` 并入,未启用套件时行为与今天逐字节一致(Req 5.3)。
 */
export const AI_GATEWAY_IMAGE_EDIT_ROUTES: readonly ImageRoute[] = [
  createAiGatewayImageEdit(
    {
      model: "gpt-image-1",
      label: "GPT Image 1 · Cloudflare compat",
      description: "OpenAI gpt-image-1 editing via ai-gateway. Needs BLKSAILS_GATEWAY_API_KEY.",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createAiGatewayImageEdit(
    {
      model: "gpt-image-2",
      label: "GPT Image 2 · Cloudflare compat",
      description: "OpenAI gpt-image-2 editing via ai-gateway. Needs BLKSAILS_GATEWAY_API_KEY.",
      providerModel: "gpt-image-2",
    },
    { model: "gpt-image-2-ai-gateway", pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createAiGatewayImageEdit(
    {
      model: "qwen-image",
      label: "Qwen Image · Cloudflare compat",
      description: "Qwen image editing via ai-gateway. Needs BLKSAILS_GATEWAY_API_KEY.",
    },
    { pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
  ),
];

/**
 * Cloudflare AI Gateway 图像编辑路由组(spec cloudflare-aigc-provider,Req 2.1/2.4)。
 *
 * 与 `CLOUDFLARE_IMAGE_ROUTES`(image-generation.ts)同一批已真机验证的模型;同样**不**
 * 并入 `ROUTES`/`IMAGE_EDIT_ROUTES`,由 runtime 层按 `CLOUDFLARE_*` 三 env 条件并入。
 *
 * ★ 仅纳入**真机确认支持编辑**的模型(Req 2.4)。文生图组有 8 个模型,但编辑组只有 2 个
 * ——CF 文档指向 OpenAI 系支持编辑,且这两个已实测经 `input.images` 数组正确编辑(保原图
 * 构图、按指令修改)。其余(imagen-4 / nano-banana / flux 等)未验证编辑语义,故不提供,
 * 避免用户选中后拿到一张与参考图无关的新图。
 */
export const CLOUDFLARE_IMAGE_EDIT_ROUTES: readonly ImageRoute[] = [
  createCloudflareImageEdit(
    {
      model: "gpt-image-2-cf",
      label: "GPT Image 2 · Cloudflare",
      description:
        "OpenAI gpt-image-2 editing via Cloudflare AI Gateway (unified billing — no OpenAI key needed). " +
        "Needs CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AIG_GATEWAY_ID / CLOUDFLARE_API_TOKEN.",
      providerModel: "openai/gpt-image-2",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
  createCloudflareImageEdit(
    {
      model: "gpt-image-1.5-cf",
      label: "GPT Image 1.5 · Cloudflare",
      description: "OpenAI gpt-image-1.5 editing via Cloudflare AI Gateway. Supports transparent PNG.",
      providerModel: "openai/gpt-image-1.5",
    },
    { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
  ),
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
  "Pass `images` (first item = the image to edit, any further items = reference images) and `prompt`; " +
  "optionally provide mask (B/W, white = repaint region). " +
  "IMPORTANT: pass `prompt` in the user's original language verbatim; do NOT translate it to English.";

const PARAMETER_FIELDS = {
  /**
   * 单一图像入参(取代原先的 `image` + `reference_images` 两个字段)。
   *
   * 首项 = 待编辑的主图;其余为可选的参考图(风格/角色一致性)。这样与各 provider 的实际
   * 协议更贴近 —— Cloudflare 的 `input.images`、Gemini relay 的 `contents[].parts[]`、
   * OpenRouter 的多图消息本就是**一个有序图像序列**,拆成「主图 + 参考图」两个字段反而
   * 要在每个 provider 里再拼回去。只接受单图的 provider(如 DashScope 编辑)取首项、
   * 其余按其协议当参考图处理。
   */
  images: Type.Array(
    Type.String({
      description: "Attachment id (att_...) or URL.",
    }),
    {
      minItems: 1,
      description:
        "Images for the edit, in order: the FIRST item is the image being edited; " +
        "any additional items are reference images for style/character consistency. " +
        "Attachment ids are resolved to data URIs before being sent to the provider. " +
        "No fixed local limit on count — the accepted number is decided by the provider/model, " +
        "and exceeding it surfaces as an upstream error.",
    },
  ),
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
  // `reference_images` 已并入上方的 `images` 数组(首项主图、其余参考图),不再单列。
  // 原本还有一句「DashScope 总图 ≤ 3」被误写成全局约束、导致 LLM 对任何模型都自我设限,
  // 该上限连同 dashscope.ts 的硬校验早已移除:本地不设限,张数由各 provider 端裁定。
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
  // extraRoutes(Req 5.2/5.3):同 image-generation.ts,runtime 层按 env 条件传入。
  const allRoutes: readonly ImageRoute[] =
    opts?.extraRoutes !== undefined ? [...ROUTES, ...opts.extraRoutes] : ROUTES;
  const activeRoutes = filterRoutes(allRoutes, opts?.disabledModels ?? EMPTY_DISABLED, DEFAULT_MODEL);
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
        mediaFields: IMAGE_EDIT_MEDIA_FIELDS,
      });
    },
  });
}
