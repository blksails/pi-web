/**
 * DashScope provider 工厂 — `@pi-web/tool-kit` 版(精简移植自 pi-labs)。
 *
 * 仅实现 Wave 1 所需的 T2I 两类:
 *  - async wanx:  POST text2image/image-synthesis → `x-dashscope-async:enable` → poll `/tasks/<id>`
 *  - sync multimodal: POST multimodal-generation/generation → 单次响应
 *
 * 密钥从 `${DASHSCOPE_API_KEY}` env 占位读取(var-resolver 在 runEndpoint 时展开)。
 */

import type { Variant } from "../../engine/types.js";

// ── Endpoint URLs ─────────────────────────────────────────────────────────────

const BASE = "https://dashscope.aliyuncs.com/api/v1";

/** Wanx 系列文生图异步端点。 */
const ASYNC_T2I_URL = `${BASE}/services/aigc/text2image/image-synthesis`;

/** Qwen-image / Wan 2.6 / Z-Image 同步多模态端点。 */
const SYNC_T2I_URL = `${BASE}/services/aigc/multimodal-generation/generation`;

/** 任务状态轮询 URL。submit 返回 task_id 后经此轮询。 */
const taskUrl = (r: unknown) =>
  `${BASE}/tasks/${(r as { output: { task_id: string } }).output.task_id}`;

// ── 共用 Headers ──────────────────────────────────────────────────────────────

const ASYNC_HEADERS = {
  authorization: "Bearer ${DASHSCOPE_API_KEY}",
  "x-dashscope-async": "enable",
};

const SYNC_HEADERS = {
  authorization: "Bearer ${DASHSCOPE_API_KEY}",
};

const REQUIRED_VARS = ["DASHSCOPE_API_KEY"] as const;

// ── 异步任务轮询 spec ─────────────────────────────────────────────────────────

/** 异步任务响应形态(text2image)。 */
interface AsyncStatus {
  output: {
    task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    results?: { url: string }[];
    code?: string;
    message?: string;
  };
}

const taskPolling = {
  statusUrl: taskUrl,
  responseUrl: taskUrl,
  isComplete: (s: unknown) =>
    (s as AsyncStatus).output.task_status === "SUCCEEDED",
  isFailed: (s: unknown) =>
    (s as AsyncStatus).output.task_status === "FAILED",
  pollMs: 5_000,
  timeoutMs: 120_000,
};

// ── T2I args ──────────────────────────────────────────────────────────────────

interface T2IArgs {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  size?: string;
  seed?: number;
}

// ── Async T2I body builder ────────────────────────────────────────────────────

/**
 * Wanx 系列异步文生图请求体。
 * input: { prompt, negative_prompt? }
 * parameters: { size, n, watermark:false }
 */
function buildAsyncT2IBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as T2IArgs;
    return {
      model,
      input: {
        prompt: a.prompt,
        ...(a.negative_prompt ? { negative_prompt: a.negative_prompt } : {}),
      },
      parameters: {
        size: a.size ?? "1024*1024",
        n: a.n ?? 1,
        watermark: false,
        ...(typeof a.seed === "number" && a.seed >= 0 ? { seed: a.seed } : {}),
      },
    };
  };
}

// ── Async T2I result picker ───────────────────────────────────────────────────

function pickAsyncT2I(r: unknown) {
  const urls = ((r as AsyncStatus).output?.results ?? [])
    .map((x) => x.url)
    .filter((u): u is string => Boolean(u));
  if (urls.length === 0) return { kind: "raw" as const, value: r };
  if (urls.length === 1) return { kind: "image" as const, url: urls[0] as string };
  return { kind: "image-set" as const, urls };
}

const detectAsyncError = (r: unknown) => {
  const out = (r as AsyncStatus).output;
  if (out?.task_status === "FAILED") return out.message ?? out.code ?? "task failed";
  return undefined;
};

// ── Sync T2I body builder ─────────────────────────────────────────────────────

/** Qwen-image / Wan 2.6 / Z-Image 同步多模态请求体。 */
function buildSyncT2IBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as T2IArgs;
    const content: { text: string }[] = [{ text: a.prompt }];
    if (a.negative_prompt) content.push({ text: `Negative: ${a.negative_prompt}` });
    return {
      model,
      input: { messages: [{ role: "user", content }] },
      parameters: {
        size: a.size ?? "1024*1024",
        n: a.n ?? 1,
        ...(typeof a.seed === "number" && a.seed >= 0 ? { seed: a.seed } : {}),
      },
    };
  };
}

// ── Image-edit body builder ───────────────────────────────────────────────────

/** image_edit 用 args 形态。 */
interface ImageEditArgs {
  instruction: string;
  /** 主图(已解析为 data URI 或 https URL)。 */
  image_url: string;
  /** 可选 B/W mask;白色区域重绘。 */
  mask_url?: string;
  /** 可选参考图(数组,已解析)。 */
  reference_image_urls?: string[];
  n?: number;
  size?: string;
  seed?: number;
}

/** 单次请求可携带的最大图数(主图 + mask + 参考图 ≤ 3)。 */
const IMAGE_EDIT_MAX_IMAGES = 3;

/**
 * DashScope qwen-image-edit 系列图像编辑请求体。
 *
 * content 顺序: 主图 → mask(若有)→ 参考图 → text 指令。
 * 有 mask 时在 instruction 前加局部重绘提示,让模型理解图2是遮罩区域。
 */
