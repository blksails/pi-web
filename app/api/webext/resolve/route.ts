/**
 * GET /api/webext/resolve?source=<source> — 按源解析已装 webext(webext-package-install 任务 2.3)。
 *
 * 自描述发现 + 服务端验签 → { found, manifest(已背书), baseUrl, rejectedReason }。
 * 验签机密不下发浏览器:仅返回去签名的已背书 manifest 与 baseUrl。
 */
import { getWebextTrust } from "@/lib/app/webext/build-trust";
import {
  resolveWebext,
  type WebextResolveResponse,
} from "@/lib/app/webext/resolve-webext";
import {
  locateDist,
  readManifestJson,
  toBaseUrl,
} from "@/lib/app/webext/locate-dist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  if (source === null || source.length === 0) {
    return new Response("source query required", { status: 400 });
  }

  const { trust } = await getWebextTrust();
  let result: WebextResolveResponse;
  try {
    result = await resolveWebext(source, {
      locateDist,
      readManifestJson,
      toBaseUrl,
      trust,
    });
  } catch (err) {
    result = {
      found: true,
      rejectedReason: err instanceof Error ? err.message : String(err),
    };
  }
  return Response.json(result);
}
