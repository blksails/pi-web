/**
 * Catch-all attachment distribution route.
 *
 * Thin, lossless delegation of every `/api/attachments/**` request to the
 * singleton `createPiWebHandler`. The handler does method+path routing,
 * signature verification and byte streaming; this file only forwards the
 * standard Web `Request` and returns the handler's `Response` unchanged
 * (including the streamed body, `Content-Type` and `Cache-Control`), without
 * rewriting status / headers / body or buffering.
 *
 * Distribution (`GET /api/attachments/:id/raw?exp&sig`) is self-authenticating
 * via the signed URL and is intentionally NOT session-gated. The upload
 * endpoint (`POST /api/sessions/:id/attachments`) is served by the `sessions`
 * catch-all, not this route.
 *
 * Node runtime is mandatory: the handler streams from the local filesystem
 * backend — Edge/Serverless is unsupported.
 */
import { getHandler } from "@/lib/app/pi-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Promise<Response> {
  return getHandler()(req);
}
