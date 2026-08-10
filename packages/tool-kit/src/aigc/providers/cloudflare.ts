/**
 * Cloudflare AI Gateway(`/ai/run` 统一端点)provider 工厂 — 文生图 + 带图编辑
 * (spec cloudflare-aigc-provider,design.md §Components)。
 *
 * 与 {@link ./openai-compat.js openai-compat} 并列的**第三种**图像协议(前两种是 OpenAI
 * `/images` 兼容与 Gemini `:generateContent` relay)。结构照 `gemini-relay.ts` —— 同为非
 * OpenAI 协议、同样需要把编排层解析好的参考图转成自己协议的形态。
 *
 * **为什么不能复用 openai-compat**(2026-07-29 真机实测,research.md §1.1):CF 的 `/ai/run`
 * 与 OpenAI `/images` 在三处不同 ——
 *  - 请求体:模型参数**嵌套在 `input` 下**(`{model, input:{prompt,…}}`),非平铺;
 *  - 响应:取图路径为 `result.result.image` 或 `result.image`,非 `data[].{url,b64_json}`;
 *  - 必需额外 header `cf-aig-gateway-id`。
 *
 * ★ **两类模型的响应形态不同**(本模块最关键的约束):同一个 `/ai/run` 端点上
 *  - Unified 第三方(`openai/*`、`google/*` 等)→ `{result:{state,result:{image:"<R2 URL>"}}}`
 *    ——两层嵌套,值是 24h 预签名远程 URL;
 *  - Workers AI 原生(`@cf/*`)          → `{result:{image:"<裸 base64>"}}`
 *    ——一层,值是**不带 `data:` 前缀**的 base64。
 * 故 {@link pickResult} 双路探测,base64 分支自行嗅探 MIME 后拼 data URI,使两类模型对用户
 * 呈现一致(Req 3)。
 *
 * **统一计费**:`gatewayMetadata.keySource === "Unified"` —— 调用 `openai/*` 等第三方模型
 * 只需 Cloudflare 自身凭据,无需再持有并下发该 provider 的 key(Req 1.5)。
 *
 * **双入口边界**:与 openai-compat / gemini-relay 同款纪律 —— 模块顶层**不得**读
 * `process.env`;账号 id / 网关 id / token 三者均走 `${VAR}` 占位符,执行期经 var-resolver
 * 展开。是否**注册**本模块产出的路由由 runtime 层 `../extension.ts` 按三个 env 是否齐备
 * 条件并入,本模块自身不参与该判断。
 *
 * ★ **env 命名约束**(Req 5.3):凭据 env 名为 `CLOUDFLARE_API_TOKEN`,**不得**使用
 * `AI_GATEWAY_API_KEY` —— 后者是 pi-ai SDK 内建 Vercel AI Gateway 的官方凭据 env,一旦出现
 * 在与 pi 同进程的环境里会劫持**全部**模型调用去 Vercel(401),而不只是影响图像工具
 * (pi-clouds 8.2 真机事故;另见 `./ai-gateway.ts` 同款说明)。
 */

import type { PickedResult, BuildBodyContext } from "../../engine/endpoint-types.js";
import type { ImageProviderId, ImageRoute } from "../types.js";

// ── 网关配置 / 工厂入参 ───────────────────────────────────────────────────────

/** Cloudflare 通路配置(值为 `${VAR}` 占位符名,执行期展开)。 */
export interface CloudflareConfig {
  /** 账号 id 的 env 变量名,拼进 `/accounts/{id}/ai/run`。 */
  accountIdVar: string;
  /** 网关 id 的 env 变量名,进 `cf-aig-gateway-id` header。 */
  gatewayIdVar: string;
  /** 访问凭据的 env 变量名,进 `Authorization: Bearer`。 */
  apiTokenVar: string;
  /** provider 徽章。 */
  provider: ImageProviderId;
}

/** 工厂入参:LLM 可见 model(路由键)+ 元数据;providerModel 缺省 = model。 */
export interface CloudflareModelArgs {
  /** LLM 可见 model 值 + 运行时路由键(须全局唯一)。 */
  model: string;
  label: string;
  description: string;
  /**
   * 实际发往 CF 的模型名,如 `"openai/gpt-image-2"`(Unified)或
   * `"@cf/black-forest-labs/flux-1-schnell"`(Workers AI)。缺省 = model。
   */
  providerModel?: string;
}

