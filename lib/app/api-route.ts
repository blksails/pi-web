/**
 * `/api/*` 的方法级入口(spec vite-spa-migration 任务 11.2)。
 *
 * 迁移前,node e2e 与集成测试直接 import Next 的 route handler
 * (`@/app/api/sessions/[[...path]]/route`)来驱动真实 `createPiWebHandler`。
 * 那些 route 文件随 `app/` 一并删除,故把它们的**语义**收在此处:与宿主
 * (`server/index.ts`)共享同一单例 handler 与同一会话删除清理规则。
 *
 * 这不是 Next 的接缝残留 —— 它是一个框架无关的、按 HTTP 方法暴露的薄入口,
 * 测试用它免去起 HTTP 服务,宿主用 `app.all("/api/*")` 走同一条路。
 */
import { getHandler } from "./pi-handler.js";
import { forgetSessionSource } from "./session-source-map.js";
import { wholeSessionIdFromUrl } from "../../server/session-url.js";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}

export function POST(req: Request): Promise<Response> {
  return getHandler()(req);
}

export function PUT(req: Request): Promise<Response> {
  return getHandler()(req);
}

/**
 * DELETE — 转发不变。整会话删除成功时顺带丢弃 `sessionId → source` 映射,
 * 避免陈旧条目堆积(Req 1.3)。子资源删除不触发(Req 1.4);清理失败不改变响应(Req 1.5)。
 */
export async function DELETE(req: Request): Promise<Response> {
  const res = await getHandler()(req);
  if (res.ok) {
    const id = wholeSessionIdFromUrl(req.url);
    if (id !== undefined) {
      try {
        await forgetSessionSource(id);
      } catch {
        // 尽力而为:绝不改变 handler 的响应。
      }
    }
  }
  return res;
}
