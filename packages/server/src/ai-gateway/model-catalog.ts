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
import type { ModelOption, ModelOptions } from "../config/model-options.types.js";
import type { KeyResolver } from "./key-resolver.js";

/** 网关模型目录单条目。 */
export interface GatewayModelEntry {
  /** `/v1/models` 的 id。 */
  readonly model: string;
  /** `owned_by` → UI 徽章分组。 */
  readonly ownedBy: string;
  readonly source: "ai-gateway";
}

/** `GatewayModelCatalog` 的注入依赖。 */
export interface GatewayModelCatalogDeps {
  /** 网关 base URL(不含尾斜杠)。 */
  readonly baseUrl: string;
  /** 目录 TTL(毫秒)。 */
  readonly ttlMs: number;
  /** 可选:携带凭据请求 `/v1/models`(网关若要求鉴权)。未注入则匿名请求。 */
  readonly keyResolver?: KeyResolver;
  /** 测试接缝:缺省 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 测试接缝:缺省 `Date.now`。 */
  readonly nowFn?: () => number;
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
  private readonly fetchImpl: typeof fetch;
  private readonly nowFn: () => number;

  private snapshot: readonly GatewayModelEntry[] = [];
  /** 上次**成功**刷新的时刻;`undefined` = 从未成功过。 */
  private lastSuccessAt: number | undefined;
  private refreshing: Promise<void> | undefined;

  constructor(deps: GatewayModelCatalogDeps) {
    this.baseUrl = deps.baseUrl;
    this.ttlMs = deps.ttlMs;
    this.keyResolver = deps.keyResolver;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.nowFn = deps.nowFn ?? Date.now;
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
    try {
      const headers: Record<string, string> = {};
      if (this.keyResolver !== undefined) {
        const key = await this.keyResolver.resolve({});
        if (key !== undefined) headers.authorization = `Bearer ${key}`;
      }
      const res = await this.fetchImpl(`${this.baseUrl}/v1/models`, { headers });
      if (!res.ok) {
        throw new Error(`ai-gateway /v1/models responded with status ${res.status}`);
      }
      const json = (await res.json()) as unknown;
      this.snapshot = parseModelsResponse(json);
      this.lastSuccessAt = this.nowFn();
    } catch {
      // fail-soft(Req 4.4):沿用上次成功快照,不更新 lastSuccessAt——下次 get() 仍视为
      // 过期,持续按 TTL 节奏重试,不在此记录敏感的上游异常细节。
    }
  }
}

/**
 * `mergeModelCatalog` 的块排序偏好(model-catalog spec):决定合并 models 数组中
 * 网关块与 self 块的先后顺序,不再是同名覆盖取舍。
 */
export type ModelPrecedence = "gateway" | "self";

/**
 * 目录 merge 纯函数(model-catalog spec design.md「mergeModelCatalog(重写)」,
 * Req 1.1–1.3, 2.1–2.3, 3.1):不改入参,不做网络/IO。
 *
 * - 网关条目映射为 `{ provider: "ai-gateway", id, name, source: "ai-gateway",
 *   channel: ownedBy, availability: "catalog" }`;self 条目附
 *   `source: "self", availability: "session"`。
 * - 去重 key = `${provider}/${id}`(防御性;self 与 gateway 的 provider 恒不同,
 *   理论无碰撞);同 key 重复时保留先出现者,后块不覆盖前块。
 * - `precedence` 仅决定两块在 models 数组中的先后(`"gateway"` = 网关块在前,
 *   `"self"` = self 块在前;块内保持入参原有顺序),不做跨归属覆盖删除。
 * - `providers` 仅含 self 来源 provider 去重排序(不含 `"ai-gateway"` 与渠道名)。
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
  const gatewayTagged: ModelOption[] = gatewayEntries.map((g) => ({
    provider: "ai-gateway",
    id: g.model,
    name: g.model,
    source: "ai-gateway" as const,
    channel: g.ownedBy,
    availability: "catalog" as const,
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
  // providers 仅含 self 来源 provider(可设为默认的集合,Req 2.2/3.1)。
  const providers = [...new Set(selfTagged.map((m) => m.provider))].sort();
  return { providers, models };
}