/** 默认配置:与 wrangler 官方 env 名一致,便于本地开发直接复用已有凭据。 */
export const CLOUDFLARE_CONFIG: CloudflareConfig = {
  accountIdVar: "CLOUDFLARE_ACCOUNT_ID",
  gatewayIdVar: "CLOUDFLARE_AIG_GATEWAY_ID",
  apiTokenVar: "CLOUDFLARE_API_TOKEN",
  provider: "cloudflare",
};

/** 启用本通路所需的全部 env 变量名(缺一不可)。 */
export const CLOUDFLARE_REQUIRED_ENV: readonly string[] = [
  CLOUDFLARE_CONFIG.accountIdVar,
  CLOUDFLARE_CONFIG.gatewayIdVar,
  CLOUDFLARE_CONFIG.apiTokenVar,
];

/**
 * 判定 Cloudflare 通路是否已配置齐备(三项全部非空白)。
 *
 * ★ **判据单一事实源**:runtime 层 `../extension.ts`(决定是否注册工具路由)与宿主
 * `lib/app/pi-handler.ts`(决定 `/aigc/models` 目录是否含 CF 条目)必须用同一判据 ——
 * 两处若各写一份,漂移时会出现「设置页列得出模型但工具里选不到」或反之的错位。
 *
 * 纯函数、显式收 env 对象,故不破坏本模块「顶层不读 `process.env`」的双入口纪律。
 *
 * 调用方应对 **runtime-resolved** bag 调用(见 {@link resolveCloudflareRuntimeEnv}),
 * 不要只传 `process.env` 而漏掉 `<agentDir>/aigc.json` 里的运行时凭据。
 */
export function isCloudflareConfigured(
  env: Record<string, string | undefined> = {},
): boolean {
  return CLOUDFLARE_REQUIRED_ENV.every((name) => (env[name] ?? "").trim().length > 0);
}

/**
 * aigc.json 中 Cloudflare 凭据字段名(config 域 aigc,运行时读;不 bake 进 payload)。
 * 设置面板已移除这三项(平台改预置 env),此处仅兼容旧版落盘值;
 * 执行层仍用 CLOUDFLARE_* 占位符展开。
 */
export const CLOUDFLARE_AIGC_JSON_KEYS = {
  accountId: "cloudflareAccountId",
  gatewayId: "cloudflareGatewayId",
  apiToken: "cloudflareApiToken",
} as const;

/** 从已解析的 aigc.json 对象抽出 CLOUDFLARE_* 映射(仅非空字符串)。 */
export function cloudflareEnvFromAigcConfig(
  config: Record<string, unknown> | undefined | null,
): Record<string, string> {
  if (config === undefined || config === null) return {};
  const out: Record<string, string> = {};
  const map: readonly (readonly [string, string])[] = [
    [CLOUDFLARE_AIGC_JSON_KEYS.accountId, CLOUDFLARE_CONFIG.accountIdVar],
    [CLOUDFLARE_AIGC_JSON_KEYS.gatewayId, CLOUDFLARE_CONFIG.gatewayIdVar],
    [CLOUDFLARE_AIGC_JSON_KEYS.apiToken, CLOUDFLARE_CONFIG.apiTokenVar],
  ];
  for (const [jsonKey, envKey] of map) {
    const raw = config[jsonKey];
    if (typeof raw === "string" && raw.trim().length > 0) {
      out[envKey] = raw.trim();
    }
  }
  return out;
}

/**
 * 合并运行时 Cloudflare 凭据:显式 `process.env`(或注入 bag)优先,缺省回落 aigc.json。
 *
 * - **不**在模块顶层读文件;每次调用 re-read(由调用方传入已读 config 或用 read 助手)。
 * - 返回新对象,不修改入参。
 */
