/**
 * `image_generation` ToolSpec 声明 — 文生图(对齐 OpenAI Images `/v1/images/generations`)。
 *
 * 纯数据声明,无值导入运行时库:可从主入口安全导出(守 webpack externals 边界)。
 *
 * model 路由(本轮):
 *  - `gpt-image-2`    NewAPI(默认)—— OpenAI 兼容,经验证可用
 *  - `qwen-image-pro` DashScope sync —— 文字渲染/海报强
 *  - `wan2.6-t2i`     DashScope sync —— 写实
 *
 * 参数对齐 OpenAI Images:`prompt`(必填)+ `n`/`size`/`background`/`quality`/`moderation`;
 * 另保留 `negative_prompt`(DashScope/OpenRouter 用)。OpenAI 专属参数对非 OpenAI model
 * 由各自 buildBody 静默忽略。`model` 由编译器据 models 注入为可选枚举,不在此 inputSchema。
 */

import type { ToolSpec } from "../../engine/types.js";
import {
  createDashscopeSyncT2I,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createNewApiImage } from "../providers/newapi.js";

export const imageGeneration: ToolSpec = {
  name: "image_generation",
  label: "Text → image",
  description:
    "Generate one or more images from a text prompt. " +
    "Provide a descriptive prompt; optionally specify negative_prompt to exclude unwanted elements, " +
    "and n/size to control count and resolution. background/quality/moderation apply to OpenAI gpt-image models only. " +
    "IMPORTANT: pass `prompt` in the user's original language verbatim; do NOT translate it to English.",

  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Visual description of the desired image, in the user's original language (do NOT translate to English). " +
          "Be specific about style, subject, lighting, and composition.",
        examples: [
          "极光下的雪山，胶片质感",
          "赛博朋克城市夜景，霓虹倒影",
          "a serene mountain lake at sunrise, photorealistic, 8K",
        ],
      },
      n: {
        type: "integer",
        description:
          "Number of images to generate (1–10). Some models only support n=1.",
      },
      size: {
        type: "string",
        description:
          "Output image size, e.g. 1024x1024 / 1536x1024 / 1024x1536 (model-dependent).",
      },
      negative_prompt: {
        type: "string",
        description:
          "What to exclude from the image. Applies to DashScope/OpenRouter models.",
        examples: ["低分辨率, 模糊, 水印, 文字", "extra limbs, bad anatomy"],
      },
      background: {
        type: "string",
        enum: ["transparent", "opaque", "auto"],
        description: "Background transparency. gpt-image models only.",
      },
      quality: {
        type: "string",
        description: "Generation quality (e.g. high/medium/low/auto). OpenAI models only.",
      },
      moderation: {
        type: "string",
        enum: ["low", "auto"],
        description: "Content moderation level. gpt-image models only.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },

  defaultModel: "gpt-image-2",

  // 业务必选项:缺失时经 ctx.ui 交互补全(model/size 选择,prompt 输入)。
  requiredParams: [
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
  ],

  models: [
    // ── NewAPI(OpenAI 兼容;默认,经验证可用)──────────────────────────────────
    createNewApiImage(
      {
        model: "gpt-image-2",
        label: "GPT Image 2 · NewAPI",
        description:
          "OpenAI-compatible gpt-image generation via NewAPI gateway. Needs NEWAPI_API_KEY.",
      },
      { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
    ),

    // ── DashScope sync(multimodal-generation)──────────────────────────────────
    createDashscopeSyncT2I(
      {
        model: "qwen-image-pro",
        label: "Qwen Image 2.0 Pro · sync",
        description:
          "Best for text-in-image and posters. Highest quality DashScope sync variant. Needs DASHSCOPE_API_KEY.",
        providerModel: DASHSCOPE_MODELS.qwen20Pro,
      },
      { pricing: { amount: 0.5, currency: "CNY", unit: "image" } },
    ),

    createDashscopeSyncT2I(
      {
        model: "wan2.6-t2i",
        label: "Wan 2.6 T2I · sync",
        description:
          "Photoreal Wan 2.6 flagship via multimodal-generation. Needs DASHSCOPE_API_KEY.",
        providerModel: DASHSCOPE_MODELS.wan26T2I,
      },
      { pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
    ),
  ],
};
