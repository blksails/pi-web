/**
 * ai-gateway · 多网关实例的 env 解析 + 每实例目录聚合(design.md「adapters /
 * GatewayInstances」组件块,spec multi-gateway-providers 任务 3.1/3.3;
 * Req 1.1, 1.2, 1.5, 1.6, 9.1, 10.2)。
 *
 * `PI_WEB_GATEWAYS=<id1>,<id2>` 列出全部实例标识(即其 provider 名,Req 1.1/1.2);
 * 逐实例再读 `PI_WEB_GATEWAY_<ID>_BASE_URL` / `_API_KEY` / `_ALLOWLIST` / `_TTL_MS` /
 * `_TIMEOUT_MS` / `_INPUT` / `_OUTPUT`(`<ID>` = 标识大写、`-` → `_`,与既有
 * `PI_LLM_TOKEN_<ID>` 的派生规则同构,见 `packages/adapters/src/llm-gateway/
 * provider-registry.ts:161`)。任一实例的地址、取值域(输入 / 输出类型)、超时不合法,
 * 即在启动期抛出 {@link AiGatewayConfigError},错误信息含该实例的标识与 env
 * 名(env 名本身已内嵌标识,天然可辨识是哪个实例,Req 10.2)。
 *
 * **存量兼容**(Req 9.1):未设置 `PI_WEB_GATEWAYS` 但设置了既有单实例变量
 * (`BLKSAILS_GATEWAY_BASE_URL` / 旧名 `AI_GATEWAY_BASE_URL`)时,合成一个标识固定为
 * `ai-gateway`(沿用 {@link AI_GATEWAY_PROVIDER_NAME})的缺省实例——其 base URL /
 * apiKey / TTL / 超时 / 白名单解析规则与 {@link resolveAiGatewayConfig} 逐字节一致
 * (复用同一批纯函数,而非各写一份)。两者都未设置 → 返回空数组(零实例,Req 10.1 的
 * 零侵入基线由调用方在此之上判定)。
 *
 * `resolveGatewayInstances` 只做纯配置解析(零 IO),不做标识冲突检测(留给
 * `ProviderRegistry`/装配层,那是跨来源的职责,Req 1.4)、不接线到目录合并或路由
 * (那是任务 3.2/3.4/3.6 的范围)。
 *
 * `createGatewayCatalogs`(任务 3.3,Req 1.5)在解析结果之上按实例构造互相独立的
 * `GatewayModelCatalog` + `InstanceEnvKeyResolver`:每个实例独立解析凭据、独立持有
 * 目录快照与过期时间,单个实例拉取失败只影响其自身(详见该函数的文档注释)。本函数
 * 仍不接线到实际的装配点(`lib/app/pi-handler.ts` 的多实例接线是任务 3.6 的范围)。
 */
import type { Modality } from "@blksails/pi-web-core/model-catalog/modality.js";
import type { ProviderId } from "@blksails/pi-web-core/model-catalog/provider-identity.js";
import { validateProviderId } from "@blksails/pi-web-core/model-catalog/provider-identity.js";
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";
import {
  AI_GATEWAY_BASE_URL_ENV,
  AI_GATEWAY_BASE_URL_ENV_LEGACY,
  AI_GATEWAY_CATALOG_TTL_MS_ENV,
  AI_GATEWAY_PROVIDER_ALLOWLIST_ENV,
  AI_GATEWAY_TIMEOUT_MS_ENV,
  AiGatewayConfigError,
  DEFAULT_CATALOG_TTL_MS,
  DEFAULT_TIMEOUT_MS,
  instanceEnvPrefix,
  parseAndValidateBaseUrl,
  parsePositiveIntOverride,
  parseProviderAllowlist,
} from "./config.js";
import { InstanceEnvKeyResolver } from "./key-resolver.js";
import type { GatewayCatalogLogger } from "./model-catalog.js";
import { GatewayModelCatalog } from "./model-catalog.js";

/** 列出全部网关实例标识(逗号分隔)的环境变量名。 */
export const GATEWAY_INSTANCES_ENV = "PI_WEB_GATEWAYS";

