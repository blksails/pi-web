/**
 * ai-gateway · 会话侧模型来源(spec ai-gateway-session-models,design.md §D1/D2,
 * Req 1.1/2.4/3.2)。
 *
 * 目录侧(`model-catalog.ts`)只让网关模型**可见**;本模块让它们**可用** —— 在 runner 侧把网关
 * 注册为 pi SDK 会话的内存 provider,使 `registry.find("ai-gateway", <id>)` 可解析,
 * 否则会话构造时 `resolveModel` 直接抛「模型未找到」。
 *
 * 范式完全沿用 `auth/egress-model-source.ts`(desktop-cloud-login):共享 registry 由
 * `ModelRegistry.create` 读 `<agentDir>/models.json` 后,本源在其上**叠加** `registerProvider`
 * —— **只读不写**,不写 `models.json`、不改 agentDir。网关目录是 TTL 刷新的动态数据,
 * 落盘只会产生漂移。
 *
 * ★ 叠加而非替换(spec multi-gateway-providers 任务 2.1):此前共享 registry 走
 *   `ModelRegistry.inMemory`,任何模型源一启用就会顶掉磁盘上的自定义 provider 与覆写
 *   (Req 6.1/6.3/6.4)。改后两者共存。
 *
 * ★ 多实例扩展点(spec multi-gateway-providers 任务 3.5,Req 1.1/6.2/6.5):
 *   `registerAiGatewayProvider` 接受可选的 `providerName` 参数,不再假定"该来源恒注册
 *   `AI_GATEWAY_PROVIDER_NAME` 这一个 provider"。env 解析同步多实例化:
 *   `resolveAiGatewaySessionSpecsFromEnv`(复数)读 `PI_WEB_AI_GATEWAY_SESSIONS=<id1>,<id2>`
 *   列出的实例清单,逐实例读 `PI_WEB_AI_GATEWAY_SESSION_<ID>_BASE/_KEY/_MODELS`
 *   (`<ID>` 派生规则见 `envSafeInstanceId`,与部署侧 `instances.ts` 同构)。未设实例清单
 *   但设了扁平三件套(`resolveAiGatewaySessionSpecFromEnv`,单数)时,合成一个
 *   providerName = `AI_GATEWAY_PROVIDER_NAME` 的缺省实例,与改造前逐字节等价(Req 9.1);
 *   两者都无 → 空数组。装配层(`host-assembly/model-sources.ts`)对该数组逐个调用
 *   `registerAiGatewayProvider` 并传入各自的 `providerName`。
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
import { envSafeInstanceId } from "./config.js";

/** runner 侧读取的网关基址 env(已含 `/v1`)。跨进程契约。 */
export const RUNNER_AI_GATEWAY_BASE_ENV = "PI_WEB_AI_GATEWAY_SESSION_BASE";
/** runner 侧读取的网关凭据 env。跨进程契约。 */
export const RUNNER_AI_GATEWAY_KEY_ENV = "PI_WEB_AI_GATEWAY_SESSION_KEY";
/** runner 侧读取的模型 id 清单 env(JSON 字符串数组)。跨进程契约。 */
export const RUNNER_AI_GATEWAY_MODELS_ENV = "PI_WEB_AI_GATEWAY_SESSION_MODELS";

/**
 * 列出全部会话侧网关实例标识(逗号分隔,即各自的 `providerName`)的 env
 * (spec multi-gateway-providers 任务 3.5,Req 1.1/6.2/6.5)。
 *
 * ★与部署侧 `instances.ts` 的 `PI_WEB_GATEWAYS` 是**两个独立的 env** —— 部署侧决定
 * 「目录里出现哪些网关实例」,会话侧决定「哪些实例被注册为可用的会话 provider」,
 * 二者的接线属任务 3.6(装配层),本任务只交付契约本身。
 */
export const AI_GATEWAY_SESSION_INSTANCES_ENV = "PI_WEB_AI_GATEWAY_SESSIONS";

/**
 * 网关 provider 命名空间。
 *
 * ★与 `mergeModelCatalog` 中 `provider: "ai-gateway"` 同源 —— 两处任一改动都必须同步,
 * 否则清单里的条目在 registry 中查不到(表现为「选了就报模型未找到」)。
 */
// 常量下沉到中立模块(spec kernel-boundary-decoupling 任务 4.2):runner 的失败文案分化
// 需要认得这个命名空间,从本模块引入会制造 runner → adapters 的跨层边。此处原样 re-export,
// 既有消费方零改动。
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
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
 * 按给定的三个 env 名解析出一个网关会话 spec(单实例的核心逻辑)。
 *
 * ★下沉为共享核心(spec multi-gateway-providers 任务 3.5):单数版
 * {@link resolveAiGatewaySessionSpecFromEnv} 与复数版
 * {@link resolveAiGatewaySessionSpecsFromEnv} 的逐实例解析都调用本函数 ——
 * 三件套的读取/校验/清洗规则只应存在一份,避免两侧行为随时间漂移。
 *
 * 任一 env 缺失/空白、模型清单 JSON 非法、或清单为空 → `undefined`(视为该实例未启用)。
 * **不抛** —— 网关配置异常不该让本地会话起不来。
 */
function resolveSpecFromEnvNames(
  env: NodeJS.ProcessEnv,
  baseEnvName: string,
  keyEnvName: string,
  modelsEnvName: string,
): AiGatewaySessionSpec | undefined {
  const baseUrl = env[baseEnvName]?.trim();
  const apiKey = env[keyEnvName]?.trim();
  const rawModels = env[modelsEnvName]?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) return undefined;
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  if (rawModels === undefined || rawModels.length === 0) return undefined;

  const modelIds = parseModelIds(rawModels);
  // 空清单 → 不注册:一个没有模型的 provider 无意义,注册了只会让 find 徒劳失败。
  if (modelIds === undefined || modelIds.length === 0) return undefined;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, modelIds };
}

