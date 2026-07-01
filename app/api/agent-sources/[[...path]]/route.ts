/**
 * Catch-all agent-sources API route(agent-sources-list)。
 *
 * 把 `/api/agent-sources/**` 无损转发到单例 `createPiWebHandler`,由其匹配注入的端点:
 *   - `GET /agent-sources`(createAgentSourcesRoutes,只读枚举)
 *   - `GET/PUT /agent-sources/favorites`(createFavoritesRoutes,收藏读写;sidebar-launcher-rail)
 * 返回 Response 不改写状态/头/体。与 `/api/sessions`、`/api/config` 等 catch-all 转发器同构。
 *
 * Node runtime:handler 复用 session-store/agent-source 只读探测面 + favorites fs 读写,Edge 不支持。
 */
import { getHandler } from "@/lib/app/pi-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}

export function PUT(req: Request): Promise<Response> {
  return getHandler()(req);
}
