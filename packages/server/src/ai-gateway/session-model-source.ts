/**
 * ai-gateway · 会话侧模型来源(spec ai-gateway-session-models,design.md §D1/D2,
 * Req 1.1/2.4/3.2)。
 *
 * 目录侧(`model-catalog.ts`)只让网关模型**可见**;本模块让它们**可用** —— 在 runner 侧把网关
 * 注册为 pi SDK 会话的内存 provider,使 `registry.find("ai-gateway", <id>)` 可解析,
 * 否则会话构造时 `resolveModel` 直接抛「模型未找到」。
 *
 * 范式完全沿用 `auth/egress-model-source.ts`(desktop-cloud-login):
 * `ModelRegistry.inMemory` + `registerProvider` —— **纯内存零落盘**,不写 `models.json`、
 * 不改 agentDir。网关目录是 TTL 刷新的动态数据,落盘只会产生漂移。
 *
 * ★ env 命名硬约束(design.md §D1):新 env 一律用 `PI_WEB_AI_GATEWAY_SESSION_*` 前缀。
 * **绝不可**沿用 `AI_GATEWAY_API_KEY` —— 该名会被 spawn 的 pi 子进程继承并被 pi-ai 当作
 * Vercel AI Gateway 官方凭据,劫持**全部**模型调用返回 401(pi-clouds 8.2 事故;
 * 另见 `key-resolver.ts:40` 与 `config.ts` 的 LEGACY 注释)。
 *
 * ★ provider 命名空间 `ai-gateway` 必须与 `mergeModelCatalog` 产出的 `provider` 字段
 * **逐字一致**(design.md Revalidation Trigger),否则前端选中的条目在 registry 里查不到。
 * 另需确保不与 `<agentDir>/auth.json` 已有 provider 撞名,否则 auth.json 的 key 会
 * **覆盖**本 provider 的 apiKey(pi SDK `getApiKeyAndHeaders` 顺序)→ 静默 401。
 */
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

/** runner 侧读取的网关基址 env(已含 `/v1`)。跨进程契约。 */
export const RUNNER_AI_GATEWAY_BASE_ENV = "PI_WEB_AI_GATEWAY_SESSION_BASE";
/** runner 侧读取的网关凭据 env。跨进程契约。 */
export const RUNNER_AI_GATEWAY_KEY_ENV = "PI_WEB_AI_GATEWAY_SESSION_KEY";
/** runner 侧读取的模型 id 清单 env(JSON 字符串数组)。跨进程契约。 */
export const RUNNER_AI_GATEWAY_MODELS_ENV = "PI_WEB_AI_GATEWAY_SESSION_MODELS";

/**
 * 网关 provider 命名空间。
 *
 * ★与 `mergeModelCatalog` 中 `provider: "ai-gateway"` 同源 —— 两处任一改动都必须同步,
 * 否则清单里的条目在 registry 中查不到(表现为「选了就报模型未找到」)。
 */
// 常量下沉到中立模块(spec kernel-boundary-decoupling 任务 4.2):runner 的失败文案分化
// 需要认得这个命名空间,从本模块引入会制造 runner → adapters 的跨层边。此处原样 re-export,
// 既有消费方零改动。
import { AI_GATEWAY_PROVIDER_NAME } from "../model-provider-names.js";
export { AI_GATEWAY_PROVIDER_NAME };

/** 网关为 OpenAI 兼容出口(CF `/compat` 已实测),provider/model 的 api 固定于此。 */
const AI_GATEWAY_API = "openai-completions";

/**
 * 模型元数据缺省值。
 *
 * 网关目录只提供 `id`/`owned_by`/`cost_*`,没有 contextWindow / maxTokens / 多模态能力。
 * 与 egress 来源同惯例取保守缺省 —— 这些值影响本地截断策略而非上游行为。
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * 网关模型的兼容性设置。
 *
 * ★由端到端实测揪出(2026-07-29):pi SDK 的 `openai-completions` 默认发 `max_tokens`,
 * 而 OpenAI 推理模型(gpt-5 / gpt-5.5 系)**拒收**该参数 ——
 *
 * ```
 * Unsupported parameter: 'max_tokens' is not supported with this model.
 * Use 'max_completion_tokens' instead.
 * ```
 *
 * 症状具有迷惑性:assistant 消息 `content` 为空数组、`stopReason: "error"`,
 * 服务端无日志 —— 看起来像超时或凭据问题,实为参数名不兼容。
 *
 * 三家上游经网关**实调确认均接受** `max_completion_tokens`
 * (anthropic/claude-opus-5、google-ai-studio/gemini-2.5-flash、openai/gpt-5.5
 * 各返回正常内容),故统一设置而非按模型分支 —— 靠 id 猜「哪些是推理模型」
 * 是脆弱启发式,且上游随时会加新型号。
 */
const GATEWAY_MODEL_COMPAT = {
  maxTokensField: "max_completion_tokens",
} as const;

