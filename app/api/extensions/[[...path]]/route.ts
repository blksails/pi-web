/**
 * Catch-all extensions API route(builtin-plugin-command 任务 2.2)。
 *
 * 把 `/api/extensions/**` 无损转发到单例 `createPiWebHandler`,由其匹配注入的扩展安装
 * 端点(GET/POST /extensions、DELETE /extensions/:extId)。仅转发标准 Web Request /
 * Response,不改写状态/头/体。Node runtime:handler spawn 子进程(pi CLI)。
 */
import { getHandler } from "@/lib/app/pi-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}

export function POST(req: Request): Promise<Response> {
  return getHandler()(req);
}

export function DELETE(req: Request): Promise<Response> {
  return getHandler()(req);
}
