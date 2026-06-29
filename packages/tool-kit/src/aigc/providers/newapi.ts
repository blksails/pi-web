/**
 * NewAPI(OpenAI 兼容聚合网关)provider 工厂 — `@blksails/pi-web-tool-kit` 版。
 *
 * 提供两类 model 路由项工厂(返回 {@link ModelRoute}):
 *  - createNewApiImage:    文生图,走 /v1/images/generations
 *  - createNewApiImageEdit: 图像编辑,走 /v1/images/edits(multipart FormData)
 *
 * `model` 为 LLM 可见路由键;`providerModel`(缺省 = model)为实际发往网关的 model 名。
 * base URL 暂为编译期常量;key 走 `${NEWAPI_API_KEY}` 占位(var-resolver 运行时展开)。
 * 国内网关**不挂 proxy**,避免增加延迟或触发安全策略。
 */

import type { ModelRoute, PickedResult, BuildBodyContext } from "../../engine/types.js";

// ── Base URL ────────────────────────────────────────────────────────────────────

// NewAPI 网关 base 暂为**编译期常量**:本模块经 tool 声明从主入口(前端安全)导出,
// 模块顶层**不得**读 `process.env`(浏览器 bundle eval 时 `process` 可能未定义,破坏双入口
// 边界 / Req 6.1)。如需可配置 base,后续经 var-resolver `${VAR}` 占位在运行时解析。
const BASE_URL = "https://www.apiservices.top/v1";
const IMAGES_URL = `${BASE_URL}/images/generations`;
const IMAGES_EDIT_URL = `${BASE_URL}/images/edits`;
const REQUIRED_VARS = ["NEWAPI_API_KEY"] as const;

// ── 响应类型 ──────────────────────────────────────────────────────────────────

interface NewApiResp {
  data?: { url?: string; b64_json?: string }[];
  error?: { code?: number | string; message?: string };
}

// ── T2I args(对齐 OpenAI Images generations)─────────────────────────────────

interface T2IArgs {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  /** 前端格式 "1024*1024"(* / × 分隔);转成 OpenAI 的 "1024x1024"。 */
  size?: string;
  /** gpt-image 专属:transparent | opaque | auto。 */
  background?: string;
  /** OpenAI 专属:生成质量。 */
  quality?: string;
  /** gpt-image 专属:low | auto 内容审核级别。 */
  moderation?: string;
}

// ── 图像编辑 args(对齐 OpenAI Images edits)───────────────────────────────────

interface ImageEditArgs {
  prompt: string;
  /** 主图(已解析为 data URI 或 https URL)。 */
  image: string;
  /** 可选 B/W 遮罩(已解析)。 */
  mask?: string;
  /** 参考图(可选,已解析)。 */
  reference_images?: string[];
  n?: number;
  size?: string;
  /** url | b64_json。 */
  response_format?: string;
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
      // b64_json:让网关把图片字节内联在 /images 响应里返回(gpt-image 原生格式),而不是
      // 先返回一个 CDN url、再由 persistPicked 二次下载整张图。后者使工具完成明显滞后于
      // 网关"已返回"的时刻(后台日志显示 19s 已出图,前端却还在转——那段就是二次下载)。
      // 内联后 persistPicked 走本地解码,无第二次网络往返;pickResult 已支持 b64_json。
      response_format: "b64_json",
    };
    const size = toOpenAiSize(a.size);
    if (size) body.size = size;
    // OpenAI gpt-image 专属参数透传(非 gpt-image model 由网关忽略)。
    if (a.background) body.background = a.background;
    if (a.quality) body.quality = a.quality;
    if (a.moderation) body.moderation = a.moderation;
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
    const sources = [a.image, ...(a.reference_images ?? [])].filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    const parts = await Promise.all(sources.map((u) => fetchImagePart(u)));
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", a.prompt);
    form.append("n", String(a.n ?? 1));
    const size = toOpenAiSize(a.size);
    if (size) form.append("size", size);
    if (a.response_format) form.append("response_format", a.response_format);
    for (const p of parts) {
      form.append("image[]", p.blob, p.filename);
    }
    // 可选 B/W 遮罩(OpenAI edits 的 mask 字段)。
    if (a.mask) {
      const maskPart = await fetchImagePart(a.mask);
      form.append("mask", maskPart.blob, maskPart.filename);
    }
    return form;
  };
}

// ── model 路由项工厂入参 ────────────────────────────────────────────────────────

/** 工厂入参:LLM 可见 model(路由键)+ 元数据;providerModel 缺省 = model。 */
export interface NewApiModelArgs {
  /** LLM 可见路由键(进 model 枚举)。 */
  model: string;
  label: string;
  description: string;
  /** 实际发往网关的 model 名(缺省 = model)。 */
  providerModel?: string;
}

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/**
 * 创建 NewAPI 文生图路由项(走 /v1/images/generations)。
 */
export function createNewApiImage(
  args: NewApiModelArgs,
  extras: Partial<ModelRoute> = {},
): ModelRoute {
  return {
    model: args.model,
    label: args.label,
    description: args.description,
    url: IMAGES_URL,
    headers: { authorization: "Bearer ${NEWAPI_API_KEY}" },
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildT2IBody(args.providerModel ?? args.model),
    pickResult,
    detectError,
    ...extras,
  };
}

/**
 * 创建 NewAPI 图像编辑路由项(走 /v1/images/edits multipart)。
 */
export function createNewApiImageEdit(
  args: NewApiModelArgs,
  extras: Partial<ModelRoute> = {},
): ModelRoute {
  return {
    model: args.model,
    label: args.label,
    description: args.description,
    url: IMAGES_EDIT_URL,
    headers: { authorization: "Bearer ${NEWAPI_API_KEY}" },
    requiredVars: [...REQUIRED_VARS],
    buildBody: buildImageEditBody(args.providerModel ?? args.model),
    pickResult,
    detectError,
    ...extras,
  };
}
