/**
 * favorites-routes — GET/PUT /agent-sources/favorites(sidebar-launcher-rail)。
 *
 *   GET /agent-sources/favorites             → ListFavoritesResponse
 *   PUT /agent-sources/favorites { favorites } → ListFavoritesResponse(回显落盘结果)
 *
 * 收藏是用户偏好,独立于只读源枚举。PUT 全量替换(幂等)。经 `createFavoritesRoutes(opts)`
 * 返回 `ReadonlyArray<InjectedRoute>`,与 createAgentSourcesRoutes 并列注入。
 */
import {
  SetFavoritesRequestSchema,
  type ListFavoritesResponse,
} from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import { createFavoritesStore, type FavoritesStore } from "./favorites-store.js";

export interface FavoritesRoutesOptions {
  /** agent 目录;收藏文件落 `<agentDir>/agent-source-favorites.json`。 */
  readonly agentDir: string;
  /** 可选:注入自定义 store(测试用)。提供时忽略 agentDir。 */
  readonly store?: FavoritesStore;
}

export function createFavoritesRoutes(
  opts: FavoritesRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  let cached: FavoritesStore | undefined;
  const getStore = (): FavoritesStore => {
    if (cached === undefined) {
      cached =
        opts.store ??
        // M4:store 内部经 LocalWorkspace user 命名空间读写(键 agent-source-favorites.json),
        // 只需传 root=agentDir(不再拼完整 filePath)。
        createFavoritesStore({ root: opts.agentDir });
    }
    return cached;
  };

  const get: InjectedRoute = {
    method: "GET",
    path: "/agent-sources/favorites",
    handler: async () => {
      try {
        const favorites = await getStore().list();
        const body: ListFavoritesResponse = { favorites };
        return jsonResponse(200, { ...body });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to read favorites.");
      }
    },
  };

  const put: InjectedRoute = {
    method: "PUT",
    path: "/agent-sources/favorites",
    handler: async (ctx) => {
      let raw: unknown;
      try {
        raw = await ctx.req.json();
      } catch {
        return errorResponse(400, "INVALID_REQUEST", "Invalid JSON body.");
      }
      const parsed = SetFavoritesRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid favorites body.", [
          "favorites",
        ]);
      }
      try {
        const store = getStore();
        await store.set(parsed.data.favorites);
        // 回读落盘结果(经 store 容错解析),前端据此确认最新收藏集合。
        const favorites = await store.list();
        const body: ListFavoritesResponse = { favorites };
        return jsonResponse(200, { ...body });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to write favorites.");
      }
    },
  };

  return [get, put];
}
