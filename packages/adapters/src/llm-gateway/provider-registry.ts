/**
 * llm-gateway · provider 登记表(design.md ProviderRegistry,Req 3.1)。
 *
 * providerId → `{ upstreamBase, keyEnvCandidates }` 的登记表:内置一份覆盖仓内已知
 * provider 的静态表,运维可经 `PI_WEB_LLM_GATEWAY_PROVIDERS`(JSON)同名覆盖已登记项或
 * 追加新 provider——装配期以 zod 解析并 fail-fast(非法 JSON/不符 schema 直接抛清晰错误,
 * 不静默吞掉)。
 *
 * ⚠️ upstreamBase 一律取各 provider 的 **OpenAI 兼容(主对话 chat/completions)端点**——
 * LLM 网关服务的是主对话(scope=llm:<provider>)。**尤其 dashscope 为
 * `.../compatible-mode/v1`(主对话),不是 `.../api/v1`**;后者是 dashscope 原生多模态
 * 端点,由本仓 AIGC 图像工具(`packages/tool-kit/src/aigc/providers/dashscope.ts` 的
 * `${DASHSCOPE_BASE_URL:-…/api/v1}` 占位符)使用,**不经本网关**。已摘除的 aigc-proxy
 * 服务 AIGC 图像、用 api/v1,故本表不可照抄其端点(端点分叉见 BUILTIN_PROVIDER_TABLE 注释)。
 * 其余 provider(openrouter/anthropic/openai/google/mistral)以 `lib/app/config.ts` 的
 * `PROVIDER_KEY_NAMES` key 名 + 各官方 OpenAI 兼容 API base 为准。
 *
 * 请求期(2.2/2.3 任务)按 `keyEnvCandidates` 顺序从宿主 `process.env` 即时读取真实 key,
 * 不在本模块缓存(换 key 即时生效)。
 */
import { z } from "zod";

/** 内置/覆盖后 provider 登记表的单条目。 */
export interface LlmGatewayProviderEntry {
  /** 上游 base URL(不含尾斜杠)。 */
  readonly upstreamBase: string;
  /** 宿主进程持有真实 key 的候选环境变量名,按序尝试,皆缺视为无凭据。 */
  readonly keyEnvCandidates: readonly string[];
}

/** providerId → 登记条目 的只读表。 */
export type LlmGatewayProviderTable = Readonly<Record<string, LlmGatewayProviderEntry>>;

/** 装配期 JSON 覆盖/追加解析失败时抛出的错误类型(fail-fast)。 */
export class LlmGatewayProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmGatewayProviderConfigError";
  }
}

/** 覆盖/追加 env 的名字。 */
export const LLM_GATEWAY_PROVIDERS_ENV = "PI_WEB_LLM_GATEWAY_PROVIDERS";

/** token env 名前缀。 */
const TOKEN_ENV_PREFIX = "PI_LLM_TOKEN_";

/**
 * 内置 provider 登记表(design.md 内置表,Req 3.1)。
 *
 * ★端点语义:LLM 网关服务的是**主对话**(scope=llm:<provider>),故 upstreamBase 一律取
 * 各 provider 的 **OpenAI 兼容(chat/completions)端点**,而非其 AIGC/原生多模态端点。
 * 这与已摘除的 aigc-proxy(服务 AIGC 图像工具、用原生端点)刻意区分——不可再照抄其端点。
 * 分叉点仅 dashscope:主对话走 `.../compatible-mode/v1`,AIGC 图像走 `.../api/v1`
 * (后者由 tool-kit `${DASHSCOPE_BASE_URL:-…/api/v1}` 占位符承载,不经本网关)。
 * newapi/sufy 是 OpenAI 兼容聚合网关,主对话与 AIGC 共用同一 base,无分叉。
 */
