/**
 * POST /api/session-source — 记录 `sessionId → agent source` 的 app 级映射。
 *
 * 客户端在会话创建(`onSessionId`)后调用,使冷加载 `/session/:id` 能据 id 取回
 * source 重解析 `.pi/web` UI 扩展 —— 而无需把文件路径暴露到 URL。
 *
 * Node runtime:写本地文件(Edge 无 fs)。best-effort,记录失败不影响会话本身。
 */
import { recordSessionSource } from "@/lib/app/session-source-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const id = (body as { id?: unknown }).id;
  const source = (body as { source?: unknown }).source;
  if (typeof id !== "string" || typeof source !== "string") {
    return new Response("id and source must be strings", { status: 400 });
  }

  try {
    await recordSessionSource(id, source);
  } catch {
    // best-effort:映射写入失败不致命(冷加载会退回持久化 header.cwd 兜底)。
  }
  return new Response(null, { status: 204 });
}