function buildImageEditBody(model: string) {
  return (args: Record<string, unknown>) => {
    const a = args as unknown as ImageEditArgs;
    const refs = a.reference_image_urls ?? [];
    const totalImages = 1 + (a.mask_url ? 1 : 0) + refs.length;
    if (totalImages > IMAGE_EDIT_MAX_IMAGES) {
      throw new Error(
        `image_edit 总图数超过上限:主图 + ${a.mask_url ? "mask + " : ""}${refs.length} 张参考图 = ${totalImages},最多 ${IMAGE_EDIT_MAX_IMAGES} 张。`,
      );
    }
    const content: Record<string, unknown>[] = [{ image: a.image_url }];
    if (a.mask_url) content.push({ image: a.mask_url });
    for (const url of refs) content.push({ image: url });
    const textInstruction = a.mask_url
      ? `请对图2中白色遮罩区域进行局部重绘:${a.instruction}`
      : a.instruction;
    content.push({ text: textInstruction });
    return {
      model,
      input: { messages: [{ role: "user", content }] },
      parameters: {
        size: a.size ?? "1024*1024",
        n: a.n ?? 1,
        ...(typeof a.seed === "number" && a.seed >= 0 ? { seed: a.seed } : {}),
      },
    };
  };
}

// ── Sync T2I result picker ────────────────────────────────────────────────────

interface SyncResponse {
  output?: {
    choices?: {
      message?: { content?: { image?: string; text?: string }[] };
    }[];
  };
  code?: string;
  message?: string;
}

function pickSync(r: unknown) {
  const choices = (r as SyncResponse).output?.choices ?? [];
  const urls: string[] = [];
  for (const c of choices) {
    for (const block of c.message?.content ?? []) {
      if (block.image) urls.push(block.image);
    }
  }
  if (urls.length === 0) return { kind: "raw" as const, value: r };
  if (urls.length === 1) return { kind: "image" as const, url: urls[0] as string };
  return { kind: "image-set" as const, urls };
}

const detectSyncError = (r: unknown) => {
  const code = (r as SyncResponse).code;
  return code ? ((r as SyncResponse).message ?? code) : undefined;
};

// ── Variant 工厂函数(公开 API) ────────────────────────────────────────────────

/** 工厂入参:最小元数据 + model id。 */
export interface DashscopeVariantArgs {
  name: string;
  label: string;
  description: string;
  model: string;
}

/**
 * 创建 DashScope Wanx 系列异步文生图变体(POST → 轮询)。
 *
 * @example
 * ```ts
 * const v = createDashscopeAsyncT2I({
 *   name: "wanx-turbo",
 *   label: "Wanx 2.0 Turbo",
 *   description: "...",
 *   model: "wanx2.0-t2i-turbo",
 * });
 * ```
 */
export function createDashscopeAsyncT2I(
  args: DashscopeVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    ...args,
    url: ASYNC_T2I_URL,
    headers: ASYNC_HEADERS,
    requiredVars: [...REQUIRED_VARS],
    async: taskPolling,
    buildBody: buildAsyncT2IBody(args.model),
    pickResult: pickAsyncT2I,
    detectError: detectAsyncError,
    ...extras,
  };
}

/**
 * 创建 DashScope 同步多模态文生图变体(单次 POST 拿结果)。
 *
 * @example
 * ```ts
 * const v = createDashscopeSyncT2I({
 *   name: "qwen-image-pro",
 *   label: "Qwen Image 2.0 Pro",
 *   description: "...",
 *   model: "qwen-vl-max",
 * });
 * ```
 */
export function createDashscopeSyncT2I(
  args: DashscopeVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    ...args,
    url: SYNC_T2I_URL,
    headers: SYNC_HEADERS,
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildSyncT2IBody(args.model),
    pickResult: pickSync,
    detectError: detectSyncError,
    ...extras,
  };
}

/**
 * 创建 DashScope 图像编辑变体(qwen-image-edit-max / qwen-image-2.0)。
 *
 * 走 multimodal-generation 同步端点,支持 mask 局部重绘。
 *
 * @example
 * ```ts
 * const v = createDashscopeImageEdit({
 *   name: "qwen-image-edit-max",
 *   label: "Qwen Image Edit Max · sync",
 *   description: "...",
 *   model: "qwen-image-edit-max",
 * });
 * ```
 */
export function createDashscopeImageEdit(
  args: DashscopeVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    ...args,
    url: SYNC_T2I_URL,
    headers: SYNC_HEADERS,
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildImageEditBody(args.model),
    pickResult: pickSync,
    detectError: detectSyncError,
    ...extras,
  };
}

/** DashScope Wave 1 常用 model id 常量。 */
export const DASHSCOPE_MODELS = {
  /** Wanx 2.0 Turbo:最便宜异步文生图(¥0.04/张)。 */
  wanx20T2I: "wanx2.0-t2i-turbo",
  /** Wanx 2.1 Turbo:质量提升版异步(¥0.14/张)。 */
  wanx21T2I: "wanx2.1-t2i-turbo",
  /** Wan 2.2 Flash:更新基模异步(¥0.14/张)。 */
  wan22T2I: "wan2.2-t2i-flash",
  /** Qwen Image 2.0 Pro:文字渲染/海报,同步(¥0.50/张)。 */
  qwen20Pro: "qwen-image-2.0-pro",
  /** Qwen Image 2.0:通用质量同步(¥0.20/张)。 */
  qwen20: "qwen-image-2.0",
  /** Wan 2.6 T2I 写实同步(¥0.20/张)。 */
  wan26T2I: "wan2.6-t2i",
  /** Qwen Image Edit Max:最高质量局部重绘(¥0.50/张)。 */
  qwenImageEditMax: "qwen-image-edit-max",
} as const;
