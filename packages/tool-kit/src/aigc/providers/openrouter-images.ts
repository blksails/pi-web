/**
 * OpenRouter **Images** provider 工厂 —— 走 `POST https://openrouter.ai/api/v1/images`
 * (OpenAI `/images` 同构端点,**非** `/chat/completions`)。
 *
 * 关键能力:`stream:true` + `partial_images:N` → **真渐进局部图**(由糊变清):
 *   event `image_generation.partial_image`(idx 0..N-1,整幅 b64,完成度递增)→ `image_generation.completed`。
 * 仅 OpenAI 图像模型(gpt-5-image / -mini / gpt-5.4-image-2)支持;Gemini 系不支持(仍走 chat 工厂)。
 *
 * 与 `openai-compat.ts` 的区别:那套打 `/images/generations|edits`(OpenRouter 上 404);本套打
 * `/api/v1/images` 本体,gen/edit 均为 **JSON**(edit 用 `image` 字段传 data URI,非 multipart)。
 * 执行层经 `stream:true` + `streamKind:"images"` 走 {@link ../../engine/endpoint-adapter} 的 images 流式分支。
 */

import type { PickedResult, BuildBodyContext } from "../../engine/endpoint-types.js";
import type { ImageRoute } from "../types.js";

const OR_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const API_KEY_VAR = "OPENROUTER_API_KEY";
const DEFAULT_PARTIAL_IMAGES = 2;

// ── 响应类型(非流式回退 / completed 帧)──────────────────────────────────────
interface ImagesResp {
  data?: { b64_json?: string; url?: string }[];
  error?: { code?: number | string; message?: string };
}

/** "1024*1024" / "1024×1024" → "1024x1024"。 */
function toOpenAiSize(size: string | undefined): string | undefined {
  return size ? size.replace(/[*×]/g, "x") : undefined;
}

/** 非流式回退解析:`{data:[{b64_json|url}]}`。流式路径不经此(见 endpoint-adapter images 分支)。 */
function pickResult(r: unknown): PickedResult {
  const data = (r as ImagesResp).data ?? [];
  const urls = data
    .map((d) => (d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url ?? ""))
    .filter(Boolean);
  if (urls.length === 0) return { kind: "raw", value: r };
  if (urls.length === 1) return { kind: "image", url: urls[0] as string };
  return { kind: "image-set", urls };
}

function detectError(r: unknown): string | undefined {
  const err = (r as ImagesResp).error;
  if (!err) return undefined;
  return err.message ?? `code ${err.code ?? "?"}`;
}

interface T2IArgs {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  size?: string;
}

interface EditArgs extends T2IArgs {
  /** 主图(编译器已解析为 data URI)。 */
  image: string;
}

function buildGenBody(model: string, partialImages: number) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as T2IArgs;
    const prompt = a.negative_prompt ? `${a.prompt}\n\nAvoid: ${a.negative_prompt}` : a.prompt;
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: a.n ?? 1,
      stream: true,
      partial_images: partialImages,
    };
    const size = toOpenAiSize(a.size);
    if (size) body.size = size;
    return body;
  };
}

function buildEditBody(model: string, partialImages: number) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as EditArgs;
    const prompt = a.negative_prompt ? `${a.prompt}\n\nAvoid: ${a.negative_prompt}` : a.prompt;
    const body: Record<string, unknown> = {
      model,
      prompt,
      image: a.image, // 已由 mediaFields 解析为 data URI
      n: a.n ?? 1,
      stream: true,
      partial_images: partialImages,
    };
    const size = toOpenAiSize(a.size);
    if (size) body.size = size;
    return body;
  };
}

/** 工厂入参。 */
export interface OpenRouterImagesModelArgs {
  model: string;
  label: string;
  description: string;
  /** 实际发往 OpenRouter 的 model 名(带 `openai/` 前缀)。 */
  providerModel?: string;
  /** partial_images 张数(渐进图),缺省 2。 */
  partialImages?: number;
}

function baseRoute(args: OpenRouterImagesModelArgs, extras: Partial<ImageRoute>): Omit<ImageRoute, "buildBody"> {
  return {
    model: args.model,
    label: args.label,
    description: args.description,
    url: OR_IMAGES_URL,
    headers: { authorization: `Bearer \${${API_KEY_VAR}}` },
    proxy: "${OPENROUTER_PROXY}",
    requiredVars: [API_KEY_VAR],
    stream: true,
    streamKind: "images",
    pickResult,
    detectError,
    ...extras,
  };
}

/** 文生图(渐进局部图)路由项。 */
export function createOpenRouterImagesGen(
  args: OpenRouterImagesModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return {
    ...baseRoute(args, extras),
    buildBody: buildGenBody(args.providerModel ?? args.model, args.partialImages ?? DEFAULT_PARTIAL_IMAGES),
  };
}

/** 带图编辑(渐进局部图)路由项;主图经 `image` 字段传 data URI。 */
export function createOpenRouterImagesEdit(
  args: OpenRouterImagesModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return {
    ...baseRoute(args, extras),
    buildBody: buildEditBody(args.providerModel ?? args.model, args.partialImages ?? DEFAULT_PARTIAL_IMAGES),
  };
}