/**
 * 明确不可用于会话的模型 id 后缀(spec ai-gateway-session-models Req 4.1,任务 4.1)。
 *
 * ★判据由**实测统计**得出,不是凭印象。2026-07-29 对 Cloudflare AI Gateway 目录
 * (2465 条,白名单收敛后 470 条)统计,含冒号者 68 条,后缀分布:
 *
 * ```
 * :batch 25 · :free 20 · :beta 14 · :thinking 3 · :extended/:nitro/:exacto 各 1
 * ```
 *
 * 故 design.md §D4 预设的两个分支(「全为 API 变体 → 排除含冒号者」/「存在正常模型 →
 * 放弃收敛」)**都不成立** —— `:free`/`:beta`/`:thinking` 等是正常对话模型的路由后缀,
 * 一刀切会误伤 43 条合法模型。落更窄的规则:只排除形态确定的 `:batch`。
 *
 * `:batch` 是批处理 API 变体,需另一套凭据 —— `cloudflare-chat-provider` 端到端已实测
 * 撞上 `openai/gpt-4-turbo:batch` → 401。provider 级白名单收不掉它(`owned_by` 与
 * 对话模型相同)。
 *
 * **不在此列的其他不可对话条目**(embedding / tts / whisper / moderation)仍留待后续:
 * 判定它们需要能力元数据,而网关目录只给 `id`/`owned_by`/`cost_*`,靠 id 模式匹配是
 * 脆弱启发式,容易误伤。用户若选中,由 `option-mapper` 的来源提示与文档承担(Req 4.2)。
 */
const NON_SESSION_ID_SUFFIXES = [":batch"] as const;

/**
 * 该网关模型 id 是否可用于会话。
 *
 * 供 `mergeModelCatalog`(前端清单)与装配层(spawn env 清单)**共用同一判据** ——
 * 两侧若漂移,就会出现「列表里看得到、选中却说模型未找到」的错位。
 */
export function isSessionCapableGatewayModel(id: string): boolean {
  return !NON_SESSION_ID_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

/** 解析所得的网关会话来源。 */
export interface AiGatewaySessionSpec {
  /** OpenAI 兼容根,**已含** `/v1`(如 `…/compat/v1`)。 */
  readonly baseUrl: string;
  /** 网关凭据(本地信任边界内,同 `config.providerKeys`;见 design.md §D1)。 */
  readonly apiKey: string;
  /** 可用模型 id 清单(可含斜杠,如 `anthropic/claude-opus-5`)。 */
  readonly modelIds: readonly string[];
}

/** 最小日志出口(测试可注入以断言可观测性且不泄露凭据)。 */
export interface AiGatewaySessionLogger {
  info(msg: string, data?: Record<string, unknown>): void;
}

function parseModelIds(raw: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 非法 JSON 不抛:配置异常不该打断本地会话路径(与 egress 同惯例)。
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const ids = parsed.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return ids.map((s) => s.trim());
}

/**
 * 从 runner 自身 env 解析网关会话来源。
 *
 * 任一 env 缺失/空白、模型清单 JSON 非法、或清单为空 → `undefined`(视为未启用,
 * runner 走 SDK 默认)。**不抛** —— 网关配置异常不该让本地会话起不来。
 */
export function resolveAiGatewaySessionSpecFromEnv(
  env: NodeJS.ProcessEnv,
): AiGatewaySessionSpec | undefined {
  const baseUrl = env[RUNNER_AI_GATEWAY_BASE_ENV]?.trim();
  const apiKey = env[RUNNER_AI_GATEWAY_KEY_ENV]?.trim();
  const rawModels = env[RUNNER_AI_GATEWAY_MODELS_ENV]?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) return undefined;
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  if (rawModels === undefined || rawModels.length === 0) return undefined;

  const modelIds = parseModelIds(rawModels);
  // 空清单 → 不注册:一个没有模型的 provider 无意义,注册了只会让 find 徒劳失败。
  if (modelIds === undefined || modelIds.length === 0) return undefined;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, modelIds };
}

/**
 * 把网关来源注册进给定注册表。
 *
 * 与 egress 来源共用**同一个** registry(design.md §D2),故本函数只做 `registerProvider`,
 * 不自建 registry —— 两个来源必须共存,谁自建谁就会顶掉对方。
 *
 * @param logger 可选;注册后记一条含 provider 名与条目数的 info(Req 7.1)。
 *   ★绝不记 `spec.apiKey`。
 */
export function registerAiGatewayProvider(
  registry: ModelRegistry,
  spec: AiGatewaySessionSpec,
  logger?: AiGatewaySessionLogger,
): void {
  registry.registerProvider(AI_GATEWAY_PROVIDER_NAME, {
    baseUrl: spec.baseUrl,
    apiKey: spec.apiKey,
    api: AI_GATEWAY_API,
    // authHeader:true → pi SDK 出 `Authorization: Bearer <key>`,与 CF 兼容面一致
    // (cloudflare-chat-provider research §二实测)。
    authHeader: true,
    models: spec.modelIds.map((id) => ({
      id,
      name: id,
      api: AI_GATEWAY_API,
      reasoning: false,
      input: ["text" as const],
      // 计费在网关侧权威;本地 registry 成本仅占位(不用于扣费)。
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      compat: GATEWAY_MODEL_COMPAT,
    })),
  });
  logger?.info("ai-gateway session provider registered", {
    provider: AI_GATEWAY_PROVIDER_NAME,
    models: spec.modelIds.length,
    baseUrl: spec.baseUrl,
  });
}
