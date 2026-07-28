/**
 * Gemini 原生 relay(`:generateContent`)的**通用** provider 工厂 — 文生图 + 带图编辑。
 *
 * 与 {@link ../providers/openai-compat.js openai-compat} 并列的第二种图像协议:任何转发
 * Google Gemini 原生 `v1beta` 形态的网关(NewAPI 的 gemini relay、Google 官方端点等)都可
 * 复用本工厂,只需给出 `baseUrl`(须指向 **`/v1beta`**)+ 承载 bearer key 的 env 变量名。
 *
 * **为什么不能复用 openai-compat**(2026-07-28 真机实测):NewAPI 的
 * `/v1/images/generations` 对 Gemini 系模型直接拒绝——
 * `not supported model for image generation, only imagen models are supported`;
 * `/v1/chat/completions` 则挂满 180s 无响应。只有原生 relay
 * `POST /v1beta/models/<model>:generateContent` 出图(实测 1024×1024 JPEG,约 170s)。
 *
 * 协议要点:
 *  - 请求 `{contents:[{parts:[…]}], generationConfig:{responseModalities:["TEXT","IMAGE"], imageConfig}}`
 *  - 响应 `candidates[].content.parts[].inlineData.{mimeType, data(base64)}`
 *  - 无 `n`/`size` 概念:张数由 candidates 决定,尺寸经 `imageConfig.aspectRatio` 表达
 *    (故 `size` 参数在此**换算成最接近的宽高比**,而非原样透传)。
 *
 * **双入口边界**:与 openai-compat 同款纪律 —— 模块顶层**不得**读 `process.env`;`baseUrl`
 * 由路由声明处以字面量/`${VAR}` 占位传入,运行时经 var-resolver 展开。
 */

import type { PickedResult, BuildBodyContext } from "../../engine/endpoint-types.js";
import type { ImageProviderId, ImageRoute } from "../types.js";

// ── 网关配置 / 工厂入参 ───────────────────────────────────────────────────────

export interface GeminiRelayConfig {
  /** relay 根,**须含 `/v1beta`**(工厂只在其后拼 `/models/<model>:generateContent`)。 */
  baseUrl: string;
  /** 承载 bearer key 的 env 变量名(如 `NEWAPI_API_KEY`)。 */
  apiKeyVar: string;
  /** provider 徽章。 */
  provider: ImageProviderId;
}

/** 工厂入参:LLM 可见 model(路由键)+ 元数据;providerModel 缺省 = model。 */
export interface GeminiRelayModelArgs {
  model: string;
  label: string;
  description: string;
  /** 实际发往网关的 model 名(缺省 = model)。 */
  providerModel?: string;
}

// ── 响应类型 ──────────────────────────────────────────────────────────────────

interface GeminiInlineData {
  mimeType?: string;
  data?: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  /** 驼峰的另一种写法(部分 relay 原样透传 snake_case)。 */
  inline_data?: GeminiInlineData;
}

interface GeminiRelayResp {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  /** relay 侧错误(NewAPI 用 OpenAI 风格 error 对象)。 */
  error?: { code?: number | string; message?: string; status?: string };
  /** Google 官方风格的顶层 promptFeedback 拒答。 */
  promptFeedback?: { blockReason?: string };
}

// ── args ─────────────────────────────────────────────────────────────────────

interface RelayT2IArgs {
  prompt: string;
  negative_prompt?: string;
  /** "1024x1024" / "1024*1024" —— 换算为 aspectRatio。 */
  size?: string;
}

interface RelayEditArgs extends RelayT2IArgs {
  /** 主图,已由编排层解析为 data URI。 */
  image: string;
  /** 参考图(可选,已解析为 data URI)。 */
  reference_images?: string[];
}

// ── 尺寸 → 宽高比 ─────────────────────────────────────────────────────────────

/** Gemini `imageConfig.aspectRatio` 支持的常见比值。 */
const ASPECT_RATIOS: readonly (readonly [string, number])[] = [
  ["1:1", 1],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
];

/**
 * "1024x1024" / "1536*1024" / "1024×1536" → 最接近的 `aspectRatio`。
 * 无法解析(含 "auto")→ `undefined`,由模型取默认。
 */
export function toAspectRatio(size: string | undefined): string | undefined {
  if (!size) return undefined;
  const m = /^(\d+)\s*[x*×]\s*(\d+)$/i.exec(size.trim());
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return undefined;
  const target = w / h;
  let best = ASPECT_RATIOS[0] as readonly [string, number];
  for (const cur of ASPECT_RATIOS) {
    if (Math.abs(cur[1] - target) < Math.abs(best[1] - target)) best = cur;
  }
  return best[0];
}

// ── data URI 拆解(编辑用:把已解析的图塞进 inlineData)────────────────────────

