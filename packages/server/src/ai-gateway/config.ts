/**
 * ai-gateway · 装配期配置解析(design.md §2.1,Req 1.1/1.2/1.4)。
 *
 * 单一判别项:`AI_GATEWAY_BASE_URL`。未设置(缺省/空白) → 返回 `undefined`,套件的
 * 任何路由/目录项均不注册(零侵入,Req 1.2)。设置但不合法(非法 URL、`PI_WEB_
 * AI_GATEWAY_MODEL_PRECEDENCE` 取值不在枚举内、TTL 覆盖值非正整数)→ 抛
 * `AiGatewayConfigError`(fail-fast,含字段名,Req 1.4),不静默降级、不吞错。
 *
 * 是否真正"可用"(KeyResolver 能解析出凭据)由装配处另行判定(Req 1.1),本模块只负责
 * 纯配置解析,不触达 KeyResolver。
 */
import { z } from "zod";

/** 网关 base URL 环境变量名(唯一启用判别项)。 */
export const AI_GATEWAY_BASE_URL_ENV = "AI_GATEWAY_BASE_URL";

/** 请求超时覆盖(毫秒)环境变量名;未设置时用 {@link DEFAULT_TIMEOUT_MS}。 */
export const AI_GATEWAY_TIMEOUT_MS_ENV = "AI_GATEWAY_TIMEOUT_MS";

/** 模型目录 TTL 覆盖(毫秒)环境变量名;未设置时用 {@link DEFAULT_CATALOG_TTL_MS}。 */
export const AI_GATEWAY_CATALOG_TTL_MS_ENV = "AI_GATEWAY_CATALOG_TTL_MS";

/** 同名模型优先级环境变量名;未设置时默认 `"gateway"`。 */
export const AI_GATEWAY_MODEL_PRECEDENCE_ENV = "PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE";

/** 默认请求超时(毫秒)。长 SSE 由流式空闲控制,这里只是转发单次上游请求的兜底上限。 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 默认模型目录 TTL(毫秒)。 */
export const DEFAULT_CATALOG_TTL_MS = 300_000;

/** 解析后的 ai-gateway 套件配置。 */
export interface AiGatewayConfig {
  /** 网关 base URL(不含尾斜杠),来自 `AI_GATEWAY_BASE_URL`。 */
  readonly baseUrl: string;
  /** 请求超时毫秒;默认 {@link DEFAULT_TIMEOUT_MS}。 */
  readonly timeoutMs?: number;
  /** 模型目录 TTL 毫秒;默认 {@link DEFAULT_CATALOG_TTL_MS}。 */
  readonly catalogTtlMs: number;
  /** 同名模型优先级;默认 `"gateway"`。env `PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE`。 */
  readonly modelPrecedence: "gateway" | "self";
}

/** 装配期配置不合法时抛出的错误(fail-fast,Req 1.4)。 */
export class AiGatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiGatewayConfigError";
  }
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

const ModelPrecedenceSchema = z.enum(["gateway", "self"]);

/** 解析一个正整数覆盖值;缺省/空白返回 `undefined`;存在但非法 → 抛错(含字段名)。 */
function parsePositiveIntOverride(
  raw: string | undefined,
  fieldName: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AiGatewayConfigError(
      `${fieldName}(env ${fieldName})必须是正整数(毫秒),实际值:"${raw}"。`,
    );
  }
  return n;
}

/**
 * 装配期解析 ai-gateway 套件配置(design.md §2.1,Req 1.1/1.2/1.4)。
 *
 * - `AI_GATEWAY_BASE_URL` 未设置/空白 → `undefined`(套件整体不注册)。
 * - `AI_GATEWAY_BASE_URL` 非法 URL(解析失败或非 http/https 协议)→ 抛
 *   `AiGatewayConfigError`(含字段名)。
 * - `PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE` 存在但不在 `"gateway" | "self"` 枚举内 → 抛
 *   `AiGatewayConfigError`(含字段名与合法枚举提示)。
 * - `AI_GATEWAY_TIMEOUT_MS` / `AI_GATEWAY_CATALOG_TTL_MS` 存在但非正整数 → 抛
 *   `AiGatewayConfigError`。
 *
 * @param env 环境变量来源(装配处传 `process.env`;便于测试注入)。
 */
export function resolveAiGatewayConfig(
  env: NodeJS.ProcessEnv,
): AiGatewayConfig | undefined {
  const rawBaseUrl = env[AI_GATEWAY_BASE_URL_ENV]?.trim();
  if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new AiGatewayConfigError(
      `${AI_GATEWAY_BASE_URL_ENV} 不是合法的 URL:"${rawBaseUrl}"。请改正为合法的 http/https 地址,或移除该环境变量以关闭 ai-gateway 套件。`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AiGatewayConfigError(
      `${AI_GATEWAY_BASE_URL_ENV} 必须是 http:// 或 https:// 地址,实际协议为 "${parsed.protocol}"(值:"${rawBaseUrl}")。`,
    );
  }

  const rawPrecedence = env[AI_GATEWAY_MODEL_PRECEDENCE_ENV]?.trim();
  let modelPrecedence: "gateway" | "self" = "gateway";
  if (rawPrecedence !== undefined && rawPrecedence.length > 0) {
    const result = ModelPrecedenceSchema.safeParse(rawPrecedence);
    if (!result.success) {
      throw new AiGatewayConfigError(
        `${AI_GATEWAY_MODEL_PRECEDENCE_ENV} 取值不合法:"${rawPrecedence}"。合法取值为 "gateway" 或 "self"。`,
      );
    }
    modelPrecedence = result.data;
  }

  const timeoutMs =
    parsePositiveIntOverride(env[AI_GATEWAY_TIMEOUT_MS_ENV], AI_GATEWAY_TIMEOUT_MS_ENV) ??
    DEFAULT_TIMEOUT_MS;
  const catalogTtlMs =
    parsePositiveIntOverride(
      env[AI_GATEWAY_CATALOG_TTL_MS_ENV],
      AI_GATEWAY_CATALOG_TTL_MS_ENV,
    ) ?? DEFAULT_CATALOG_TTL_MS;

  return {
    baseUrl: stripTrailingSlashes(rawBaseUrl),
    timeoutMs,
    catalogTtlMs,
    modelPrecedence,
  };
}