export function mergeCloudflareRuntimeEnv(
  processEnv: Record<string, string | undefined>,
  aigcConfig: Record<string, unknown> | undefined | null,
): Record<string, string | undefined> {
  const fromFile = cloudflareEnvFromAigcConfig(aigcConfig);
  const merged: Record<string, string | undefined> = { ...processEnv };
  for (const name of CLOUDFLARE_REQUIRED_ENV) {
    const fromEnv = (processEnv[name] ?? "").trim();
    if (fromEnv.length > 0) {
      merged[name] = fromEnv;
      continue;
    }
    const fallback = fromFile[name];
    if (fallback !== undefined) merged[name] = fallback;
  }
  return merged;
}

// ── 响应类型 ──────────────────────────────────────────────────────────────────

interface CloudflareError {
  message?: string;
  code?: number | string;
}

interface CloudflareResp {
  /**
   * 双形态:Unified 为 `{state, result:{image}}`;Workers AI 为 `{image}`。
   * 两者共存于同一字段,故此处并集声明。
   */
  result?: {
    state?: string;
    result?: { image?: string };
    image?: string;
    gatewayMetadata?: { keySource?: string };
  };
  success?: boolean;
  errors?: CloudflareError[];
}

// ── args ─────────────────────────────────────────────────────────────────────

interface CfT2IArgs {
  prompt: string;
  negative_prompt?: string;
  /** "1024x1024" 等,原样透传(CF 侧接受 OpenAI 风格尺寸串)。 */
  size?: string;
  quality?: string;
  output_format?: string;
  n?: number;
}

interface CfEditArgs extends CfT2IArgs {
  /**
   * 输入图数组:首项 = 待编辑主图,其余 = 参考图(风格/角色一致性);
   * 已由编排层 mediaFields 逐项解析为 data URI。
   *
   * ★ 入参契约统一(2026-07-29):原先的 `image`(单数)+ `reference_images` 两字段已合并为
   * 单一 `images` 数组,与工具层 `tools/image-edit.ts` 的 PARAMETER_FIELDS 对齐。对本 provider
   * 而言几乎是直通 —— 发往 CF 的键本来就叫 `input.images`(复数数组、裸 base64),这次只是
   * 「从哪里读」变了,「往上游发什么」一字未改。
   */
  images?: string[];
  /**
   * 可选 B/W / alpha mask。CF `/ai/run` 的 openai/* 编辑协议**没有独立 mask 字段**,
   * 故在 buildEditBody 中把可解析的 mask **插入** `input.images` 第 2 位
   * (主图 → mask → 参考图),并在 prompt 中点明「第 2 张是遮罩」。
   */
  mask?: string;
}

// ── data URI → 裸 base64 ─────────────────────────────────────────────────────

/**
 * `data:image/png;base64,XXXX` → `XXXX`;非 data URI → undefined。
 *
 * CF 的 `input.images` 要的是**裸 base64**(实测),与 Gemini relay 的 `inlineData`
 * (拆成 `{mimeType,data}`)、OpenAI edits 的 multipart 二进制均不同。
 */
function stripDataUri(uri: string): string | undefined {
  const m = /^data:[^;,]+;base64,(.+)$/s.exec(uri);
  return m ? (m[1] as string) : undefined;
}

// ── 裸 base64 → data URI(Workers AI 分支用)──────────────────────────────────

/**
 * 从 base64 头部嗅探图片 MIME。
 *
 * Workers AI 原生模型返回**不带 `data:` 前缀**的裸 base64 且响应中不含 mime 字段
 * (与 Gemini relay 的 `inlineData.mimeType` 不同),故只能按 magic number 的 base64
 * 前缀判定。`/9j/` = JPEG(FF D8 FF);`iVBOR` = PNG(89 50 4E 47);`R0lGOD` = GIF;
 * `UklGR` = WEBP(RIFF)。无法判定时按 png 兜底 —— 浏览器对 img src 的实际解码依赖
 * 字节内容而非声明的 mime,兜错不会导致无法显示。
 */
export function sniffImageMime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

// ── pickResult & detectError ─────────────────────────────────────────────────

/**
 * 双形态取图(Req 3.1/3.2/3.3):
 *  1. `result.result.image` —— Unified 第三方,值为远程 URL,原样透出;
 *  2. `result.image`        —— Workers AI 原生,值为裸 base64,嗅探 MIME 后拼 data URI;
 *  3. 均未命中 → `raw`,由上层判失败(Req 6.3)。
 */
