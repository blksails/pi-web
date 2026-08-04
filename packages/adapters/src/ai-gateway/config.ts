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
export const AI_GATEWAY_BASE_URL_ENV = "BLKSAILS_GATEWAY_BASE_URL";

/**
 * 旧名(存量部署兼容):新名未设时回落读取。
 *
 * ★为什么改名:`AI_GATEWAY_API_KEY` 是 pi-ai SDK 内建 Vercel AI Gateway 的凭据 env。
 * 本服务端进程 spawn 的 pi 子进程会**继承**宿主 env,故宿主设旧名等于把 Vercel 凭据
 * 塞进 pi——全部模型调用被劫持(pi-clouds 8.2 真机事故)。base URL 一并改名保持成对。
 */
export const AI_GATEWAY_BASE_URL_ENV_LEGACY = "AI_GATEWAY_BASE_URL";

/** 请求超时覆盖(毫秒)环境变量名;未设置时用 {@link DEFAULT_TIMEOUT_MS}。 */
export const AI_GATEWAY_TIMEOUT_MS_ENV = "AI_GATEWAY_TIMEOUT_MS";

/** 模型目录 TTL 覆盖(毫秒)环境变量名;未设置时用 {@link DEFAULT_CATALOG_TTL_MS}。 */
export const AI_GATEWAY_CATALOG_TTL_MS_ENV = "AI_GATEWAY_CATALOG_TTL_MS";

/** 同名模型优先级环境变量名;未设置时默认 `"gateway"`。 */
export const AI_GATEWAY_MODEL_PRECEDENCE_ENV = "PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE";

/** 上游归属白名单环境变量名(逗号分隔);未设置时用 {@link DEFAULT_PROVIDER_ALLOWLIST}。 */
export const AI_GATEWAY_PROVIDER_ALLOWLIST_ENV = "PI_WEB_AI_GATEWAY_PROVIDER_ALLOWLIST";

/**
 * 内置默认白名单(spec `cloudflare-chat-provider` Req 2.2)。
 *
 * 依据 2026-07-29 对 Cloudflare AI Gateway 的实测目录分布(共 2465 条):
 * openrouter 1067 / openai 215 / aws-bedrock 163 / azure-openai 141 /
 * google-ai-studio 133 / anthropic 122 / …
 *
 * ★刻意**排除 openrouter** —— 它是聚合型上游,一家就占 43%,且其条目与 openai /
 * anthropic 等直连厂商大量重复覆盖,放进选择器只会制造噪声。保留三家主流直连厂商;
 * 部署方需要更多(如 aws-bedrock / workers-ai)时经 env 覆盖。
 */
export const DEFAULT_PROVIDER_ALLOWLIST: readonly string[] = [
  "anthropic",
  "openai",
  "google-ai-studio",
];

/**
 * 解析逗号分隔的归属白名单。
 *
 * ★空白值**回落默认**而非解释为「全部滤除」:后者会让部署方对着一个空模型清单
 * 束手无策,而这几乎总是误配(如 `EXPORT VAR=` 写成空)而非本意。真要全部滤除,
 * 应通过配置一个不存在的归属名达成,那是显式意图。
 *
 * ★导出给 {@link ./instances.js resolveGatewayInstances} 复用(spec
 * multi-gateway-providers 任务 3.1)——多实例的每实例 `_ALLOWLIST` 覆盖与本模块的单实例
 * 白名单解析共用同一「空白回落默认」语义。
 */
export function parseProviderAllowlist(raw: string | undefined): ReadonlySet<string> {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return new Set(items.length > 0 ? items : DEFAULT_PROVIDER_ALLOWLIST);
}

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
  /**
   * 允许纳入模型清单的上游归属(目录条目的 `owned_by`),用于收敛庞大网关目录。
   * env `PI_WEB_AI_GATEWAY_PROVIDER_ALLOWLIST`;未配置时为 {@link DEFAULT_PROVIDER_ALLOWLIST}。
   */
  readonly providerAllowlist: ReadonlySet<string>;
}

/** 装配期配置不合法时抛出的错误(fail-fast,Req 1.4)。 */
export class AiGatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiGatewayConfigError";
  }
}

