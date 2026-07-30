/**
 * session-list-routes — GET /sessions 只读会话列表端点(sessions-list)。
 *
 * - GET /sessions?scope=cwd|all&cwd=&limit=&cursor= → ListSessionsResponse
 * - 仅用会话头部轻量元数据(经 SessionEntryStore.list/listAll),不读会话正文。
 * - 排序键 `updatedAt ?? createdAt` 倒序,跨 fs/sqlite/postgres 后端一致。
 * - 内存切片分页:不透明游标 `{ts,id}` keyset 续取,保证不重复已返回会话。
 * - `scope=all`(系统/全机器视图)受 `globalEnabled` 门控,关闭时直接 403、不触达存储。
 * - 单会话元数据损坏由 store 适配器跳过(本端点不另行处理),不使整体请求失败。
 *
 * 经 `createSessionListRoutes(opts)` 返回 `ReadonlyArray<InjectedRoute>`,直接传入
 * `createPiWebHandler({ routes })` 的 `routes?` 注入接缝(与 createConfigRoutes 同构)。
 */
import type {
  ListSessionsResponse,
  SessionActivity,
  SessionListItem,
} from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import {
  type SessionEntryStore,
  type SessionMeta,
} from "../session-store/index.js";
import type { SessionMetaEntry, SessionMetaIndex } from "../session-meta/types.js";

/** 元数据缺席时的共享空表(避免每请求新建)。 */
const EMPTY_META: ReadonlyMap<string, SessionMetaEntry> = new Map();

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * displayName 派生的最大并发度。fs 后端每项需顺读整份 jsonl,页项数最多 MAX_PAGE_SIZE(200);
 * 无界 Promise.all 会一次性并发全页 → fd/IO 压力峰值。用有界池把并发压到常量,牺牲少量延迟换稳态。
 */
const DISPLAY_NAME_CONCURRENCY = 8;

/**
 * 有界并发 map:保持输入顺序,同一时刻最多 `limit` 个 worker 在跑。零依赖(不引 p-limit)。
 * `fn` 抛出由调用方自行处理(本文件的 enrich 已在 fn 内吞错,故池内不会 reject)。
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i]!, i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface SessionListRoutesOptions {
  /** 存储后端配置(与冷恢复同源,经 sessionStoreConfigFromEnv() 取)。 */
  /**
   * 会话事件 store 的**构造能力**,由装配层注入(spec: core-package-extraction 任务 4.1)。
   *
   * 原本这里直接调后端选型工厂,而那个工厂要认识每个后端,
   * 其中 postgres 值依赖 `pg` —— 内核包的依赖声明不得出现数据库驱动(R1.2)。
   * 故工厂随 postgres 实现搬去兼容层包,内核只留**配置形状**与这条注入缝。
   *
   * 惰性调用:仅在首个请求真的需要 store 时才触发(与原本的惰性单例语义一致)。
   */
  readonly createEntryStore: () => Promise<SessionEntryStore>;
  /** 系统(全机器)视图是否启用;关闭时 scope=all 一律拒绝。 */
  readonly globalEnabled: boolean;
  /** scope=cwd 缺省 cwd。 */
  readonly defaultCwd: string;
  /** 单页默认上限(默认 50)。 */
  readonly defaultPageSize?: number;
  /** 单页硬上限(默认 200)。 */
  readonly maxPageSize?: number;
  /**
   * 会话展示元数据索引(spec session-meta-index)。**可选**:省略时行为与本特性引入前完全一致
   * (标题走既有派生、source 留空),既有测试与部署无需改动。
   */
  readonly metaIndex?: SessionMetaIndex;
  /**
   * 活跃态查询(spec session-meta-index, Req 7.5):由装配层从**活跃会话注册表**构造。
   * 会话未加载 → 返回 undefined(视为空闲)。本端点**不**为取状态加载任何会话,
   * 也刻意不认识 SessionManager —— 只收这一个回调。
   */
  readonly activityOf?: (sessionId: string) => SessionActivity | undefined;
}

/** 不透明游标载荷:上一页最后一项的排序键 + 会话标识。 */
interface CursorPayload {
  readonly ts: string;
  readonly id: string;
}

/** 排序键:最近更新优先,回退创建时间(部分后端无 updatedAt)。 */
function sortKey(m: SessionMeta): string {
  return m.updatedAt ?? m.createdAt;
}

/** 倒序比较:(排序键 desc, sessionId desc),保证全序、稳定。 */
function cmpDesc(a: SessionMeta, b: SessionMeta): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? 1 : -1;
  return 0;
}

/** 某项是否严格排在游标项之后(倒序语义)。 */
function isAfterCursor(m: SessionMeta, cur: CursorPayload): boolean {
  const k = sortKey(m);
  if (k !== cur.ts) return k < cur.ts;
  return m.sessionId < cur.id;
}

