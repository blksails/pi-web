/**
 * `text_to_image` Category 声明 — 文生图(Wave 1)。
 *
 * 纯数据声明,无值导入运行时库:可从主入口安全导出(守 webpack externals 边界)。
 *
 * Wave 1 提供 DashScope 两类变体:
 *  - async wanx-turbo: Wanx 2.0 Turbo(最便宜,~30–60s,适合迭代)
 *  - sync qwen-image:  Qwen Image 2.0(同步 10–30s,文字渲染/海报强)
 *
 * userParams(面板参数,Wave 1 仅用其 default 作参数兜底):
 *  - size:  生成尺寸,默认 "1024*1024"
 *  - n:     生成张数,默认 1(最多 4)
 */

import type { Category } from "../../engine/types.js";
import {
  createDashscopeAsyncT2I,
  createDashscopeSyncT2I,
  DASHSCOPE_MODELS,
} from "../providers/dashscope.js";
import { createOpenRouterImage } from "../providers/openrouter.js";
import { createNewApiImage } from "../providers/newapi.js";

export const textToImage: Category = {
  name: "text_to_image",
  description:
    "Generate one or more images from a text prompt. " +
    "Supports DashScope Wanx async (cheapest, 30–60s) and sync multimodal variants. " +
    "Provide a descriptive prompt; optionally specify a negative_prompt to exclude unwanted elements.",

  ui: { icon: "ImagePlus", label: "Text → image" },

  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Visual description of the desired image (English or Chinese, ≤500 chars). " +
          "Be specific about style, subject, lighting, and composition.",
        examples: [
          "极光下的雪山，胶片质感",
          "赛博朋克城市夜景，霓虹倒影",
          "a serene mountain lake at sunrise, photorealistic, 8K",
        ],
      },
      negative_prompt: {
        type: "string",
        description:
          "What to exclude from the image (styles, objects, artifacts). Optional.",
        examples: ["低分辨率, 模糊, 水印, 文字", "extra limbs, bad anatomy"],
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },

  userParams: [
    {
      name: "size",
      label: "Resolution",
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

  defaultVariant: "wanx-turbo",

  variants: [
    // ── DashScope async (Wanx) ────────────────────────────────────────────────
    createDashscopeAsyncT2I(
      {
        name: "wanx-turbo",
        label: "Wanx 2.0 Turbo · async · ~30–60s",
        model: DASHSCOPE_MODELS.wanx20T2I,
        description:
          "Cheapest DashScope text2image (async polling). Best for iteration. Needs DASHSCOPE_API_KEY.",
      },
      { pricing: { amount: 0.04, currency: "CNY", unit: "image" } },
    ),

    createDashscopeAsyncT2I(
      {
        name: "wanx2.1-turbo",
        label: "Wanx 2.1 Turbo · async · ~30–60s",
        model: DASHSCOPE_MODELS.wanx21T2I,
        description:
          "DashScope Wanx 2.1 async. Better detail and fidelity vs 2.0.",
      },
      { pricing: { amount: 0.14, currency: "CNY", unit: "image" } },
    ),

    // ── DashScope sync (multimodal-generation) ────────────────────────────────
    createDashscopeSyncT2I(
      {
        name: "qwen-image",
        label: "Qwen Image 2.0 · sync · ~10–30s",
        model: DASHSCOPE_MODELS.qwen20,
        description:
          "Generalist quality sync model. Strong Chinese text rendering and poster layout.",
      },
      { pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
    ),

    createDashscopeSyncT2I(
      {
        name: "qwen-image-pro",
        label: "Qwen Image 2.0 Pro · sync · ~10–30s",
        model: DASHSCOPE_MODELS.qwen20Pro,
        description:
          "Best for text-in-image and posters. Highest quality sync variant.",
      },
      { pricing: { amount: 0.5, currency: "CNY", unit: "image" } },
    ),

    createDashscopeSyncT2I(
      {
        name: "wan2.6-t2i",
        label: "Wan 2.6 T2I · sync · ~10–30s",
        model: DASHSCOPE_MODELS.wan26T2I,
        description: "Photoreal Wan 2.6 flagship via multimodal-generation.",
      },
      { pricing: { amount: 0.2, currency: "CNY", unit: "image" } },
    ),

    // ── OpenRouter ────────────────────────────────────────────────────────────
    createOpenRouterImage(
      {
        name: "gemini-flash-image",
        label: "Gemini 2.5 Flash Image · OpenRouter",
        description:
          "Gemini 2.5 Flash text-to-image via OpenRouter. Needs OPENROUTER_API_KEY.",
        model: "google/gemini-2.5-flash-image",
      },
      { pricing: { amount: 0.039, currency: "USD", unit: "image" } },
    ),

    // ── NewAPI ────────────────────────────────────────────────────────────────
    createNewApiImage(
      {
        name: "newapi-gpt-image-1",
        label: "GPT Image 1 · NewAPI",
        description:
          "OpenAI gpt-image-1 text-to-image via NewAPI gateway. Needs NEWAPI_API_KEY.",
        model: "gpt-image-2",
      },
      { pricing: { amount: 0.04, currency: "USD", unit: "image" } },
    ),
  ],
};
