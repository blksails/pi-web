/**
 * ai-gateway · 模型目录与聚合(design.md §2.4,Req Story 4)。
 *
 * `GatewayModelCatalog` 惰性 + TTL 拉取网关 `GET /v1/models`:`get()` 命中过期即触发
 * 后台刷新(不阻塞调用方),返回现有快照(stale-while-revalidate);拉取失败沿用上次
 * 成功快照(fail-soft,Req 4.4);从未成功过 → 空集,不影响自配目录展示。
 *
 * `mergeModelCatalog` 是纯函数(合并语义见 model-catalog spec,Req 1/2/3.1):
 * `self ∪ gateway` 不吞并——同名判定 key 为 `${provider}/${id}` 二元组,网关条目
 * provider 统一收敛为 `"ai-gateway"`(上游渠道名 `ownedBy` 降级为 `channel` 元数据),
 * 故 self 与 gateway 条目永不同 key,同 id 跨归属两条并存。`modelPrecedence` 仅决定
 * 合并 models 数组中两块的先后顺序(`"gateway"` = 网关块在前,可经
 * `PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE=self` 反转),不再做覆盖删除。`providers`
 * 输出仅含 self 来源 provider(可设为默认的集合)。接入点见 `lib/app/pi-handler.ts`
 * 的 `createConfigRoutes({ listModelOptions })` 装配处。
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { ModelOption, ModelOptions } from "../config/model-options.types.js";
import type { KeyResolver } from "./key-resolver.js";
import {
  AI_GATEWAY_PROVIDER_NAME,
  isSessionCapableGatewayModel,
} from "./session-model-source.js";

// 与 routes.ts 同一命名空间:目录收敛结果与拉取失败均属 ai-gateway 的运维可观测面。
const log = createLogger({ namespace: "server:ai-gateway" });

/**
 * ★ `GatewayModelEntry` 与 `ModelPrecedence` 的定义已下沉到 `model-catalog/types.ts`
 *   (spec: core-package-extraction 任务 3.1),此处**原样 re-export** 以保持本模块导出面
 *   逐字不变 —— 既有消费方无需跟随改动。
 *
 *   下沉的原因是解除 `model-catalog(core) → ai-gateway(adapters)` 的跨层反向值依赖:
 *   目录服务需要这两个类型来描述注入契约,而它不该认识适配器。
 */
export type { GatewayModelEntry, ModelPrecedence } from "../model-catalog/types.js";
import type { GatewayModelEntry, ModelPrecedence } from "../model-catalog/types.js";

/** `GatewayModelCatalog` 的注入依赖。 */
export interface GatewayModelCatalogDeps {
  /** 网关 base URL(不含尾斜杠)。 */
  readonly baseUrl: string;
  /** 目录 TTL(毫秒)。 */
  readonly ttlMs: number;
  /** 可选:携带凭据请求 `/v1/models`(网关若要求鉴权)。未注入则匿名请求。 */
  readonly keyResolver?: KeyResolver;
  /**
   * 可选:允许的上游归属集合(对应目录条目的 `owned_by`),用于收敛庞大目录
   * (spec `cloudflare-chat-provider` Req 2)。
   *
   * ★`undefined` = **不过滤**,保证既有部署(非 CF 网关)行为逐字节不变;空集 = 全部滤除。
   * 比对忽略大小写与首尾空白,故传入前无需归一化。
   *
   * 为什么按**归属**而非模型 id 过滤:Cloudflare AI Gateway 实测返回 2465 条,仅
   * openrouter 一家就 1067 条且与其他 provider 大量重复覆盖。按归属收敛既能排除重复大户,
   * 又使白名单内厂商发布新型号时**无需改代码**即可出现(Req 2.4)。
   */
  readonly allowedOwners?: ReadonlySet<string>;
  /** 测试接缝:缺省 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 测试接缝:缺省 `Date.now`。 */
  readonly nowFn?: () => number;
  /** 测试接缝:收敛结果与拉取失败的观测出口;缺省走 `server:ai-gateway` 日志。 */
  readonly logger?: GatewayCatalogLogger;
}

/** 目录组件的最小日志出口(测试可注入以断言可观测性)。 */
export interface GatewayCatalogLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
}

/**
 * 按归属过滤目录条目(纯函数)。
 *
 * @param allowed `undefined` → 原样返回(不过滤);否则仅保留 `ownedBy` 命中者。
 */
