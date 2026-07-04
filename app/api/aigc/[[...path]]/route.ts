/**
 * Catch-all AIGC API route(aigc-tool-settings)。
 *
 * 把 `/api/aigc/**` 无损转发到单例 `createPiWebHandler`,由其匹配注入的端点:
 *   - `GET /aigc/models`(createAigcModelsRoute,只读图像模型目录,供 /settings「模型开关」列举)
 * 返回 Response 不改写状态/头/体。与 `/api/agent-sources`、`/api/config` 等 catch-all 转发器同构。
 * 设置本体(被禁模型 / 提示词优化)走 `/api/config/aigc`,不经此段。
 *
 * ⚠ 新顶层 API 段必须自带此转发器,否则 `/api/aigc/*` 静默 404(handler 挂在 /api/** 下,但
 * Next App Router 需为每个顶层段声明路由文件)。Node runtime。
 */
import { getHandler } from "@/lib/app/pi-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}
