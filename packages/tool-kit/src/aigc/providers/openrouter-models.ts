/**
 * OpenRouter 图像模型的**共享路由清单** — 供 `image_generation` 与 `image_edit` 两个工具复用,
 * 避免同一批 model 元数据在两处漂移。
 *
 * 每个 model 走 OpenRouter `chat/completions` + `modalities:["image","text"]`(见 `openrouter.ts`),
 * 图像在 `choices[].message.images[].image_url.url`;计费按 output token(图像计入 output tokens)。
 *
 * `model` 为 LLM 可见路由键;`providerModel` 为实际发往 OpenRouter 的 model 名(带 `google/`、`openai/` 前缀)。
 * 全部候选 `input_modalities` 均含 `image`,故同一批 model 同时用于文生图与带图编辑(整图改写,无 mask)。
 *
 * ⚠️ `gpt-5.4-image-2`:接线正确,但 OpenRouter 上游 OpenAI 供应商 org 当前配额/状态异常,
 *    真实调用返回自相矛盾的 429(`Requested 5xx / Limit 180000000`),非本仓库问题;上游修复后自动可用。
 */

import type { ImageRoute } from "../types.js";
import { createOpenRouterImage, createOpenRouterImageEdit } from "./openrouter.js";
import {
  createOpenRouterImagesGen,
  createOpenRouterImagesEdit,
} from "./openrouter-images.js";

/** 单个 OpenRouter 图像 model 的共享元数据。 */
interface OpenRouterImageMeta {
  /** LLM 可见路由键(进 model 枚举)。 */
  model: string;
  /** 展示标签。 */
  label: string;
  /** 实际发往 OpenRouter 的 model 名(带 provider 前缀)。 */
  providerModel: string;
  /** 简述(拼进 description)。 */
  blurb: string;
  /** OpenRouter 报价:completion token 单价 → 折算 $/1k tokens。 */
  pricePerKTok: number;
  /**
   * 接入端点:
   *  - `"images"` —— OpenAI 图像模型走 `/api/v1/images` + `partial_images`(**真渐进局部图,由糊变清**)。
   *  - `"chat"`   —— 其余(Gemini 系)走 `/chat/completions`(reasoning 边想边显 + 图早弹;不支持 partial_images)。
   */
  endpoint: "images" | "chat";
  /**
   * **带图编辑**的接入端点覆盖(缺省 = `endpoint`)。
   * ⚠️ OpenRouter `/api/v1/images` 的 edit 路径实测**不消费输入图**(且 body 丢弃
   * reference_images)→ 生成与引用无关(纯文生图);带图编辑须走 chat 模态
   * (`image_url` parts,主图+参考图全带)。generation 无输入图,保留 images 端点的
   * partial_images 渐进体验。
   */
  editEndpoint?: "images" | "chat";
}