export function filterByOwner(
  entries: readonly GatewayModelEntry[],
  allowed: ReadonlySet<string> | undefined,
): readonly GatewayModelEntry[] {
  if (allowed === undefined) return entries;
  const normalized = new Set([...allowed].map((o) => o.trim().toLowerCase()));
  return entries.filter((e) => normalized.has(e.ownedBy.trim().toLowerCase()));
}

/** `GET /v1/models` 响应体的宽松形状(OpenAI 兼容:`{ data: [{ id, owned_by }] }`)。 */
interface RawModelsResponse {
  readonly data?: ReadonlyArray<{ readonly id?: unknown; readonly owned_by?: unknown }>;
}

function parseModelsResponse(json: unknown): GatewayModelEntry[] {
  const data = (json as RawModelsResponse | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const entries: GatewayModelEntry[] = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) continue;
    const ownedByRaw = (item as { owned_by?: unknown }).owned_by;
    const ownedBy = typeof ownedByRaw === "string" && ownedByRaw.length > 0 ? ownedByRaw : "ai-gateway";
    entries.push({ model: id, ownedBy, source: "ai-gateway" });
  }
  return entries;
}

/**
 * 网关模型目录快照(design.md §2.4)。惰性 + TTL,stale-while-revalidate,fail-soft。
 */
export class GatewayModelCatalog {
  private readonly baseUrl: string;
  private readonly ttlMs: number;
  private readonly keyResolver: KeyResolver | undefined;
  private readonly allowedOwners: ReadonlySet<string> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly nowFn: () => number;
  private readonly logger: GatewayCatalogLogger;

  private snapshot: readonly GatewayModelEntry[] = [];
  /** 上次**成功**刷新的时刻;`undefined` = 从未成功过。 */
  private lastSuccessAt: number | undefined;
  private refreshing: Promise<void> | undefined;

  constructor(deps: GatewayModelCatalogDeps) {
    this.baseUrl = deps.baseUrl;
    this.ttlMs = deps.ttlMs;
    this.keyResolver = deps.keyResolver;
    this.allowedOwners = deps.allowedOwners;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.nowFn = deps.nowFn ?? Date.now;
    this.logger = deps.logger ?? log;
  }

