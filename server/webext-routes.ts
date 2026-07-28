/**
 * webext 端点(spec vite-spa-migration 任务 3.2)。
 *
 * 迁移自两个 Next catch-all route:
 *   `app/api/webext/dist/[dir]/[...file]/route.ts` → handleWebextDist
 *   `app/api/webext/resolve/route.ts`              → handleWebextResolve
 *
 * 安全语义逐字保留:dist 托管经 realpath 前缀校验防目录穿越,且 dist 目录必须以
 * `.pi/web/dist` 结尾(校验在 `readDistFile` 内);resolve 只下发去签名的已背书 manifest
 * 与 baseUrl,验签机密不入浏览器。
 *
 * 本模块只导出处理器;路由注册由 `server/index.ts` 统一完成。
 */
import { getWebextTrust } from "../lib/app/webext/build-trust.js";
import {
  resolveWebext,
  type WebextResolveResponse,
} from "../lib/app/webext/resolve-webext.js";
import {
  decodeDistDir,
  readDistFile,
  locateDist,
  readManifestJson,
  toBaseUrl,
} from "../lib/app/webext/locate-dist.js";

/** GET /api/webext/dist/<base64url(distDir)>/<file...> */
export async function handleWebextDist(
  encodedDir: string,
  relPath: string,
): Promise<Response> {
  let distDir: string;
  try {
    distDir = decodeDistDir(encodedDir);
  } catch {
    return new Response("bad dir", { status: 400 });
  }
  if (relPath.length === 0) return new Response("file required", { status: 400 });

  const found = await readDistFile(distDir, relPath);
  if (found === undefined) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(found.bytes), {
    status: 200,
    headers: {
      "content-type": found.contentType,
      "cache-control": "no-store",
    },
  });
}

/** GET /api/webext/resolve?source=<source> */
export async function handleWebextResolve(url: URL): Promise<Response> {
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
