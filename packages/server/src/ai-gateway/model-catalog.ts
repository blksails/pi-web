/**
 * ai-gateway · 模型目录与聚合(design.md §2.4,Req Story 4)。
 *
 * `GatewayModelCatalog` 惰性 + TTL 拉取网关 `GET /v1/models`:`get()` 命中过期即触发
 * 后台刷新(不阻塞调用方),返回现有快照(stale-while-revalidate);拉取失败沿用上次
 * 成功快照(fail-soft,Req 4.4);从未成功过 → 空集,不影响自配目录展示。
 *
 * `mergeModelCatalog` 是纯函数:`self ∪ gateway`,每条目带来源标记
 * `source: "ai-gateway" | "self"`;同名(相同 `id`)按 `modelPrecedence` 取舍
 * (默认 `"gateway"` 优先,可经 `PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE=self` 反转,
 * Req 4.2/4.3)。接入点见 `lib/app/pi-handler.ts` 的 `createConfigRoutes({
 * listModelOptions })` 装配处(task 4.1)。
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

/** `mergeModelCatalog` 的同名冲突取舍优先级。 */
export type ModelPrecedence = "gateway" | "self";

/**
 * 目录 merge 纯函数(design.md §2.4,Req 4.2/4.3):`self ∪ gateway`,每条目带来源标记;
 * 同名(相同 `id`)按 `precedence` 取舍(默认 `"gateway"` 优先)。不改入参,不做网络/IO。
 */
export function mergeModelCatalog(
  selfEntries: readonly ModelOption[],
  gatewayEntries: readonly GatewayModelEntry[],
  precedence: ModelPrecedence = "gateway",
): ModelOptions {
  const selfTagged: ModelOption[] = selfEntries.map((m) => ({ ...m, source: "self" as const }));
  const gatewayTagged: ModelOption[] = gatewayEntries.map((g) => ({
    provider: g.ownedBy,
    id: g.model,
    name: g.model,
    source: "ai-gateway" as const,
  }));

  // 先放低优先级,再放高优先级覆盖同名 id,天然实现"同名按 precedence 取舍"。
  const [low, high] =
    precedence === "gateway" ? [selfTagged, gatewayTagged] : [gatewayTagged, selfTagged];
  const byId = new Map<string, ModelOption>();
  for (const m of low) byId.set(m.id, m);
  for (const m of high) byId.set(m.id, m);

  const models = [...byId.values()];
  const providers = [...new Set(models.map((m) => m.provider))].sort();
  return { providers, models };
}