  /**
   * 返回当前快照;若过期(或从未成功过)则触发一次后台刷新(不等待、不阻塞本次调用)。
   * 从未成功过时快照恒为空集(Req 4.4)。
   */
  get(): readonly GatewayModelEntry[] {
    if (this.isStale() && this.refreshing === undefined) {
      // 不等待:stale-while-revalidate,本次调用立即返回现有(可能陈旧或空)快照。
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.snapshot;
  }

  private isStale(): boolean {
    if (this.lastSuccessAt === undefined) return true;
    return this.nowFn() - this.lastSuccessAt >= this.ttlMs;
  }

  /** 主动刷新一次(可等待,便于测试构造确定性场景)。拉取失败 → 沿用上次快照(fail-soft)。 */
  async refresh(): Promise<void> {
    // 请求 URL 提到 try 外:失败诊断需要它(Req 4.1 —— 地址层级配错是最常见的失误,
    // 日志不含实际地址就只能对着空目录猜)。URL 本身不含凭据,记录安全。
    const url = `${this.baseUrl}/v1/models`;
    try {
      const headers: Record<string, string> = {};
      if (this.keyResolver !== undefined) {
        const key = await this.keyResolver.resolve({});
        if (key !== undefined) headers.authorization = `Bearer ${key}`;
      }
      const res = await this.fetchImpl(url, { headers });
      if (!res.ok) {
        throw new Error(`ai-gateway /v1/models responded with status ${res.status}`);
      }
      const json = (await res.json()) as unknown;
      const parsed = parseModelsResponse(json);
      this.snapshot = filterByOwner(parsed, this.allowedOwners);
      // 收敛可观测(Req 2.5):白名单过窄会静默产出空/瘦目录,不记数就无从判断。
      if (this.allowedOwners !== undefined) {
        this.logger.info("gateway catalog filtered", {
          kept: this.snapshot.length,
          dropped: parsed.length - this.snapshot.length,
          allowed: [...this.allowedOwners],
        });
      }
      this.lastSuccessAt = this.nowFn();
    } catch (err) {
      // fail-soft(Req 4.2):沿用上次成功快照,不更新 lastSuccessAt——下次 get() 仍视为
      // 过期,持续按 TTL 节奏重试。★记录**请求地址与错因**(Req 4.1):凭据不入日志
      // (headers 不记),但没有地址就无法诊断「baseUrl 层级配错」这一最常见故障。
      this.logger.warn("gateway catalog refresh failed", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * 目录 merge 纯函数(model-catalog spec design.md「mergeModelCatalog(重写)」,
 * Req 1.1–1.3, 2.1–2.3, 3.1):不改入参,不做网络/IO。
 *
 * - 网关条目映射为 `{ provider: "ai-gateway", id, name, source: "ai-gateway",
 *   channel: ownedBy, availability: "session" }`;self 条目附
 *   `source: "self", availability: "session"`。
 *
 *   ★ `availability` 于 spec **ai-gateway-session-models** 由 `"catalog"` 翻为 `"session"`
 *   (model-catalog spec 在 `model-select-field.tsx` 留下的 P2:「网关接入会话后翻转标记
 *   即可」已兑现)。翻转的前提是会话侧确实能跑 —— runner 经
 *   `ai-gateway/session-model-source.ts` 注册同名 provider,`registry.find("ai-gateway", id)`
 *   可解析。**若该注册被移除,此处必须同步翻回 `"catalog"`**,否则用户选中即
 *   「模型未找到」。
 * - 去重 key = `${provider}/${id}`(防御性;self 与 gateway 的 provider 恒不同,
 *   理论无碰撞);同 key 重复时保留先出现者,后块不覆盖前块。
 * - `precedence` 仅决定两块在 models 数组中的先后(`"gateway"` = 网关块在前,
 *   `"self"` = self 块在前;块内保持入参原有顺序),不做跨归属覆盖删除。
 * - `providers` = self 来源 provider 去重排序,**且在存在网关条目时追加 `"ai-gateway"`**
 *   (渠道名仍不进入)。
 *
 *   ★这是对 model-catalog spec 已冻结约定「providers 仅含 self 来源」的**有意修订**
 *   (spec ai-gateway-session-models Req 6.4)。原约定的理由是「providers 是可设为默认的
 *   集合,而网关条目当时不可接入会话」;该前提已随 availability 翻转而消失 —— 网关模型
 *   现在能跑,把它排除在默认 provider 之外就成了纯粹的功能缺失(本轮需求的直接触发点)。
 *   无网关条目时输出与修订前逐字节一致。
 *
 * 零侵入语义分界(Req 1.3):「未启用 ai-gateway 套件时响应逐字节一致」由装配层
 * 保证(`aiGwConfig` 为 undefined 时不调用本函数);一旦调用(聚合形态),即便
 * `gatewayEntries` 为空数组,输出也一律附 source/availability 标记。
 */
export function mergeModelCatalog(
  selfEntries: readonly ModelOption[],
  gatewayEntries: readonly GatewayModelEntry[],
  precedence: ModelPrecedence = "gateway",
): ModelOptions {
  const selfTagged: ModelOption[] = selfEntries.map((m) => ({
    ...m,
    source: "self" as const,
    availability: "session" as const,
  }));
  // 剔除明确不可对话的变体(Req 4.1):既然网关条目现在可选中,就不该把一个已知会 401
  // 的条目呈现为正常选项。判据与装配层下发 spawn env 时**同源**,两侧漂移就会出现
  // 「列表里看得到、选中却说模型未找到」。
  const gatewayTagged: ModelOption[] = gatewayEntries
    .filter((g) => isSessionCapableGatewayModel(g.model))
    .map((g) => ({
      // ★与 session-model-source 的 provider 命名空间同源:两处必须逐字一致,
      // 否则前端选中的条目在 runner registry 里查不到。
      provider: AI_GATEWAY_PROVIDER_NAME,
      id: g.model,
      name: g.model,
      source: "ai-gateway" as const,
      channel: g.ownedBy,
      availability: "session" as const,
    }));

  // precedence 只做块排序;防御性去重保留先出现者(不吞并语义,Req 1.2)。
  const ordered =
    precedence === "gateway"
      ? [...gatewayTagged, ...selfTagged]
      : [...selfTagged, ...gatewayTagged];
  const byKey = new Map<string, ModelOption>();
  for (const m of ordered) {
    const key = `${m.provider}/${m.id}`;
    if (!byKey.has(key)) byKey.set(key, m);
  }

  const models = [...byKey.values()];
  // providers = 可设为默认的 provider 集合。self 来源恒在;网关在其条目非空时加入
  // (spec ai-gateway-session-models Req 6.1/6.3——网关模型已可接入会话)。
  // 空网关时不追加,保证「未接入任何网关条目」的输出与修订前逐字节一致。
  const providers = [...new Set(selfTagged.map((m) => m.provider))].sort();
  if (gatewayTagged.length > 0) providers.push(AI_GATEWAY_PROVIDER_NAME);
  return { providers, models };
}
