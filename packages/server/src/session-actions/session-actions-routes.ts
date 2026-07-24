/**
 * session-actions-routes — 会话操作端点(session-list-item-actions)。
 *
 *   POST /sessions/delete    { sessionId }        → CommandAck                    (幂等物理删除)
 *   POST /sessions/rename    { sessionId, name }  → RenameSessionResponse
 *   GET  /sessions/favorites                      → ListSessionFavoritesResponse
 *   POST /sessions/favorites { sessionIds }       → ListSessionFavoritesResponse  (全量替换回显)
 *
 * 设计要点(见 design.md):
 * - **无 `:id` 路径参数**:Router 对含 `:id` 的路由做内存会话存在性门控(router.ts),历史会话
 *   必然 404。故 sessionId 走请求体,端点路径不含 `:id`,绕过门控、可作用于历史会话。
 * - 统一 **POST**(读收藏用 GET):既有 `/sessions/**` 转发器只导出 GET/POST/DELETE,POST 命令
 *   与本仓 steer/abort/model idiom 一致,避免与内置 `DELETE /sessions/:id`(停内存会话)冲突。
 * - **删除**:`store.delete()` 物理删除;`SessionStoreNotFound` 视为幂等成功(Req 2.6)。
 * - **重命名**:向目标会话 append 一条 `session_info{name}`(新 id、parentId=null、当前时间戳),
 *   成为最新显示名(fs 扫文件派生 / sqlite·pg 维护 name 列),跨后端一致(Req 3.2/3.3)。
 * - **门控**:`manageEnabled=false` → 三个**写**端点 403 且不触达存储;GET favorites 不受门控(Req 4.9)。
 *
 * 经 `createSessionActionsRoutes(opts)` 返回 `ReadonlyArray<InjectedRoute>`,与 createSessionListRoutes
 * 并列注入 `createPiWebHandler({ routes })`。
 */
import { randomUUID } from "node:crypto";
import {
  DeleteSessionRequestSchema,
  RenameSessionRequestSchema,
  SetSessionFavoritesRequestSchema,
  type ListSessionFavoritesResponse,
  type RenameSessionResponse,
} from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute } from "../http/index.js";
import {
  createSessionEntryStore,
  SessionStoreNotFoundError,
  type SessionEntryStore,
  type SessionInfoEntry,
  type SessionStoreConfig,
} from "../session-store/index.js";
import {
  createSessionFavoritesStore,
  type SessionFavoritesStore,
} from "./session-favorites-store.js";


export interface SessionActionsRoutesOptions {
  /** 会话事件存储配置(与冷恢复 / 列表同源,经 sessionStoreConfigFromEnv() 取)。 */
  readonly storeConfig: SessionStoreConfig;
  /** agent 目录;会话收藏文件落 `<agentDir>/session-favorites.json`。 */
  readonly agentDir: string;
  /** 写操作(删除/重命名/收藏)是否启用;关闭时写端点 403、不改存储。 */
  readonly manageEnabled: boolean;
  /** 可选:注入自定义会话收藏 store(测试用)。提供时忽略 agentDir。 */
  readonly favoritesStore?: SessionFavoritesStore;
  /** 可选:注入自定义会话事件 store(测试用)。提供时忽略 storeConfig。 */
  readonly entryStore?: SessionEntryStore;
}