/**
 * 把实例标识规整为可嵌入 env 名的形态:大写、`-` → `_`
 * (与既有 `PI_LLM_TOKEN_<ID>` 的派生规则同构)。
 *
 * ★下沉为独立导出(spec multi-gateway-providers 任务 3.5,Req 1.1/6.2/6.5):
 * 部署侧(`instanceEnvPrefix`,下方)与会话侧(`session-model-source.ts` 的
 * `PI_WEB_AI_GATEWAY_SESSION_<ID>_*`)两套 env 前缀字面量不同,但"标识如何变形"
 * 这条规则必须**同一处定义**——否则两侧对同一实例标识可能派生出不一致的 env 名。
 */
export function envSafeInstanceId(id: string): string {
  return id.toUpperCase().replace(/-/g, "_");
}

/**
 * 派生某网关实例的 env 前缀:`PI_WEB_GATEWAY_<ID>_`,`<ID>` = {@link envSafeInstanceId}。
 *
 * ★下沉到本模块(而非留在 `instances.ts` 私有)供 {@link ./key-resolver.js
 * InstanceEnvKeyResolver} 复用(spec multi-gateway-providers 任务 3.3,Req 1.5)——
 * `instances.ts` 与 `key-resolver.ts` 互相需要对方的类型/类,放在二者共同的上游
 * `config.ts` 可避免循环导入,同时保证两处对同一实例标识派生出**同一个** env 名。
 */
export function instanceEnvPrefix(id: string): string {
  return `PI_WEB_GATEWAY_${envSafeInstanceId(id)}_`;
}

/**
 * 剥离 URL 尾部斜杠。
 *
 * ★导出给 {@link ./instances.js resolveGatewayInstances} 复用(spec
 * multi-gateway-providers 任务 3.1)——多实例的每实例 base URL 校验与本模块的单实例
 * 校验共用同一实现,避免两处各写一份、行为随时间漂移。
 */
export function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 校验并归一化一个网关 base URL:非法 URL / 非 http(s) 协议 → 抛
 * {@link AiGatewayConfigError}(含 `envName` 便于调用方按场景定制字段提示);
 * 合法 → 返回剥离尾斜杠后的值。
 *
 * ★导出给 {@link ./instances.js resolveGatewayInstances} 复用,使单实例与多实例的
 * base URL 合法性判据(协议、格式)逐字一致(spec multi-gateway-providers 任务 3.1)。
 */
export function parseAndValidateBaseUrl(raw: string, envName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AiGatewayConfigError(
      `${envName} 不是合法的 URL:"${raw}"。请改正为合法的 http/https 地址,或移除该环境变量以关闭 ai-gateway 套件。`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AiGatewayConfigError(
      `${envName} 必须是 http:// 或 https:// 地址,实际协议为 "${parsed.protocol}"(值:"${raw}")。`,
    );
  }
  return stripTrailingSlashes(raw);
}

const ModelPrecedenceSchema = z.enum(["gateway", "self"]);

/**
 * 解析一个正整数覆盖值;缺省/空白返回 `undefined`;存在但非法 → 抛错(含字段名)。
 *
 * ★导出给 {@link ./instances.js resolveGatewayInstances} 复用(spec
 * multi-gateway-providers 任务 3.1)——多实例的每实例 TTL / 超时覆盖与本模块的单实例
 * 覆盖共用同一校验规则与错误文案形态。
 */
export function parsePositiveIntOverride(
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
 * - `BLKSAILS_GATEWAY_BASE_URL`(旧名 `AI_GATEWAY_BASE_URL` 回落)未设置/空白 →
 *   `undefined`(套件整体不注册)。
 * - base URL 非法(解析失败或非 http/https 协议)→ 抛
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
  // 新名优先,旧名回落(存量部署);两者都未设 → 套件整体不注册。
  const rawBaseUrl =
    env[AI_GATEWAY_BASE_URL_ENV]?.trim() ||
    env[AI_GATEWAY_BASE_URL_ENV_LEGACY]?.trim();
  if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
    return undefined;
  }

  const baseUrl = parseAndValidateBaseUrl(rawBaseUrl, AI_GATEWAY_BASE_URL_ENV);

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
    baseUrl,
    timeoutMs,
    catalogTtlMs,
    modelPrecedence,
    providerAllowlist: parseProviderAllowlist(env[AI_GATEWAY_PROVIDER_ALLOWLIST_ENV]),
  };
}
