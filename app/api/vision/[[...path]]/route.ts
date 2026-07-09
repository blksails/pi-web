/**
 * Catch-all Vision API route(spec canvas-vision-readout)。
 *
 * 把 `/api/vision/**` 无损转发到单例 `createPiWebHandler`,由其匹配注入的端点:
 *   - `GET /vision/models`(createVisionModelsRoute,只读「已配置凭证且支持图像输入」的模型清单,
 *     供 Canvas 工作台提示词栏的视觉模型选择器列举)
 * 返回 Response 不改写状态/头/体。与 `/api/aigc`、`/api/config` 等 catch-all 转发器同构。
 *
 * ⚠ 新顶层 API 段必须自带此转发器,否则 `/api/vision/*` 静默 404(handler 挂在 /api/** 下,但
 * Next App Router 需为每个顶层段声明路由文件)。本段只读,故仅导出 GET。Node runtime。
 */
import { getHandler } from "@/lib/app/pi-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}
