/**
 * `assets-list` — 素材域 pane 自带的声明式 HTTP route(Wave 5 · G2①,列表数据面)。
 *
 * 承接宿主 GET /api/assets 列表语义(生成素材,tenant/session 过滤):子进程经
 * ../platform-client.js 回调父进程 /api/internal/platform/assets/list
 * (HMAC + scope assets:read,租户取 claims.tid)——与 attachmentCatalog 同一回调,
 * 响应 Page<AssetRecord> 与宿主 /api/assets GET 同构,web 侧解析零适配。
 *
 * 只读(R-0a):素材域的写路径(目录 CRUD/删除/改名)不入 agent route,留宿主/控制面。
 * 降级:平台接缝不可用/回调失败 → { error: "platform_unavailable", items: [] }。
 *
 * 外部调用:GET /api/sessions/<sid>/agent-routes/assets-list?sessionId=&kind=&limit=&cursor=
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import { getPlatformContext, type AssetQuery } from "../platform-client.js";

const KINDS = new Set(["image", "video", "audio"]);

export async function assetsListHandler(req: AgentRouteRequest): Promise<unknown> {
  const platform = getPlatformContext();
  if (!platform.available) return { error: "platform_unavailable", items: [] };

  const { sessionId, kind, limit, cursor } = req.query;
  const q: {
    sessionId?: string;
    kind?: AssetQuery["kind"];
    limit?: number;
    cursor?: string;
  } = {};
  if (typeof sessionId === "string" && sessionId !== "") q.sessionId = sessionId;
  if (typeof kind === "string" && KINDS.has(kind)) {
    q.kind = kind as AssetQuery["kind"];
  }
  if (typeof limit === "string" && limit !== "") {
    const n = Number(limit);
    if (Number.isFinite(n)) q.limit = n;
  }
  if (typeof cursor === "string" && cursor !== "") q.cursor = cursor;

  try {
    return await platform.listAssets(q);
  } catch {
    return { error: "platform_unavailable", items: [] };
  }
}

/** 路由声明:文件名 assets-list.ts === name「assets-list」=== URL /agent-routes/assets-list。 */
export const assetsListRoute: AgentRouteDecl = {
  name: "assets-list",
  // methods 缺省 → ["GET"](只读查询)。
  description: "生成素材列表(tenant/session 过滤,Page<AssetRecord>,与宿主 /api/assets GET 同构)",
  handler: assetsListHandler,
};
