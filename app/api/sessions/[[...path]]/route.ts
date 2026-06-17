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