/** 读取并 JSON 解析请求体;非法返回 undefined(由调用方转 400)。 */
async function readJsonBody(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function createSessionActionsRoutes(
  opts: SessionActionsRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  // 惰性单例会话事件 store(同 createSessionListRoutes:失败不缓存 rejected promise)。
  let entryStorePromise: Promise<SessionEntryStore> | undefined;
  const getEntryStore = (): Promise<SessionEntryStore> => {
    if (opts.entryStore !== undefined) return Promise.resolve(opts.entryStore);
    entryStorePromise ??= createSessionEntryStore(opts.storeConfig).catch(
      (err: unknown) => {
        entryStorePromise = undefined;
        throw err;
      },
    );
    return entryStorePromise;
  };

  // 会话收藏 store(惰性单例)。
  let favoritesStore: SessionFavoritesStore | undefined;
  const getFavoritesStore = (): SessionFavoritesStore => {
    favoritesStore ??=
      opts.favoritesStore ??
      // M4:store 内部经 LocalWorkspace user 命名空间读写(键 session-favorites.json),传 root=agentDir。
      createSessionFavoritesStore({ root: opts.agentDir });
    return favoritesStore;
  };

  const deniedIfDisabled = (): Response | undefined =>
    opts.manageEnabled
      ? undefined
      : errorResponse(
          403,
          "SESSIONS_MANAGE_DISABLED",
          "Session management is disabled.",
        );

  const deleteRoute: InjectedRoute = {
    method: "POST",
    path: "/sessions/delete",
    handler: async (ctx) => {
      const denied = deniedIfDisabled();
      if (denied !== undefined) return denied;

      const body = await readJsonBody(ctx.req);
      const parsed = DeleteSessionRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid delete request.", [
          "sessionId",
        ]);
      }
      try {
        const store = await getEntryStore();
        try {
          await store.delete(parsed.data.sessionId);
        } catch (err) {
          // 目标不存在 → 幂等成功(已达成「不在列表」的目标状态,Req 2.6)。
          if (!(err instanceof SessionStoreNotFoundError)) throw err;
        }
        return jsonResponse(200, { ok: true });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to delete session.");
      }
    },
  };

  const renameRoute: InjectedRoute = {
    method: "POST",
    path: "/sessions/rename",
    handler: async (ctx) => {
      const denied = deniedIfDisabled();
      if (denied !== undefined) return denied;

      const body = await readJsonBody(ctx.req);
      const parsed = RenameSessionRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid rename request.", [
          "name",
        ]);
      }
      const { sessionId } = parsed.data;
      const name = parsed.data.name.trim();
      try {
        const store = await getEntryStore();
        // 会话不存在 → 无法命名(readHeader 抛 NotFound → 404);存在则 append 新 session_info。
        try {
          await store.readHeader(sessionId);
        } catch (err) {
          if (err instanceof SessionStoreNotFoundError) {
            return errorResponse(
              404,
              "SESSION_NOT_FOUND",
              `Session "${sessionId}" not found.`,
            );
          }
          throw err;
        }
        const entry: SessionInfoEntry = {
          type: "session_info",
          name,
          id: randomUUID(),
          parentId: null,
          timestamp: new Date().toISOString(),
        };
        await store.append(sessionId, entry);
        const res: RenameSessionResponse = { sessionId, name };
        return jsonResponse(200, { ...res });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to rename session.");
      }
    },
  };

  const listFavoritesRoute: InjectedRoute = {
    method: "GET",
    path: "/sessions/favorites",
    handler: async () => {
      try {
        const sessionIds = await getFavoritesStore().list();
        const body: ListSessionFavoritesResponse = { sessionIds };
        return jsonResponse(200, { ...body });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to read favorites.");
      }
    },
  };

  const setFavoritesRoute: InjectedRoute = {
    method: "POST",
    path: "/sessions/favorites",
    handler: async (ctx) => {
      const denied = deniedIfDisabled();
      if (denied !== undefined) return denied;

      const body = await readJsonBody(ctx.req);
      const parsed = SetSessionFavoritesRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "INVALID_REQUEST", "Invalid favorites body.", [
          "sessionIds",
        ]);
      }
      try {
        const store = getFavoritesStore();
        await store.set(parsed.data.sessionIds);
        // 回读落盘结果(经 store 去重容错),前端据此确认最新集合。
        const sessionIds = await store.list();
        const resBody: ListSessionFavoritesResponse = { sessionIds };
        return jsonResponse(200, { ...resBody });
      } catch {
        return errorResponse(500, "INTERNAL", "Failed to write favorites.");
      }
    },
  };

  return [deleteRoute, renameRoute, listFavoritesRoute, setFavoritesRoute];
}
