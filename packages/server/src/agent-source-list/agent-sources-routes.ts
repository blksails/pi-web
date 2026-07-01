/**
 * agent-sources-routes — GET /agent-sources 只读源枚举端点(agent-sources-list)。
 *
 *   GET /agent-sources?limit=&cursor= → ListAgentSourcesResponse
 *
 * 数据来源为「注册表 ∪ 目录扫描」经 CompositeSourceProvider 去重合并后的稳定列表。
 * 严格只读:不写、不 clone git、不 resolve/spawn。分页用不透明 keyset 游标
 * `{origin,name,id}`(base64url),以与列表排序**同一比较器**在已排序列表中定位「严格位于
 * 游标之后的首项」——即便游标记录在两次请求间消失,也不会重发/漏发(与 sessions-list 同法)。
 *
 * 经 `createAgentSourcesRoutes(opts)` 返回 `ReadonlyArray<InjectedRoute>`,直接传入
 * `createPiWebHandler({ routes })` 注入接缝(与 createSessionListRoutes 同构)。
 */
import type {
  AgentSourceItem,
  ListAgentSourcesResponse,
} from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import {
  createCompositeSourceProvider,
  compareAgentSourceRecords,
} from "./composite-provider.js";
import { createRegistrySourceProvider } from "./registry-provider.js";
import { createScanSourceProvider } from "./scan-provider.js";
import type { AgentSourceProvider, AgentSourceRecord } from "./types.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export interface AgentSourcesRoutesOptions {
  /** 扫描根目录(绝对路径,可多个);空数组表示不扫描。 */
  readonly scanRoots: readonly string[];
  /** 注册表 JSON 路径(可不存在)。 */
  readonly registryPath: string;
  /** 单页默认上限(默认 100)。 */
  readonly defaultPageSize?: number;
  /** 单页硬上限(默认 500)。 */
  readonly maxPageSize?: number;
  /**
   * 可选:注入自定义 provider(测试用)。提供时忽略 scanRoots/registryPath。
   */
  readonly provider?: AgentSourceProvider;
}

/** keyset 游标载荷:上一页最后一项的排序键分量(origin+name+id),供与排序同序定位。 */
interface CursorPayload {
  readonly origin: AgentSourceRecord["origin"];
  readonly name: string;
  readonly id: string;
}

function encodeCursor(r: AgentSourceRecord): string {
  const payload: CursorPayload = { origin: r.origin, name: r.name, id: r.id };
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
      ((obj as CursorPayload).origin === "scan" ||
        (obj as CursorPayload).origin === "registry") &&
      typeof (obj as CursorPayload).name === "string" &&
      typeof (obj as CursorPayload).id === "string"
    ) {
      const c = obj as CursorPayload;
      return { origin: c.origin, name: c.name, id: c.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 在已按 `compareAgentSourceRecords` 排序的列表中,定位首个严格位于游标之后的下标。
 * 游标以一个"虚拟记录"参与同一比较器;均不在其后返回列表长度。即便游标对应的真实记录
 * 已从列表消失,也能正确定位(不重发已返回项、不漏发)。
 */
function firstIndexAfter(
  sorted: ReadonlyArray<AgentSourceRecord>,
  cursor: CursorPayload,
): number {
  const probe: AgentSourceRecord = {
    id: cursor.id,
    source: cursor.id,
    name: cursor.name,
    kind: "dir",
    origin: cursor.origin,
    mode: "cli",
  };
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];
    if (item !== undefined && compareAgentSourceRecords(item, probe) > 0) {
      return i;
    }
  }
  return sorted.length;
}

/** 解析并 clamp 单页上限;非法(非整/≤0)返回 undefined。 */
function resolveLimit(
  raw: string | null,
  def: number,
  max: number,
): number | undefined {
  if (raw === null) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return Math.min(n, max);
}

function toItem(r: AgentSourceRecord): AgentSourceItem {
  return {
    id: r.id,
    source: r.source,
    name: r.name,
    kind: r.kind,
    origin: r.origin,
    mode: r.mode,
    ...(r.title !== undefined ? { title: r.title } : {}),
    ...(r.description !== undefined ? { description: r.description } : {}),
    ...(r.avatar !== undefined ? { avatar: r.avatar } : {}),
  };
}

export function createAgentSourcesRoutes(
  opts: AgentSourcesRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const defaultPageSize = opts.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = opts.maxPageSize ?? MAX_PAGE_SIZE;

  // 惰性单例 provider:首次请求时构造并缓存。
  let cached: AgentSourceProvider | undefined;
  const getProvider = (): AgentSourceProvider => {
    if (cached === undefined) {
      cached =
        opts.provider ??
        createCompositeSourceProvider(
          createRegistrySourceProvider({ registryPath: opts.registryPath }),
          createScanSourceProvider({ roots: opts.scanRoots }),
        );
    }
    return cached;
  };

  const route: InjectedRoute = {
    method: "GET",
    path: "/agent-sources",
    handler: async (ctx) => {
      const q = ctx.url.searchParams;

      const limit = resolveLimit(q.get("limit"), defaultPageSize, maxPageSize);
      if (limit === undefined) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid limit.", ["limit"]);
      }

      const cursorRaw = q.get("cursor");
      let cursor: CursorPayload | undefined;
      if (cursorRaw !== null) {
        cursor = decodeCursor(cursorRaw);
        if (cursor === undefined) {
          return errorResponse(400, "INVALID_REQUEST", "Invalid cursor.", [
            "cursor",
          ]);
        }
      }

      try {
        // Composite 已按 compareAgentSourceRecords 稳定排序;用同一比较器 keyset 定位切片。
        const all = await getProvider().list();
        const start = cursor === undefined ? 0 : firstIndexAfter(all, cursor);
        const page = all.slice(start, start + limit);
        const hasMore = start + limit < all.length;
        const last = page[page.length - 1];
        const nextCursor =
          hasMore && last !== undefined ? encodeCursor(last) : undefined;

        const body: ListAgentSourcesResponse = {
          sources: page.map(toItem),
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        };
        return jsonResponse(200, { ...body });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to list agent sources.");
      }
    },
  };

  return [route];
}
