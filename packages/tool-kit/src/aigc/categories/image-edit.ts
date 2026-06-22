/**
 * `image_edit` Category 声明 — 图像编辑(Wave 1)。
 *
 * 纯数据声明,无值导入运行时库:可从主入口安全导出(守 webpack externals 边界)。
 *
 * 两条编辑路径:
 *  - **DashScope mask-aware path**:走 multimodal-generation 端点,支持局部重绘
 *    (qwen-image-edit-max 精细度最高; qwen-image 作为低价回退)。
 *  - **OpenRouter / NewAPI 无 mask 路径**:走图像 chat completions;mask_url 通过
 *    paramOverrides 隐藏,避免用户误操作。
 *
 * inputSchema 字段:
 *  - instruction: 指令(必填,string)
 *  - image_url: 主图(必填,string,mediaKind:"image")
 *  - mask_url: 可选 B/W 遮罩(string,mediaKind:"image")
 *  - reference_image_urls: 可选参考图数组(array,items.mediaKind:"image")
 *
 * userParams: size, n
 *
 * defaultVariant: 首选可访问变体(DashScope qwen-image-edit-max;
 * 用户无 DASHSCOPE_API_KEY 时运行时降级报 missing vars)。
 */

import type { Category } from "../../engine/types.js";
import {
  createDashscopeImageEdit,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createOpenRouterImageEdit } from "../providers/openrouter.js";
import { createNewApiImageEdit } from "../providers/newapi.js";

export const imageEdit: Category = {
  name: "image_edit",
  description:
    "Edit an existing image based on a text instruction. " +
    "Supports inpainting (mask-aware) via DashScope and whole-image rewrite via OpenRouter/NewAPI. " +
    "Provide image_url and instruction; optionally provide mask_url (B/W mask, white = repaint region).",

  ui: { icon: "Wand2", label: "Image edit" },

  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description:
          "What to change. Concrete descriptions work better than abstract ones.",
        examples: [
          "把背景换成夕阳下的海滩",
          "去掉文字水印,保持背景一致",
          "将整体风格改为吉卜力动画",
          "把白天改成夜晚,加上星空",
        ],
      },
      image_url: {
        type: "string",
        description:
          "Attachment id (att_...) or URL of the image to edit. " +
          "Attachment ids are resolved to data URIs before being sent to the provider.",
        mediaKind: "image",
      },
      mask_url: {
        type: "string",
        description:
          "Optional B/W mask: white = region to redraw, black = keep. " +
          "When provided the tool runs in inpaint mode (DashScope variants only).",
        mediaKind: "image",
      },
      reference_image_urls: {
        type: "array",
        description:
          "Optional reference images for style/character consistency. " +
          "Main image + mask + reference images must total ≤ 3 (DashScope limit).",
        items: {
          type: "string",
          mediaKind: "image",
        },
        mediaKind: "image",
      },
    },
    required: ["instruction", "image_url"],
    additionalProperties: false,
  },

  userParams: [
    {
      name: "size",
      label: "Output size",
      description: "Output image resolution in WxH format.",
      type: "string",
      default: "1024*1024",
    },
    {
      name: "n",
      label: "Number of images",
      description: "How many images to generate (1–4).",
      type: "integer",
      default: 1,
      min: 1,
      max: 4,
    },
  ],

  // DashScope qwen-image-edit-max 最高质量
  defaultVariant: "qwen-image-edit-max",

  variants: [
    // ── DashScope mask-aware(局部重绘精准)──────────────────────────────────
    createDashscopeImageEdit(
      {
        name: "qwen-image-edit-max",
        label: "Qwen Image Edit Max · sync",
        description:
          "Best edit fidelity; supports mask inpainting. Needs DASHSCOPE_API_KEY.",
        model: DASHSCOPE_MODELS.qwenImageEditMax,
      },
      { pricing: { amount: 0.5, currency: "CNY", unit: "image" } },
    ),

    createDashscopeImageEdit(
      {
        name: "qwen-image-edit",
        label: "Qwen Image 2.0 Edit · sync",
        description:
          "Cheaper edit-capable fallback. Mask inpainting supported but less precise.",
        model: DASHSCOPE_MODELS.qwen20,
      },
      { pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
    ),

    // ── OpenRouter(无 mask;整图改写)──────────────────────────────────────
    createOpenRouterImageEdit(
      {
        name: "gemini-flash-image-edit",
        label: "Gemini 2.5 Flash Image · OpenRouter",
        description:
          "Gemini 2.5 Flash image editing via OpenRouter. No mask support; whole-image rewrite.",
        model: "google/gemini-2.5-flash-image",
      },
      {
        pricing: { amount: 0.039, currency: "USD", unit: "image" },
        paramOverrides: { mask_url: { hidden: true } },
      },
    ),

    createOpenRouterImageEdit(
      {
        name: "openai-gpt5-image-edit",
        label: "GPT-5 Image · OpenRouter",
        description:
          "OpenAI GPT-5 Image editing via OpenRouter. No mask; strong instruction following.",
        model: "openai/gpt-5-image",
      },
      {
        pricing: { amount: 0.03, currency: "USD", unit: "image" },
        paramOverrides: { mask_url: { hidden: true } },
      },
    ),

    // ── NewAPI(OpenAI 兼容网关;按 output_tokens 计费)────────────────────
    createNewApiImageEdit(
      {
        name: "newapi-gpt-image-2",
        label: "GPT Image 2 · NewAPI",
        description:
          "gpt-image-2 editing via self-hosted NewAPI gateway. No mask. Needs NEWAPI_API_KEY.",
        model: "gpt-image-2",
      },
      {
        pricing: { amount: 0.04, currency: "USD", unit: "image" },
        paramOverrides: {
          mask_url: { hidden: true },
          size: { hidden: true },
        },
      },
    ),
  ],
};
