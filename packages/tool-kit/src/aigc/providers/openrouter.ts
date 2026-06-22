/**
 * OpenRouter image-modality provider 工厂 — `@pi-web/tool-kit` 版。
 *
 * 提供两类工厂:
 *  - createOpenRouterImage:    文生图(T2I);content 可为字符串或 multi-part 数组
 *  - createOpenRouterImageEdit: 图像编辑;content 永远是 multi-part(含图像 part)
 *
 * 与 pi-labs 实现的差异:
 *  - **不**调用 inlineRemoteImage — 编译器在 buildBody 前已把 att_id 解析为 data URI,
 *    非 att_id 的 https:// URL 由调用方保证可达(境内 CDN / 已内联)。
 *  - 不依赖 inlineAll / fetchImageBytes,保持零运行时外部依赖。
 */

import type { Variant, PickedResult, BuildBodyContext } from "../../engine/types.js";

// ── Endpoint & 共用常量 ────────────────────────────────────────────────────────

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUIRED_VARS = ["OPENROUTER_API_KEY"] as const;

// ── 响应类型 ──────────────────────────────────────────────────────────────────

interface OrResp {
  choices?: {
    message?: {
      content?: string;
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  error?: { code?: number; message?: string };
}

// ── T2I args ──────────────────────────────────────────────────────────────────

interface T2IArgs {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  /** 参考图(已解析为 data URI 或 https URL)。 */
  image_urls?: string[];
  size?: string;
}

// ── 图像编辑 args ─────────────────────────────────────────────────────────────

interface ImageEditArgs {
  instruction: string;
  /** 主图(已解析为 data URI 或 https URL)。 */
  image_url: string;
  /** mask — OpenRouter 不支持 mask 概念,静默忽略。 */
  mask_url?: string;
  /** 参考图(可选,已解析)。 */
  reference_image_urls?: string[];
  n?: number;
  size?: string;
}

// ── pickResult & detectError(T2I 和 image-edit 共用)─────────────────────────

function pickResult(r: unknown): PickedResult {
  const urls: string[] = [];
  for (const c of (r as OrResp).choices ?? []) {
    for (const img of c.message?.images ?? []) {
      const u = img.image_url?.url;
      if (u) urls.push(u);
    }
  }
  if (urls.length === 0) return { kind: "raw", value: r };
  if (urls.length === 1) return { kind: "image", url: urls[0] as string };
  return { kind: "image-set", urls };
}

function detectError(r: unknown): string | undefined {
  const err = (r as OrResp).error;
  if (!err) return undefined;
  return err.message ?? `code ${err.code ?? "?"}`;
}

// ── T2I buildBody ─────────────────────────────────────────────────────────────

/**
 * 文生图 body 构造器。
 *  - 无参考图:content 是字符串
 *  - 有参考图:content 切换为 multi-part 数组(text + image_url[] )
 */
function buildT2IBody(model: string) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as T2IArgs;
    const userText = a.negative_prompt
      ? `${a.prompt}\n\nAvoid: ${a.negative_prompt}`
      : a.prompt;
    const refs = a.image_urls ?? [];

    const content: unknown =
      refs.length === 0
        ? userText
        : [
            { type: "text", text: userText },
            ...refs.map((u) => ({
              type: "image_url",
              image_url: { url: u },
            })),
          ];

    const body: Record<string, unknown> = {
      model,
      modalities: ["image", "text"],
      n: a.n ?? 1,
      messages: [{ role: "user", content }],
    };
    return body;
  };
}

// ── Image-edit buildBody ──────────────────────────────────────────────────────

/**
 * 图像编辑 body 构造器。
 *  - content 永远是 multi-part:text instruction + 主图 + 参考图
 *  - mask_url 不进 payload(OpenRouter 无 mask 概念)
 */
function buildImageEditBody(model: string) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as ImageEditArgs;
    // 主图永远是第一张;额外 refs 跟后;mask_url 静默忽略
    const images = [a.image_url, ...(a.reference_image_urls ?? [])];

    const body: Record<string, unknown> = {
      model,
      modalities: ["image", "text"],
      n: a.n ?? 1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: a.instruction },
            ...images.map((u) => ({
              type: "image_url",
              image_url: { url: u },
            })),
          ],
        },
      ],
    };
    return body;
  };
}

// ── Variant 工厂入参 ─────────────────────────────────────────────────────────

export interface OpenRouterVariantArgs {
  name: string;
  label: string;
  description: string;
  model: string;
}

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/**
 * 创建 OpenRouter 图像生成(T2I)变体。
 *
 * @example
 * ```ts
 * createOpenRouterImage({
 *   name: "gemini-flash-image",
 *   label: "Gemini 2.5 Flash Image · OpenRouter",
 *   description: "...",
 *   model: "google/gemini-2.5-flash-image",
 * })
 * ```
 */
export function createOpenRouterImage(
  args: OpenRouterVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    name: args.name,
    label: args.label,
    description: args.description,
    url: OR_URL,
    headers: { authorization: "Bearer ${OPENROUTER_API_KEY}" },
    proxy: "${OPENROUTER_PROXY}",
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildT2IBody(args.model),
    pickResult,
    detectError,
    ...extras,
  };
}

/**
 * 创建 OpenRouter 图像编辑变体(无 mask)。
 *
 * @example
 * ```ts
 * createOpenRouterImageEdit({
 *   name: "openai-gpt5-image",
 *   label: "GPT-5 Image · OpenRouter",
 *   description: "...",
 *   model: "openai/gpt-5-image",
 * })
 * ```
 */
export function createOpenRouterImageEdit(
  args: OpenRouterVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    name: args.name,
    label: args.label,
    description: args.description,
    url: OR_URL,
    headers: { authorization: "Bearer ${OPENROUTER_API_KEY}" },
    proxy: "${OPENROUTER_PROXY}",
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildImageEditBody(args.model),
    pickResult,
    detectError,
    ...extras,
  };
}