/** 精选可用集(均经 curl 实测出图;pricePerKTok 取自 OpenRouter /models completion 单价 ×1000)。 */
const OPENROUTER_IMAGE_MODELS: readonly OpenRouterImageMeta[] = [
  // ── Gemini 系:走 /chat/completions(reasoning 流 + 图早弹;无 partial_images)──
  {
    model: "gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image · OpenRouter",
    providerModel: "google/gemini-3.1-flash-image",
    blurb: "Google Gemini 3.1 Flash 图像模型(快、廉价)",
    pricePerKTok: 0.003,
    endpoint: "chat",
  },
  {
    model: "gemini-3-pro-image",
    label: "Gemini 3 Pro Image · OpenRouter",
    providerModel: "google/gemini-3-pro-image",
    blurb: "Google Gemini 3 Pro 图像模型(高质量)",
    pricePerKTok: 0.012,
    endpoint: "chat",
  },
  {
    model: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image · OpenRouter",
    providerModel: "google/gemini-2.5-flash-image",
    blurb: "Google Gemini 2.5 Flash 图像模型(稳定经典)",
    pricePerKTok: 0.0025,
    endpoint: "chat",
  },
  // ── OpenAI 系:走 /api/v1/images + partial_images(真渐进局部图,由糊变清)──
  {
    model: "gpt-5-image",
    label: "GPT-5 Image · OpenRouter",
    providerModel: "openai/gpt-5-image",
    blurb: "OpenAI GPT-5 图像模型(渐进局部图)",
    pricePerKTok: 0.01,
    endpoint: "images",
    editEndpoint: "chat",
  },
  {
    model: "gpt-5-image-mini",
    label: "GPT-5 Image Mini · OpenRouter",
    providerModel: "openai/gpt-5-image-mini",
    blurb: "OpenAI GPT-5 图像 Mini(廉价;渐进局部图)",
    pricePerKTok: 0.002,
    endpoint: "images",
    editEndpoint: "chat",
  },
  {
    model: "gpt-5.4-image-2",
    label: "GPT-5.4 Image 2 · OpenRouter",
    providerModel: "openai/gpt-5.4-image-2",
    blurb: "OpenAI GPT-5.4 Image 2(gpt-image-2 后继;渐进局部图)",
    pricePerKTok: 0.015,
    endpoint: "images",
  },
];

function pricingOf(perKTok: number): NonNullable<ImageRoute["pricing"]> {
  return {
    amount: perKTok,
    currency: "USD",
    unit: "1k_tokens",
    note: "按 output token 计费(图像计入 output tokens)。",
  };
}

/** 文生图路由项集合(image_generation 用 `...openRouterImageRoutes()` 展开)。 */
export function openRouterImageRoutes(): ImageRoute[] {
  return OPENROUTER_IMAGE_MODELS.map((m) => {
    if (m.endpoint === "images") {
      // OpenAI /api/v1/images + partial_images:真渐进局部图(由糊变清)。
      return createOpenRouterImagesGen(
        {
          model: m.model,
          label: m.label,
          description: `${m.blurb} via OpenRouter /images (partial_images 渐进局部图). Needs OPENROUTER_API_KEY.`,
          providerModel: m.providerModel,
        },
        { provider: "openrouter", pricing: pricingOf(m.pricePerKTok) },
      );
    }
    // Gemini:chat/completions 真 SSE(推理流边想边显 + 图早弹)。
    return createOpenRouterImage(
      {
        model: m.model,
        label: m.label,
        description: `${m.blurb} via OpenRouter chat/completions. Needs OPENROUTER_API_KEY.`,
        providerModel: m.providerModel,
      },
      { provider: "openrouter", stream: true, pricing: pricingOf(m.pricePerKTok) },
    );
  });
}

/** 带图编辑路由项集合(image_edit 用 `...openRouterImageEditRoutes()` 展开)。 */
export function openRouterImageEditRoutes(): ImageRoute[] {
  return OPENROUTER_IMAGE_MODELS.map((m) => {
    if ((m.editEndpoint ?? m.endpoint) === "images") {
      // OpenAI /api/v1/images(image 字段传 data URI)+ partial_images 渐进图。
      return createOpenRouterImagesEdit(
        {
          model: m.model,
          label: m.label,
          description: `${m.blurb} 带图编辑 via OpenRouter /images (partial_images 渐进局部图). Needs OPENROUTER_API_KEY.`,
          providerModel: m.providerModel,
        },
        { provider: "openrouter", pricing: pricingOf(m.pricePerKTok) },
      );
    }
    return createOpenRouterImageEdit(
      {
        model: m.model,
        label: m.label,
        description: `${m.blurb} 带图编辑(整图改写,无 mask) via OpenRouter chat/completions. Needs OPENROUTER_API_KEY.`,
        providerModel: m.providerModel,
      },
      { provider: "openrouter", stream: true, pricing: pricingOf(m.pricePerKTok) },
    );
  });
}