function pickResult(r: unknown): PickedResult {
  const resp = r as CloudflareResp;
  const unified = resp.result?.result?.image;
  if (typeof unified === "string" && unified.length > 0) {
    return { kind: "image", url: unified };
  }
  const workersAi = resp.result?.image;
  if (typeof workersAi === "string" && workersAi.length > 0) {
    // 已是 data URI 的情况原样透出(防御:CF 若某日改为带前缀返回也不会双重拼接)。
    const url = workersAi.startsWith("data:")
      ? workersAi
      : `data:${sniffImageMime(workersAi)};base64,${workersAi}`;
    return { kind: "image", url };
  }
  return { kind: "raw", value: r };
}

/**
 * 业务错误判定(Req 6.1/6.2)。
 *
 * CF 的错误形态为 `{errors:[{message,code}],success:false,result:{}}`(实测:未知模型
 * → HTTP 404 + code 7003)。`code` 一并透出,使「模型不存在」与「凭据无效/权限不足」
 * 在用户侧可区分。
 */
function detectError(r: unknown): string | undefined {
  const resp = r as CloudflareResp;
  const errs = resp.errors ?? [];
  if (errs.length > 0) {
    return errs
      .map((e) => {
        const msg = e.message ?? "unknown error";
        return e.code !== undefined ? `${msg} (code ${e.code})` : msg;
      })
      .join("; ");
  }
  if (resp.success === false) return "Cloudflare AI Gateway 调用失败(success=false)";
  // Unified 分支带 state;非 Completed 视为未产出成品。
  const state = resp.result?.state;
  if (typeof state === "string" && state !== "Completed") {
    return `Cloudflare 任务未完成:state=${state}`;
  }
  return undefined;
}

// ── buildBody ────────────────────────────────────────────────────────────────

/** 负向提示无原生字段,照既有 provider 惯例并入正文。 */
function withNegative(a: CfT2IArgs): string {
  return a.negative_prompt ? `${a.prompt}\n\nAvoid: ${a.negative_prompt}` : a.prompt;
}

/** 公共 input 字段(仅在有值时落键,避免向 CF 发 undefined)。 */
function baseInput(a: CfT2IArgs): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: withNegative(a) };
  if (a.size) input.size = a.size;
  if (a.quality) input.quality = a.quality;
  if (a.output_format) input.output_format = a.output_format;
  if (typeof a.n === "number") input.n = a.n;
  return input;
}

function buildT2IBody(providerModel: string) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as CfT2IArgs;
    return { model: providerModel, input: baseInput(a) };
  };
}

/**
 * 编辑请求体:参考图经 **`input.images` 复数数组**提交,值为裸 base64。
 *
 * ★ **与 gemini-relay 刻意不同的失败策略**(Req 2.3,design.md D3):
 * `gemini-relay.buildEditBody` 对无法解析的参考图**静默跳过**——在 Gemini 上退化成纯文本
 * 请求会被模型自身以拒答/追问的形式暴露出来,不会伪装成功。
 *
 * 但 CF 不然(2026-07-29 实测):向 `input` 传单数 `image` 字段或压根不传图,网关会**静默
 * 忽略**并按文生图执行,返回 HTTP 200 + 一张与参考图无关的新图。这是最危险的失败模式
 * ——看起来完全成功。故此处在一张图都提取不到时**抛错且不产出请求体**,把伪成功挡在
 * 发请求之前。
 *
 * **mask**:CF openai/gpt-image-* 无独立 mask 参数。有 mask 时插入 `images` 第 2 位
 * (主图 → mask → 其余参考图),并对 prompt 加局部重绘提示,使模型把第 2 张当遮罩。
 */
