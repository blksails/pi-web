/**
 * Catch-all session API route.
 *
 * Thin, lossless delegation of every `/api/sessions/**` request to the singleton
 * `createPiWebHandler`. The handler does method+path routing and SSE encoding;
 * this file only forwards the standard Web `Request` and returns the handler's
 * `Response` unchanged (including the SSE `ReadableStream` body), without
 * rewriting status / headers / body or buffering (Req 2.3 / 2.4).
 *
 * Node runtime is mandatory: the handler spawns child processes and holds SSE
 * long-connections — Edge/Serverless is unsupported (Req 1.4 / 2.2).
 */
import { getHandler } from "@/lib/app/pi-handler";
import { forgetSessionSource } from "@/lib/app/session-source-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}

export function POST(req: Request): Promise<Response> {
  return getHandler()(req);
}

/**
 * DELETE — forwarded to the handler unchanged. When it is a whole-session delete
 * (`/api/sessions/:id`) that the handler accepts, also drop the app-level
 * `sessionId → source` mapping so it does not accumulate stale entries. The
 * cleanup is best-effort and never alters the handler's response; sub-resource
 * deletes (extra path segments) are left untouched.
 */
export async function DELETE(req: Request): Promise<Response> {
  const res = await getHandler()(req);
  if (res.ok) {
    const id = wholeSessionIdFromUrl(req.url);
    if (id !== undefined) await forgetSessionSource(id);
  }
  return res;
}

/** Extract `:id` from exactly `/api/sessions/:id` (whole-session delete); else undefined. */
function wholeSessionIdFromUrl(url: string): string | undefined {
  const raw = new URL(url).pathname.match(/\/api\/sessions\/([^/]+)\/?$/)?.[1];
  return raw !== undefined ? decodeURIComponent(raw) : undefined;
}