/**
 * 旧名单实例部署下,合成的缺省实例标识(即 provider 名)。
 *
 * ★与 {@link AI_GATEWAY_PROVIDER_NAME} 保持同一字面量:该标识早已作为目录条目的
 * provider 名与会话侧注册名下发给使用者,改名会破坏存量的 `defaultProvider` 等
 * 设置(design.md 迁移策略表,Req 9.1)。
 */
export const DEFAULT_GATEWAY_INSTANCE_ID = AI_GATEWAY_PROVIDER_NAME as ProviderId;

/** 单个网关实例的装配期配置(design.md「adapters / GatewayInstances」)。 */
export interface GatewayInstanceConfig {
  /** 实例标识,即其模型条目的 provider 名(Req 1.2)。 */
  readonly id: ProviderId;
  /** 网关 base URL(不含尾斜杠)。 */
  readonly baseUrl: string;
  /** 请求凭据;未配置时为空串(该实例视为匿名网关,由路由层决定是否放行)。 */
  readonly apiKey: string;
  /** 允许纳入模型清单的上游归属(目录条目的 `owned_by`)。 */
  readonly allowedOwners: ReadonlySet<string>;
  /**
   * 可选:模型 id 精选白名单(`PI_WEB_GATEWAY_<ID>_MODELS`),在 `allowedOwners` 粗筛
   * 之后再收一层。`undefined` = 未配置 = 不精选(既有部署行为不变)。
   */
  readonly allowedModelIds?: ReadonlySet<string>;
  /** 模型目录 TTL(毫秒)。 */
  readonly ttlMs: number;
  /** 请求超时(毫秒)。 */
  readonly timeoutMs: number;
  /** provider 级输入类型声明(可选,供后续任务的 Modality 继承使用)。 */
  readonly input?: readonly Modality[];
  /** provider 级输出类型声明(可选,供后续任务的 Modality 继承使用)。 */
  readonly output?: readonly Modality[];
}

const MODALITY_DOMAIN: ReadonlySet<Modality> = new Set<Modality>([
  "text",
  "image",
  "video",
  "audio",
]);

/**
 * 解析逗号分隔的类型取值列表(`_INPUT` / `_OUTPUT`);缺省/空白返回 `undefined`;
 * 含不在取值域内的字面量 → 抛 {@link AiGatewayConfigError}(Req 10.2 的「取值域」
 * 一项)。
 */
function parseModalityListOverride(
  raw: string | undefined,
  envName: string,
  instanceId: string,
): readonly Modality[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const items = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const invalid = items.filter((s) => !MODALITY_DOMAIN.has(s as Modality));
  if (invalid.length > 0) {
    throw new AiGatewayConfigError(
      `网关实例 "${instanceId}" 的 ${envName} 含不合法的类型取值:"${invalid.join(", ")}"。合法取值为 text/image/video/audio 之一(env ${envName})。`,
    );
  }
  return items as Modality[];
}

/**
 * 解析逗号分隔的模型 id 精选白名单(`PI_WEB_GATEWAY_<ID>_MODELS`)。
 *
 * ★与归属白名单 `parseProviderAllowlist` 的**空值语义相反**:那边空白回落内置默认表
 * (因为「没有默认」会让庞大目录不可用),这边空白/未配置一律 `undefined` = 不精选
 * (因为精选本就是可选加强,没有合理的默认清单——任何写死的型号表都会过时)。
 */
function parseModelIdAllowlist(raw: string | undefined): ReadonlySet<string> | undefined {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? new Set(items) : undefined;
}

/**
 * 按 `PI_WEB_GATEWAYS` 逐个解析一个显式声明的实例。
 *
 * 标识本身先过 {@link validateProviderId}(形态 + 保留名,任务 1.1 的事实源)——
 * 非法标识同样属于「配置不合法」,须在启动期指名报错,而不是留到装配层的冲突检测
 * 才发现(那一层只查重名,不查形态)。
 */