/** `data:image/png;base64,XXXX` → `{mimeType, data}`;非 data URI → undefined。 */
function parseDataUri(uri: string): GeminiInlineData | undefined {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
  if (!m) return undefined;
  return { mimeType: m[1] as string, data: m[2] as string };
}

// ── pickResult & detectError ─────────────────────────────────────────────────

function inlineOf(p: GeminiPart): GeminiInlineData | undefined {
  return p.inlineData ?? p.inline_data;
}

function pickResult(r: unknown): PickedResult {
  const resp = r as GeminiRelayResp;
  const urls: string[] = [];
  const texts: string[] = [];
  for (const c of resp.candidates ?? []) {
    for (const p of c.content?.parts ?? []) {
      const inline = inlineOf(p);
      if (inline?.data) {
        urls.push(`data:${inline.mimeType ?? "image/png"};base64,${inline.data}`);
      } else if (p.text) {
        texts.push(p.text);
      }
    }
  }
  // 图优先;模型偶尔只回文字(拒答/追问)——如实透出文本而非报"无结果"。
  if (urls.length === 1) return { kind: "image", url: urls[0] as string };
  if (urls.length > 1) return { kind: "image-set", urls };
  if (texts.length > 0) return { kind: "text", text: texts.join("\n") };
  return { kind: "raw", value: r };
}

function detectError(r: unknown): string | undefined {
  const resp = r as GeminiRelayResp;
  if (resp.error) return resp.error.message ?? `code ${resp.error.code ?? "?"}`;
  const blocked = resp.promptFeedback?.blockReason;
  if (blocked) return `blocked by safety filter: ${blocked}`;
  return undefined;
}

// ── buildBody ────────────────────────────────────────────────────────────────

/** 负向提示无原生字段,按 openai-compat 同款并入正文。 */
function withNegative(a: RelayT2IArgs): string {
  return a.negative_prompt ? `${a.prompt}\n\nAvoid: ${a.negative_prompt}` : a.prompt;
}

function generationConfig(a: RelayT2IArgs): Record<string, unknown> {
  const cfg: Record<string, unknown> = { responseModalities: ["TEXT", "IMAGE"] };
  const aspectRatio = toAspectRatio(a.size);
  if (aspectRatio) cfg.imageConfig = { aspectRatio };
  return cfg;
}

function buildT2IBody() {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as RelayT2IArgs;
    return {
      contents: [{ parts: [{ text: withNegative(a) }] }],
      generationConfig: generationConfig(a),
    };
  };
}

function buildEditBody() {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as RelayEditArgs;
    // 图在前、指令在后:与 Gemini 多模态编辑的惯例一致(先给素材再给指令)。
    const parts: GeminiPart[] = [];
    for (const uri of [a.image, ...(a.reference_images ?? [])]) {
      if (!uri) continue;
      const inline = parseDataUri(uri);
      // 非 data URI(如 https 直链)无法进 inlineData —— 编排层的 mediaFields 已负责解析,
      // 此处静默跳过而非抛错,避免单张参考图形态异常拖垮整次调用。
      if (inline) parts.push({ inlineData: inline });
    }
    parts.push({ text: withNegative(a) });
    return { contents: [{ parts }], generationConfig: generationConfig(a) };
  };
}

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

/** 去掉 base URL 尾部斜杠,避免拼出 `//models`。 */
function trimSlash(base: string): string {
  return base.replace(/\/+$/, "");
}

function relayUrl(cfg: GeminiRelayConfig, model: string): string {
  return `${trimSlash(cfg.baseUrl)}/models/${model}:generateContent`;
}

function baseRoute(cfg: GeminiRelayConfig, args: GeminiRelayModelArgs): Omit<ImageRoute, "buildBody"> {
  return {
    model: args.model,
    label: args.label,
    description: args.description,
    provider: cfg.provider,
    url: relayUrl(cfg, args.providerModel ?? args.model),
    headers: { authorization: `Bearer \${${cfg.apiKeyVar}}` },
    requiredVars: [cfg.apiKeyVar],
    pickResult,
    detectError,
  };
}

/** 创建 Gemini relay 文生图路由项(走 `${baseUrl}/models/<model>:generateContent`)。 */
export function createGeminiRelayImage(
  cfg: GeminiRelayConfig,
  args: GeminiRelayModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return { ...baseRoute(cfg, args), buildBody: buildT2IBody(), ...extras };
}

/** 创建 Gemini relay 图像编辑路由项(同端点,输入图经 `inlineData` 随 contents 提交)。 */
export function createGeminiRelayImageEdit(
  cfg: GeminiRelayConfig,
  args: GeminiRelayModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return { ...baseRoute(cfg, args), buildBody: buildEditBody(), ...extras };
}