function buildEditBody(providerModel: string) {
  return async (args: Record<string, unknown>, _ctx?: BuildBodyContext): Promise<unknown> => {
    const a = args as unknown as CfEditArgs;
    const images: string[] = [];
    // 入参契约统一后单一来源:imgs[0] 主图、imgs.slice(1) 参考图 —— 但 CF 侧本就按同一数组
    // 承载(顺序即语义,首项为待编辑图),故无需拆分,顺序遍历即可。
    for (const uri of a.images ?? []) {
      if (!uri) continue;
      const b64 = stripDataUri(uri);
      if (b64) images.push(b64);
    }
    // mask → 插入 images 第 2 位(主图之后、参考图之前);无法解析则跳过,不挡主图编辑。
    let maskInserted = false;
    if (typeof a.mask === "string" && a.mask.length > 0 && images.length > 0) {
      const maskB64 = stripDataUri(a.mask);
      if (maskB64) {
        images.splice(1, 0, maskB64);
        maskInserted = true;
      }
    }
    if (images.length === 0) {
      throw new Error(
        "Cloudflare 图像编辑需要至少一张参考图,但未能从入参解析出任何图像数据。" +
          "(直接发起请求会被网关按文生图执行并返回一张无关的新图,故在此拦截)",
      );
    }
    const input = baseInput(a);
    // 有 mask 时点明「第 2 张图是遮罩、白色/透明区域为重绘区」(对齐 dashscope 语义)。
    // 在 withNegative 之后的正文上加前缀,保留 negative_prompt 并入结果。
    if (maskInserted) {
      const body = typeof input.prompt === "string" ? input.prompt : a.prompt;
      input.prompt =
        `The second image is a mask for the first image: white or transparent regions ` +
        `are areas to repaint; black or opaque regions must be preserved. ` +
        `Apply this edit only to the masked region: ${body}`;
    }
    return { model: providerModel, input: { ...input, images } };
  };
}

// ── 公开工厂 ─────────────────────────────────────────────────────────────────

function runUrl(cfg: CloudflareConfig): string {
  return `https://api.cloudflare.com/client/v4/accounts/\${${cfg.accountIdVar}}/ai/run`;
}

function baseRoute(
  cfg: CloudflareConfig,
  args: CloudflareModelArgs,
): Omit<ImageRoute, "buildBody"> {
  return {
    model: args.model,
    label: args.label,
    description: args.description,
    provider: cfg.provider,
    method: "POST",
    url: runUrl(cfg),
    headers: {
      authorization: `Bearer \${${cfg.apiTokenVar}}`,
      "cf-aig-gateway-id": `\${${cfg.gatewayIdVar}}`,
    },
    // ★ 可选出站代理(与 openrouter 的 `${OPENROUTER_PROXY}` 同款):未配置该 env 时
    // `resolveVarsOptional` 得 undefined → 走直连,行为不变;配置后经 proxyFetch 出站。
    //
    // 为什么需要:`api.cloudflare.com` 与产出图所在的 `*.r2.cloudflarestorage.com` 在部分
    // 网络下**直连超时**(实测 `connect ETIMEDOUT 172.64.66.1:443`)。curl 能通是因为它读
    // `HTTPS_PROXY` 环境变量,而 node 的 undici fetch **默认不读** —— 所以「curl 成功、
    // 应用失败」并不矛盾,必须由路由显式声明代理。
    proxy: "${CLOUDFLARE_PROXY}",
    // 三者缺一即工具降级(Req 5.2):不提供该模型,而非调用时才失败。
    // 注:代理是可选项,不进 requiredVars —— 否则未配代理的环境会整体拿不到该 provider。
    requiredVars: [cfg.accountIdVar, cfg.gatewayIdVar, cfg.apiTokenVar],
    pickResult,
    detectError,
  };
}

/** 创建 Cloudflare 文生图路由项(走 `/accounts/{id}/ai/run`)。 */
export function createCloudflareImage(
  args: CloudflareModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return {
    ...baseRoute(CLOUDFLARE_CONFIG, args),
    buildBody: buildT2IBody(args.providerModel ?? args.model),
    ...extras,
  };
}

/** 创建 Cloudflare 图像编辑路由项(同端点,输入图经 `input.images` 提交)。 */
export function createCloudflareImageEdit(
  args: CloudflareModelArgs,
  extras: Partial<ImageRoute> = {},
): ImageRoute {
  return {
    ...baseRoute(CLOUDFLARE_CONFIG, args),
    buildBody: buildEditBody(args.providerModel ?? args.model),
    ...extras,
  };
}