/**
 * 从 runner 自身 env 解析网关会话来源(单实例;既有调用点/测试零改动)。
 *
 * 任一 env 缺失/空白、模型清单 JSON 非法、或清单为空 → `undefined`(视为未启用,
 * runner 走 SDK 默认)。**不抛** —— 网关配置异常不该让本地会话起不来。
 */
export function resolveAiGatewaySessionSpecFromEnv(
  env: NodeJS.ProcessEnv,
): AiGatewaySessionSpec | undefined {
  return resolveSpecFromEnvNames(
    env,
    RUNNER_AI_GATEWAY_BASE_ENV,
    RUNNER_AI_GATEWAY_KEY_ENV,
    RUNNER_AI_GATEWAY_MODELS_ENV,
  );
}

/** 一个已解析的网关会话实例:它将注册进哪个 provider 名 + 该 provider 的 spec。 */
export interface AiGatewaySessionSpecEntry {
  /** 该实例注册进 registry 的 provider 名(即实例标识)。 */
  readonly providerName: string;
  readonly spec: AiGatewaySessionSpec;
}

/**
 * 派生某会话侧网关实例的 env 前缀:`PI_WEB_AI_GATEWAY_SESSION_<ID>_`。
 *
 * ★`<ID>` 派生规则复用 {@link envSafeInstanceId}(`config.ts`),与部署侧
 * `instances.ts` 的 `PI_WEB_GATEWAY_<ID>_` 同构 —— 同一实例标识在两侧的 env 名
 * 变形规则必须一致,否则会出现"部署侧认得这个实例、会话侧认不出"的错位。
 *
 * ★导出(spec multi-gateway-providers 任务 3.6):装配层(`lib/app/
 * ai-gateway-session-assembly.ts`)按实例序列化本地 spawn env 时须派生**同一个**
 * 前缀,否则会出现「装配层写的 env 名、runner 侧读不到」的错位——两侧必须共用本函数,
 * 而不是各自重复拼接字面量。
 */
export function sessionInstanceEnvPrefix(id: string): string {
  return `PI_WEB_AI_GATEWAY_SESSION_${envSafeInstanceId(id)}_`;
}

/**
 * 从 runner 自身 env 解析**全部**网关会话实例(spec multi-gateway-providers 任务 3.5,
 * Req 1.1/6.2/6.5)。
 *
 * - {@link AI_GATEWAY_SESSION_INSTANCES_ENV} 设置且非空白 → 按逗号切分为实例标识清单,
 *   逐个按 `PI_WEB_AI_GATEWAY_SESSION_<ID>_BASE/_KEY/_MODELS` 解析;某实例三件套缺失/
 *   非法(JSON 解析失败、清单为空)→ **只跳过该实例**,不影响其余实例(fail-soft,
 *   与单实例惯例一致:网关配置异常不该让本地会话起不来)。
 * - 未设置/空白 → 存量兼容(Req 9.1):回落读取扁平三件套
 *   (`resolveAiGatewaySessionSpecFromEnv`),合成一个 `providerName` =
 *   {@link AI_GATEWAY_PROVIDER_NAME} 的缺省实例,与改造前逐字节等价。
 * - 两者都无 → 空数组(零实例)。
 */
export function resolveAiGatewaySessionSpecsFromEnv(
  env: NodeJS.ProcessEnv,
): readonly AiGatewaySessionSpecEntry[] {
  const rawList = env[AI_GATEWAY_SESSION_INSTANCES_ENV]?.trim();
  if (rawList === undefined || rawList.length === 0) {
    const legacy = resolveAiGatewaySessionSpecFromEnv(env);
    return legacy === undefined ? [] : [{ providerName: AI_GATEWAY_PROVIDER_NAME, spec: legacy }];
  }

  const ids = rawList
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const entries: AiGatewaySessionSpecEntry[] = [];
  for (const id of ids) {
    const prefix = sessionInstanceEnvPrefix(id);
    const spec = resolveSpecFromEnvNames(
      env,
      `${prefix}BASE`,
      `${prefix}KEY`,
      `${prefix}MODELS`,
    );
    if (spec !== undefined) entries.push({ providerName: id, spec });
  }
  return entries;
}

/**
 * 把网关来源注册进给定注册表。
 *
 * 与 egress 来源共用**同一个** registry(design.md §D2),故本函数只做 `registerProvider`,
 * 不自建 registry —— 两个来源必须共存,谁自建谁就会顶掉对方。
 *
 * @param logger 可选;注册后记一条含 provider 名与条目数的 info(Req 7.1)。
 *   ★绝不记 `spec.apiKey`。
 * @param providerName 该 spec 注册进哪个 provider 命名空间。
 *   ★ spec multi-gateway-providers 任务 3.5:新增可选参数,取代"恒用
 *   {@link AI_GATEWAY_PROVIDER_NAME}"的隐式假设 —— 使一个来源(该函数所属的模型源)
 *   将来可按网关实例各注册一个 provider(任务 3.6 接线)。缺省仍是
 *   {@link AI_GATEWAY_PROVIDER_NAME},与改动前逐字节等价。
 */
export function registerAiGatewayProvider(
  registry: ModelRegistry,
  spec: AiGatewaySessionSpec,
  logger?: AiGatewaySessionLogger,
  providerName: string = AI_GATEWAY_PROVIDER_NAME,
): void {
  registry.registerProvider(providerName, {
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
    provider: providerName,
    models: spec.modelIds.length,
    baseUrl: spec.baseUrl,
  });
}
