/**
 * NewAPI(OpenAI 兼容聚合网关)provider 工厂 — `@pi-web/tool-kit` 版。
 *
 * 提供两类工厂:
 *  - createNewApiImage:    文生图(T2I),走 /v1/images/generations
 *  - createNewApiImageEdit: 图像编辑,走 /v1/images/edits(multipart FormData)
 *
 * base URL 来自 `NEWAPI_BASE_URL` env;默认 apiservices.top。
 * key 走 `${NEWAPI_API_KEY}` 占位(var-resolver 运行时展开)。
 * 国内网关**不挂 proxy**,避免增加延迟或触发安全策略。
 */

import type { Variant, PickedResult, BuildBodyContext } from "../../engine/types.js";

// ── Base URL ────────────────────────────────────────────────────────────────────

// NewAPI 网关 base 暂为**编译期常量**:本模块经 category 声明从主入口(前端安全)导出,
// 模块顶层**不得**读 `process.env`(浏览器 bundle eval 时 `process` 可能未定义,破坏双入口
// 边界 / Req 6.3)。如需可配置 base,Wave 2 经 var-resolver `${VAR}` 占位在运行时解析。
const BASE_URL = "https://www.apiservices.top/v1";
const IMAGES_URL = `${BASE_URL}/images/generations`;
const IMAGES_EDIT_URL = `${BASE_URL}/images/edits`;
const REQUIRED_VARS = ["NEWAPI_API_KEY"] as const;

// ── 响应类型 ──────────────────────────────────────────────────────────────────

interface NewApiResp {
  data?: { url?: string; b64_json?: string }[];
  error?: { code?: number | string; message?: string };
}

// ── T2I args ──────────────────────────────────────────────────────────────────

interface T2IArgs {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  /** 前端格式 "1024*1024"(* / × 分隔);转成 OpenAI 的 "1024x1024"。 */
  size?: string;
}

// ── 图像编辑 args ─────────────────────────────────────────────────────────────

interface ImageEditArgs {
  instruction: string;
  /** 主图(已解析为 data URI 或 https URL)。 */
  image_url: string;
  mask_url?: string;
  /** 参考图(可选,已解析)。 */
  reference_image_urls?: string[];
  n?: number;
}

// ── pickResult & detectError(T2I 和 image-edit 共用)─────────────────────────

function pickResult(r: unknown): PickedResult {
  const data = (r as NewApiResp).data ?? [];
  const urls = data
    .map((d) =>
      d.url
        ? d.url
        : d.b64_json
          ? `data:image/png;base64,${d.b64_json}`
          : "",
    )
    .filter(Boolean);
  if (urls.length === 0) return { kind: "raw", value: r };
  if (urls.length === 1) return { kind: "image", url: urls[0] as string };
  return { kind: "image-set", urls };
}

function detectError(r: unknown): string | undefined {
  const err = (r as NewApiResp).error;
  if (!err) return undefined;
  return err.message ?? `code ${err.code ?? "?"}`;
}

// ── T2I buildBody ─────────────────────────────────────────────────────────────

/** "1024*1024" / "1024×1024" → "1024x1024"。无法识别则原样透传。 */
function toOpenAiSize(size: string | undefined): string | undefined {
  if (!size) return undefined;
  return size.replace(/[*×]/g, "x");
}

function buildT2IBody(model: string) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as T2IArgs;
    const prompt = a.negative_prompt
      ? `${a.prompt}\n\nAvoid: ${a.negative_prompt}`
      : a.prompt;
    const body: Record<string, unknown> = {
      model,
      prompt,
      n: a.n ?? 1,
      response_format: "url",
    };
    const size = toOpenAiSize(a.size);
    if (size) body.size = size;
    return body;
  };
}

// ── Image-edit buildBody ──────────────────────────────────────────────────────

/** mime → 文件扩展名。 */
function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

/** 从 URL 推断文件名;无法推断时用 mime 兜底。 */
function filenameFromUrl(url: string, mime: string): string {
  try {
    const last = new URL(url).pathname.split("/").pop();
    if (last && /\.[a-z0-9]+$/i.test(last)) return last;
  } catch {
    // fallthrough
  }
  return `image.${extFromMime(mime)}`;
}

/**
 * http(s) / data: 源图 → multipart Blob + filename。
 * 编译器已把 att_id 解析为 data URI,故这里主要处理 data: 和 https。
 * data URI → 直接解码;https → fetch 下载。
 */
async function fetchImagePart(url: string): Promise<{ blob: Blob; filename: string }> {
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(url);
    if (!m) throw new Error(`无法解析 data URI 源图`);
    const mime = m[1] ?? "image/png";
    const bytes = m[2]
      ? Buffer.from(m[3] ?? "", "base64")
      : Buffer.from(decodeURIComponent(m[3] ?? ""), "utf8");
    return {
      blob: new Blob([bytes], { type: mime }),
      filename: `image.${extFromMime(mime)}`,
    };
  }
  // https URL 直接 fetch(国内网关,直连即可)
  const resp = await globalThis.fetch(url);
  if (!resp.ok) {
    throw new Error(`下载输入图失败: ${url} → ${resp.status}`);
  }
  const ct = resp.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
  const bytes = await resp.arrayBuffer();
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: ct }),
    filename: filenameFromUrl(url, ct),
  };
}

function buildImageEditBody(model: string) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<FormData> => {
    const a = args as unknown as ImageEditArgs;
    const sources = [a.image_url, ...(a.reference_image_urls ?? [])].filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    const parts = await Promise.all(sources.map((u) => fetchImagePart(u)));
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", a.instruction);
    form.append("n", String(a.n ?? 1));
    for (const p of parts) {
      form.append("image[]", p.blob, p.filename);
    }
    return form;
  };
}

// ── Variant 工厂入参 ─────────────────────────────────────────────────────────

export interface NewApiVariantArgs {
  name: string;
  label: string;
  description: string;
  model: string;
}

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/**
 * 创建 NewAPI 文生图(T2I)变体。
 *
 * @example
 * ```ts
 * createNewApiImage({
 *   name: "newapi-gpt-image-1",
 *   label: "GPT Image 1 · NewAPI",
 *   description: "...",
 *   model: "gpt-image-1",
 * })
 * ```
 */
export function createNewApiImage(
  args: NewApiVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    name: args.name,
    label: args.label,
    description: args.description,
    url: IMAGES_URL,
    headers: { authorization: "Bearer ${NEWAPI_API_KEY}" },
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildT2IBody(args.model),
    pickResult,
    detectError,
    ...extras,
  };
}

/**
 * 创建 NewAPI 图像编辑变体(走 /v1/images/edits multipart)。
 *
 * @example
 * ```ts
 * createNewApiImageEdit({
 *   name: "newapi-gpt-image-2",
 *   label: "GPT Image 2 · NewAPI",
 *   description: "...",
 *   model: "gpt-image-2",
 * })
 * ```
 */
export function createNewApiImageEdit(
  args: NewApiVariantArgs,
  extras: Partial<Variant> = {},
): Variant {
  return {
    name: args.name,
    label: args.label,
    description: args.description,
    url: IMAGES_EDIT_URL,
    headers: { authorization: "Bearer ${NEWAPI_API_KEY}" },
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildImageEditBody(args.model),
    pickResult,
    detectError,
    ...extras,
  };
}