function resolveExplicitInstance(
  rawId: string,
  env: NodeJS.ProcessEnv,
): GatewayInstanceConfig {
  const idValidation = validateProviderId(rawId);
  if (!idValidation.ok) {
    throw new AiGatewayConfigError(
      `网关实例标识 "${rawId}"(来自 ${GATEWAY_INSTANCES_ENV})不合法:${idValidation.reason}。`,
    );
  }
  const id = idValidation.id;
  const prefix = instanceEnvPrefix(id);
  const baseUrlEnvName = `${prefix}BASE_URL`;
  const rawBaseUrl = env[baseUrlEnvName]?.trim();
  if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
    throw new AiGatewayConfigError(
      `网关实例 "${id}" 缺少 ${baseUrlEnvName}:${GATEWAY_INSTANCES_ENV} 列出的每个实例都必须配置其 base URL。`,
    );
  }
  const baseUrl = parseAndValidateBaseUrl(rawBaseUrl, baseUrlEnvName);

  const apiKey = env[`${prefix}API_KEY`]?.trim() ?? "";

  const ttlMs =
    parsePositiveIntOverride(env[`${prefix}TTL_MS`], `${prefix}TTL_MS`) ??
    DEFAULT_CATALOG_TTL_MS;
  const timeoutMs =
    parsePositiveIntOverride(env[`${prefix}TIMEOUT_MS`], `${prefix}TIMEOUT_MS`) ??
    DEFAULT_TIMEOUT_MS;

  const input = parseModalityListOverride(env[`${prefix}INPUT`], `${prefix}INPUT`, id);
  const output = parseModalityListOverride(env[`${prefix}OUTPUT`], `${prefix}OUTPUT`, id);

  return {
    id,
    baseUrl,
    apiKey,
    allowedOwners: parseProviderAllowlist(env[`${prefix}ALLOWLIST`]),
    allowedModelIds: parseModelIdAllowlist(env[`${prefix}MODELS`]),
    ttlMs,
    timeoutMs,
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

/**
 * 未设置 `PI_WEB_GATEWAYS` 时,尝试从既有单实例变量合成一个缺省实例
 * (Req 9.1)。两者都未设置 → `undefined`(零实例)。
 *
 * ★行为与 {@link resolveAiGatewayConfig} 逐字节一致:同一套 env 名、同一套回落
 * 顺序(新名优先、旧名回落)、同一套白名单/超时/TTL 解析函数。
 */
function resolveLegacyDefaultInstance(
  env: NodeJS.ProcessEnv,
): GatewayInstanceConfig | undefined {
  const rawBaseUrl =
    env[AI_GATEWAY_BASE_URL_ENV]?.trim() || env[AI_GATEWAY_BASE_URL_ENV_LEGACY]?.trim();
  if (rawBaseUrl === undefined || rawBaseUrl.length === 0) {
    return undefined;
  }

  const baseUrl = parseAndValidateBaseUrl(rawBaseUrl, AI_GATEWAY_BASE_URL_ENV);
  const apiKey =
    env.BLKSAILS_GATEWAY_API_KEY?.trim() || env.AI_GATEWAY_API_KEY?.trim() || "";

  const timeoutMs =
    parsePositiveIntOverride(env[AI_GATEWAY_TIMEOUT_MS_ENV], AI_GATEWAY_TIMEOUT_MS_ENV) ??
    DEFAULT_TIMEOUT_MS;
  const ttlMs =
    parsePositiveIntOverride(
      env[AI_GATEWAY_CATALOG_TTL_MS_ENV],
      AI_GATEWAY_CATALOG_TTL_MS_ENV,
    ) ?? DEFAULT_CATALOG_TTL_MS;

  return {
    id: DEFAULT_GATEWAY_INSTANCE_ID,
    baseUrl,
    apiKey,
    allowedOwners: parseProviderAllowlist(env[AI_GATEWAY_PROVIDER_ALLOWLIST_ENV]),
    ttlMs,
    timeoutMs,
  };
}

/**
 * 装配期解析全部网关实例(design.md「adapters / GatewayInstances」,
 * Req 1.1/1.2/1.6/9.1/10.2)。
 *
 * - `PI_WEB_GATEWAYS` 设置且非空白 → 按逗号切分为标识清单,逐个解析其配置;
 *   任一实例配置不合法(地址、取值域、超时)即抛 {@link AiGatewayConfigError},
 *   信息含该实例标识与具体字段(Req 10.2)。
 * - `PI_WEB_GATEWAYS` 未设置/空白 → 回落到既有单实例变量,合成一个标识为
 *   {@link DEFAULT_GATEWAY_INSTANCE_ID} 的缺省实例,行为与改造前逐字节一致
 *   (Req 9.1);连既有单实例变量也未设置 → 返回空数组(Req 1.1 的零实例场景)。
 *
 * 新增一个实例只需增加配置(`PI_WEB_GATEWAYS` 追加标识 + 对应 env),不需要修改
 * 本函数或发布新版本(Req 1.6)。
 *
 * @param env 环境变量来源(装配处传 `process.env`;便于测试注入)。
 */
export function resolveGatewayInstances(
  env: NodeJS.ProcessEnv,
): readonly GatewayInstanceConfig[] {
  const rawList = env[GATEWAY_INSTANCES_ENV]?.trim();
  if (rawList === undefined || rawList.length === 0) {
    const legacy = resolveLegacyDefaultInstance(env);
    return legacy === undefined ? [] : [legacy];
  }

  const ids = rawList
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return ids.map((id) => resolveExplicitInstance(id, env));
}

/**
 * 该来源在当前 env 下**声明**要注册的全部网关实例标识 —— 与 {@link resolveGatewayInstances}
 * 不同,本函数只做字符串层面的解析,**绝不做合法性校验、绝不抛异常**
 * (spec multi-gateway-providers,任务 3.7,Req 6.5)。
 *
 * ★ 为什么不能复用 {@link resolveGatewayInstances}:它对非法配置(标识形态、base URL、
 *   取值域)一律 fail-fast 抛 {@link AiGatewayConfigError}(`instances.test.ts` 已覆盖该
 *   契约)。本函数的消费方是**失败文案的来源判据**(`packages/runner/src/runner/
 *   option-mapper.ts`)——那条路径本身就是在"配置有问题"时给用户提示,若判据函数自己
 *   先抛异常,会把"提示"变成"崩溃"。
 *
 * - {@link GATEWAY_INSTANCES_ENV}(`PI_WEB_GATEWAYS`)设置且非空白 → 按逗号切分、trim、
 *   去空,原样返回(不做 `validateProviderId` 校验 —— 非法标识仍应作为「声明过」计入,
 *   由判据的消费方决定如何处理,不在此处吞掉)。
 * - 未设置/空白 → 若存量单实例变量(`AI_GATEWAY_BASE_URL_ENV` 或其 LEGACY 名)存在,
 *   返回 `[DEFAULT_GATEWAY_INSTANCE_ID]`(Req 9.1 的缺省实例);否则 `[]`。
 */
export function declaredGatewayInstanceIdsFromEnv(
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const rawList = env[GATEWAY_INSTANCES_ENV]?.trim();
  if (rawList !== undefined && rawList.length > 0) {
    return rawList
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const hasLegacyBaseUrl =
    (env[AI_GATEWAY_BASE_URL_ENV]?.trim().length ?? 0) > 0 ||
    (env[AI_GATEWAY_BASE_URL_ENV_LEGACY]?.trim().length ?? 0) > 0;
  return hasLegacyBaseUrl ? [DEFAULT_GATEWAY_INSTANCE_ID] : [];
}

/**
 * {@link createGatewayCatalogs} 的注入依赖(测试接缝;缺省与 {@link GatewayModelCatalog}
 * 同源:未传即各自缺省 `globalThis.fetch` / `Date.now` / `server:ai-gateway` 日志)。
 */
export interface GatewayCatalogAggregatorDeps {
  /** env 来源;供 {@link InstanceEnvKeyResolver} 逐实例即时读取凭据。缺省 `process.env`。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 测试接缝:透传给每个 {@link GatewayModelCatalog}。 */
  readonly fetchImpl?: typeof fetch;
  /** 测试接缝:透传给每个 {@link GatewayModelCatalog}。 */
  readonly nowFn?: () => number;
  /** 测试接缝:透传给每个 {@link GatewayModelCatalog}。 */
  readonly logger?: GatewayCatalogLogger;
}

/**
 * 按实例构造互相独立的 {@link GatewayModelCatalog}(design.md「adapters /
 * GatewayInstances」的「每实例 GatewayModelCatalog 的聚合器」,
 * spec multi-gateway-providers 任务 3.3,Req 1.5)。
 *
 * 每个实例各自拿到:
 * - 独立的 `GatewayModelCatalog` 实例 → 独立持有目录快照与过期时间(`lastSuccessAt`/
 *   `snapshot`/`refreshing` 均为该类的私有实例字段,天然互不共享,`GatewayModelCatalog`
 *   本身已有 stale-while-revalidate + fail-soft,见 `model-catalog.ts`);
 * - 独立的 {@link InstanceEnvKeyResolver} → 各自按**自己的**标识派生 env 名
 *   即时读取凭据(不缓存,换 key 立即生效,行为与单实例 `EnvKeyResolver` 同构),
 *   一个实例的凭据缺失/无效不影响其他实例的解析。
 *
 * 因此单个实例拉取失败(网络错误、401、base URL 配错)只会让**该实例自身**的
 * `get()` 保持/回退为空集(或上次成功快照),其余实例与本地模型(不经本函数,
 * 属另一来源)不受影响——`GatewayModelCatalog.refresh()` 的 try/catch 天然把
 * 故障限制在单个实例内,本函数只是不共享任何跨实例可变状态,不新增隔离逻辑。
 *
 * 默认实例(标识等于 {@link DEFAULT_GATEWAY_INSTANCE_ID},即旧名单实例部署合成的
 * 那个)额外回落到 `EnvKeyResolver` 的两个存量全局凭据名(Req 9.1 的逐字节兼容);
 * 显式声明的实例(经 `PI_WEB_GATEWAYS` 列出)只认自己的 `_API_KEY`,不做任何回落。
 *
 * 每个实例声明的模态(`GatewayInstanceConfig.input`/`output`)也在此逐实例转发给
 * 各自的 `GatewayModelCatalog`(任务 4.5,Req 2.4/2.5/3.3),使该实例产出的每条目录
 * 条目携带其声明,而不再是各实例共用同一个写死的缺省值。
 *
 * @param instances {@link resolveGatewayInstances} 的解析结果。
 * @param deps 测试接缝与 env 来源;不传则与生产装配同构(读 `process.env`)。
 * @returns 以实例标识为键的只读 Map,一对一对应入参的每个实例。
 */
export function createGatewayCatalogs(
  instances: readonly GatewayInstanceConfig[],
  deps: GatewayCatalogAggregatorDeps = {},
): ReadonlyMap<ProviderId, GatewayModelCatalog> {
  const env = deps.env ?? process.env;
  const catalogs = new Map<ProviderId, GatewayModelCatalog>();
  for (const instance of instances) {
    const keyResolver = new InstanceEnvKeyResolver(instance.id, env, {
      legacyFallback: instance.id === DEFAULT_GATEWAY_INSTANCE_ID,
    });
    catalogs.set(
      instance.id,
      new GatewayModelCatalog({
        baseUrl: instance.baseUrl,
        ttlMs: instance.ttlMs,
        instanceId: instance.id,
        keyResolver,
        allowedOwners: instance.allowedOwners,
        // 模型 id 精选(任务:cloudflare 目录过大时只暴露认可的型号);未配置 = undefined = 不精选。
        ...(instance.allowedModelIds !== undefined
          ? { allowedModelIds: instance.allowedModelIds }
          : {}),
        // 实例声明的模态转发(spec multi-gateway-providers 任务 4.5,Req 2.4/2.5/3.3):
        // `instance.input`/`output` 由 `resolveExplicitInstance` 解析自
        // `PI_WEB_GATEWAY_<ID>_INPUT`/`_OUTPUT`(任务 3.1),此前从未离开
        // `GatewayInstanceConfig` —— 未接线到此处即是「配了也没用」的那半个缺口
        // (第六批完整性批评 gap 4)。未声明(`undefined`)时不传,`GatewayModelCatalog`
        // 落到其自身的缺省值,行为不变。
        ...(instance.input !== undefined ? { input: instance.input } : {}),
        ...(instance.output !== undefined ? { output: instance.output } : {}),
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.nowFn !== undefined ? { nowFn: deps.nowFn } : {}),
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      }),
    );
  }
  return catalogs;
}