const BUILTIN_PROVIDER_TABLE: LlmGatewayProviderTable = {
  newapi: {
    upstreamBase: "https://www.apiservices.top/v1",
    keyEnvCandidates: ["NEWAPI_API_KEY", "APISERVICES_API_KEY"],
  },
  sufy: {
    upstreamBase: "https://openai.sufy.com/v1",
    keyEnvCandidates: ["SUFY_API_KEY"],
  },
  dashscope: {
    // 主对话=OpenAI 兼容端点 compatible-mode/v1(非 AIGC 原生 api/v1)。部署若用
    // token-plan 等 NewAPI 代理,经 PI_WEB_LLM_GATEWAY_PROVIDERS 覆盖此默认。
    upstreamBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyEnvCandidates: ["DASHSCOPE_API_KEY"],
  },
  openrouter: {
    upstreamBase: "https://openrouter.ai/api/v1",
    keyEnvCandidates: ["OPENROUTER_API_KEY"],
  },
  anthropic: {
    upstreamBase: "https://api.anthropic.com",
    keyEnvCandidates: ["ANTHROPIC_API_KEY"],
  },
  openai: {
    upstreamBase: "https://api.openai.com/v1",
    keyEnvCandidates: ["OPENAI_API_KEY"],
  },
  google: {
    upstreamBase: "https://generativelanguage.googleapis.com",
    keyEnvCandidates: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  },
  mistral: {
    upstreamBase: "https://api.mistral.ai/v1",
    keyEnvCandidates: ["MISTRAL_API_KEY"],
  },
};

/** 单条覆盖/追加条目的 zod schema:`upstreamBase` 非空字符串、`keyEnvCandidates` 非空字符串数组。 */
const ProviderEntrySchema = z.object({
  upstreamBase: z.string().min(1),
  keyEnvCandidates: z.array(z.string().min(1)).min(1),
});

/** `PI_WEB_LLM_GATEWAY_PROVIDERS` 整体 schema:`Record<providerId, entry>`。 */
const ProvidersOverrideSchema = z.record(z.string().min(1), ProviderEntrySchema);

/**
 * 解析 `PI_WEB_LLM_GATEWAY_PROVIDERS`(JSON)并与内置表合并:同名覆盖、新名追加。
 *
 * 装配期 fail-fast:env 存在但不是合法 JSON,或不符 schema,直接抛
 * `LlmGatewayProviderConfigError`(不静默吞错、不回退空表)。
 *
 * @param env 环境变量来源(默认 `process.env`,便于测试注入)。
 */
export function resolveLlmGatewayProviderTable(
  env: NodeJS.ProcessEnv = process.env,
): LlmGatewayProviderTable {
  const raw = env[LLM_GATEWAY_PROVIDERS_ENV];
  if (raw === undefined || raw.trim() === "") {
    return BUILTIN_PROVIDER_TABLE;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new LlmGatewayProviderConfigError(
      `${LLM_GATEWAY_PROVIDERS_ENV} is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = ProvidersOverrideSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new LlmGatewayProviderConfigError(
      `${LLM_GATEWAY_PROVIDERS_ENV} does not match the expected schema: ${issues}`,
    );
  }

  return { ...BUILTIN_PROVIDER_TABLE, ...result.data };
}

/**
 * 按 providerId 查表(在给定/装配好的登记表中)。未登记返回 `undefined`,不抛——由调用方
 * (网关路由,2.2 任务)据此短路映射 404。
 */
export function lookupLlmGatewayProvider(
  table: LlmGatewayProviderTable,
  providerId: string,
): LlmGatewayProviderEntry | undefined {
  return Object.prototype.hasOwnProperty.call(table, providerId)
    ? table[providerId]
    : undefined;
}

/**
 * 派生 providerId → token env 名:`PI_LLM_TOKEN_` + providerId 大写、`-` → `_`。
 *
 * 例:`newapi` → `PI_LLM_TOKEN_NEWAPI`;`google-vertex` → `PI_LLM_TOKEN_GOOGLE_VERTEX`。
 */
export function llmGatewayTokenEnvName(providerId: string): string {
  return `${TOKEN_ENV_PREFIX}${providerId.toUpperCase().replace(/-/g, "_")}`;
}
