/**
 * Catch-all config API route.
 *
 * Thin, lossless delegation of every `/api/config/**` request to the singleton
 * `createPiWebHandler` (which has the injected config routes: GET/PUT
 * /config/:domain). Mirrors the sessions route — forwards the standard Web
 * `Request` and returns the handler `Response` unchanged.
 *
 * Node runtime is mandatory: the handler reads/writes `~/.pi/agent/*.json`.
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