function encodeCursor(m: SessionMeta): string {
  const payload: CursorPayload = { ts: sortKey(m), id: m.sessionId };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** 解码游标;非法返回 undefined(由调用方转 400)。 */
function decodeCursor(raw: string): CursorPayload | undefined {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const obj: unknown = JSON.parse(json);
    if (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as CursorPayload).ts === "string" &&
      typeof (obj as CursorPayload).id === "string"
    ) {
      return { ts: (obj as CursorPayload).ts, id: (obj as CursorPayload).id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 标题解析(spec session-meta-index, Req 2.2/2.3/9.5/9.7)——按**后端是否自维护名称**分流:
 *
 * - store **不实现** `displayName`(sqlite/postgres:append session_info 时已 UPDATE name 列)
 *   → `SessionMeta.name` 即最新,直接用,索引不参与标题(不产生第二权威,Req 9.5)。
 * - store **实现** `displayName`(fs:`name` 仅来自 header、**不随** session_info 更新)→
 *   ① 索引命中 title 即用之,**不调用** displayName(命中即不扫整份 jsonl,Req 2.2);
 *   ② 未命中则走既有派生(有界并发池),派生到即用并**回填**索引(Req 3.6/9.7,回填失败静默);
 *   ③ 派生不到保留 header 的 name。
 *
 * 这一分流是必要的:若一律「name 非空就跳过派生」,fs 后端所有创建时即命名的会话会显示
 * **陈旧的 header 名** —— 既有代码刻意用 session_info 名覆盖它。
 */
async function resolveTitles(
  store: SessionEntryStore,
  items: readonly SessionMeta[],
  meta: ReadonlyMap<string, SessionMetaEntry>,
  metaIndex: SessionMetaIndex | undefined,
): Promise<SessionMeta[]> {
  if (typeof store.displayName !== "function") return [...items];
  return mapWithConcurrency(items, DISPLAY_NAME_CONCURRENCY, async (m) => {
    const cached = meta.get(m.sessionId)?.title;
    if (cached !== undefined && cached.length > 0) return { ...m, name: cached };
    try {
      const derived = await store.displayName!(m.sessionId);
      if (derived !== undefined && derived.length > 0) {
        // 回填:下次列出该会话即命中索引,不必再顺读整份 jsonl。fire-and-forget。
        void metaIndex?.merge(m.sessionId, { title: derived });
        return { ...m, name: derived };
      }
      return m;
    } catch {
      return m;
    }
  });
}

function toItem(
  m: SessionMeta,
  meta: ReadonlyMap<string, SessionMetaEntry>,
  activityOf: ((sessionId: string) => SessionActivity | undefined) | undefined,
): SessionListItem {
  const agentSource = meta.get(m.sessionId)?.agentSource;
  // 活跃态:运行时投影,取不到即空闲(字段省略)。聚合器抛错不得拖垮整个列表。
  let activity: SessionActivity | undefined;
  try {
    activity = activityOf?.(m.sessionId);
  } catch {
    activity = undefined;
  }
  return {
    sessionId: m.sessionId,
    cwd: m.cwd,
    createdAt: m.createdAt,
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.updatedAt !== undefined ? { updatedAt: m.updatedAt } : {}),
    ...(agentSource !== undefined && agentSource.length > 0
      ? { source: agentSource }
      : {}),
    ...(activity !== undefined ? { activity } : {}),
  };
}

/** 解析并 clamp 单页上限。 */
function resolveLimit(raw: string | null, def: number, max: number): number | undefined {
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined; // 非法
  return Math.min(n, max);
}

export function createSessionListRoutes(
  opts: SessionListRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const defaultPageSize = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = opts.maxPageSize ?? MAX_PAGE_SIZE;

  // 惰性单例 store:首次请求时构造并缓存(避免把同步装配改为 async)。
  // 构造失败(如 sqlite 文件锁 / pg 连接抖动)不缓存 rejected promise —— 否则 `??=` 认为已赋值,
  // 后续每个请求都复用同一个 rejected promise → 端点永久 500 直到进程重启。失败即清空以允许重试。
  let storePromise: Promise<SessionEntryStore> | undefined;
  const getStore = (): Promise<SessionEntryStore> => {
    storePromise ??= opts.createEntryStore().catch((err: unknown) => {
      storePromise = undefined;
      throw err;
    });
    return storePromise;
  };

  const route: InjectedRoute = {
    method: "GET",
    path: "/sessions",
    handler: async (ctx) => {
      const q = ctx.url.searchParams;

      // scope 校验(默认 cwd)。
      const scopeRaw = q.get("scope") ?? "cwd";
      if (scopeRaw !== "cwd" && scopeRaw !== "all") {
        return errorResponse(400, "INVALID_REQUEST", "Invalid scope.", ["scope"]);
      }
      const scope: "cwd" | "all" = scopeRaw;

      // 系统视图门控:关闭时拒绝 scope=all,且不触达存储。
      if (scope === "all" && !opts.globalEnabled) {
        return errorResponse(
          403,
          "SESSIONS_GLOBAL_DISABLED",
          "System-wide session listing is not enabled.",
        );
      }

      // limit 校验 + clamp。
      const limit = resolveLimit(q.get("limit"), defaultPageSize, maxPageSize);
      if (limit === undefined) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid limit.", ["limit"]);
      }

      // cursor 解码(可选)。
      const cursorRaw = q.get("cursor");
      let cursor: CursorPayload | undefined;
      if (cursorRaw !== null) {
        cursor = decodeCursor(cursorRaw);
        if (cursor === undefined) {
          return errorResponse(400, "INVALID_REQUEST", "Invalid cursor.", ["cursor"]);
        }
      }

      try {
        const store = await getStore();
        let metas: SessionMeta[];
        if (scope === "all") {
          metas = await store.listAll();
        } else {
          // scope=cwd:优先用 sessionId 解析「当前会话所在目录」(agent 解析后的真实
          // cwd,前端无从可靠推断),回退 cwd 参数 / 默认 cwd。
          let targetCwd = q.get("cwd") ?? opts.defaultCwd;
          const sid = q.get("sessionId");
          if (sid !== null && sid.length > 0) {
            try {
              targetCwd = (await store.readHeader(sid)).cwd;
            } catch {
              // 会话不存在 → 回退默认/参数 cwd。
            }
          }
          metas = await store.list(targetCwd);
        }

        // 名称搜索(sidebar-launcher-rail Req 3.2/3.6):非空 q 时按会话**名称/显示名** + 标识
        // 子串(大小写不敏感)过滤,置于排序/分页前;空 q / 无 q 行为不变(向后兼容 Req 6.2)。
        // header 未命名的会话其标题在 session_info(auto-title),故有搜索关键字时先富集全量
        // displayName 再过滤(有界并发,O(n) 仅在搜索时付出;空 q 不付此代价)。不检索正文(Req 3.6)。
        // 元数据索引整份读一次(spec session-meta-index):一次文件读远低于 per-item 扫 jsonl,
        // 故不做进程内缓存(避免缓存失效带来的第二类错误)。读失败即空 Map,全部退化到既有路径。
        // 端口契约说 read() 绝不抛,但端点**不信任**注入实现会遵守 —— 元数据是展示增强,
        // 任何读失败都不得把列表请求拖成 500(Req 3.5)。
        let meta: ReadonlyMap<string, SessionMetaEntry> = EMPTY_META;
        if (opts.metaIndex !== undefined) {
          try {
            meta = await opts.metaIndex.read();
          } catch {
            meta = EMPTY_META;
          }
        }

        const qRaw = q.get("q");
        const qNorm = qRaw !== null ? qRaw.trim().toLowerCase() : "";
        let filtered: SessionMeta[];
        if (qNorm.length === 0) {
          filtered = metas;
        } else {
          const enrichedForSearch = await resolveTitles(
            store,
            metas,
            meta,
            opts.metaIndex,
          );
          filtered = enrichedForSearch.filter((m) =>
            `${m.name ?? ""} ${m.sessionId}`.toLowerCase().includes(qNorm),
          );
        }

        const sorted = [...filtered].sort(cmpDesc);
        const startIdx =
          cursor === undefined ? 0 : firstIndexAfter(sorted, cursor);
        const page = sorted.slice(startIdx, startIdx + limit);
        const hasMore = startIdx + limit < sorted.length;
        const last = page[page.length - 1];
        const nextCursor =
          hasMore && last !== undefined ? encodeCursor(last) : undefined;

        // 标题解析(auto-session-title Req 8.4 + session-meta-index Req 2.2/2.3):索引命中即用,
        // 未命中走既有 displayName 派生并回填;sqlite/postgres(不实现 displayName)整页原样返回。
        const enriched = await resolveTitles(store, page, meta, opts.metaIndex);

        const body: ListSessionsResponse = {
          sessions: enriched.map((m) => toItem(m, meta, opts.activityOf)),
          scope,
          globalEnabled: opts.globalEnabled,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        };
        return jsonResponse(200, { ...body });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to list sessions.");
      }
    },
  };

  return [route];
}

/** 在倒序数组中定位首个严格位于游标之后的下标;均不在其后则返回长度。 */
function firstIndexAfter(
  sorted: ReadonlyArray<SessionMeta>,
  cursor: CursorPayload,
): number {
  for (let i = 0; i < sorted.length; i += 1) {
    const m = sorted[i];
    if (m !== undefined && isAfterCursor(m, cursor)) return i;
  }
  return sorted.length;
}
