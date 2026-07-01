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
import type { ListSessionsResponse, SessionListItem } from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import {
  createSessionEntryStore,
  type SessionEntryStore,
  type SessionMeta,
  type SessionStoreConfig,
} from "../session-store/index.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface SessionListRoutesOptions {
  /** 存储后端配置(与冷恢复同源,经 sessionStoreConfigFromEnv() 取)。 */
  readonly storeConfig: SessionStoreConfig;
  /** 系统(全机器)视图是否启用;关闭时 scope=all 一律拒绝。 */
  readonly globalEnabled: boolean;
  /** scope=cwd 缺省 cwd。 */
  readonly defaultCwd: string;
  /** 单页默认上限(默认 50)。 */
  readonly defaultPageSize?: number;
  /** 单页硬上限(默认 200)。 */
  readonly maxPageSize?: number;
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
 * 对一页会话 meta 富集显示名(spec auto-session-title, Req 8.4):仅对 header 未命名项调用
 * `store.displayName`(若实现)派生最新 session_info 名。已命名项与 store 不支持 displayName 时原样返回。
 * 任一项派生失败静默忽略(展示增强,绝不让列表请求失败)。
 */
async function enrichDisplayNames(
  store: SessionEntryStore,
  page: readonly SessionMeta[],
): Promise<SessionMeta[]> {
  if (typeof store.displayName !== "function") return [...page];
  return Promise.all(
    page.map(async (m) => {
      if (m.name !== undefined && m.name.length > 0) return m;
      try {
        const name = await store.displayName!(m.sessionId);
        return name !== undefined && name.length > 0 ? { ...m, name } : m;
      } catch {
        return m;
      }
    }),
  );
}

function toItem(m: SessionMeta): SessionListItem {
  return {
    sessionId: m.sessionId,
    cwd: m.cwd,
    createdAt: m.createdAt,
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.updatedAt !== undefined ? { updatedAt: m.updatedAt } : {}),
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
  let storePromise: Promise<SessionEntryStore> | undefined;
  const getStore = (): Promise<SessionEntryStore> => {
    storePromise ??= createSessionEntryStore(opts.storeConfig);
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
        const qRaw = q.get("q");
        const qNorm = qRaw !== null ? qRaw.trim().toLowerCase() : "";
        let filtered: SessionMeta[];
        if (qNorm.length === 0) {
          filtered = metas;
        } else {
          const enrichedForSearch = await enrichDisplayNames(store, metas);
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

        // 自动标题展示(spec auto-session-title, Req 8.4):header 未命名的会话,按需经
        // store.displayName 派生最新 session_info 名,**仅对当前页未命名项**调用以限成本(fs 扫文件)。
        // sqlite/postgres 已在 append 时维护 name 列,其 SessionMeta.name 已正确 → 跳过、不重复查。
        const enriched = await enrichDisplayNames(store, page);

        const body: ListSessionsResponse = {
          sessions: enriched.map(toItem),
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
