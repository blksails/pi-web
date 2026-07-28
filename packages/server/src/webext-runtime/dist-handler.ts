/**
 * webext 运行时车道 · 产物静态件端点(`GET /api/webext/dist/<key>/<file...>`)。
 *
 * 浏览器按 `resolve` 返回的 `baseUrl` 取 `web-extension.mjs` / `ext.css` 等。读取实现由
 * 宿主注入:本机磁盘宿主做 realpath 前缀校验防目录穿越;云端宿主从 registry bundle
 * (内容寻址)取字节。**安全语义归实现方**——本处理器只做编解码与响应包装。
 */

export interface WebextDistDeps {
  /** 由 URL 段解码回 dist 寻址键(与 `toBaseUrl` 的编码互逆);非法应抛。 */
  decodeDistDir(encoded: string): string;
  /** 安全读取 dist 内文件;越权/不存在返回 undefined。 */
  readDistFile(
    distDir: string,
    relFile: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | undefined>;
}

export function createWebextDistHandler(
  deps: WebextDistDeps,
): (encodedDir: string, relPath: string) => Promise<Response> {
  return async (encodedDir: string, relPath: string): Promise<Response> => {
    let distDir: string;
    try {
      distDir = deps.decodeDistDir(encodedDir);
    } catch {
      return new Response("bad dir", { status: 400 });
    }
    if (relPath.length === 0) return new Response("file required", { status: 400 });

    const found = await deps.readDistFile(distDir, relPath);
    if (found === undefined) return new Response("not found", { status: 404 });

    return new Response(new Uint8Array(found.bytes), {
      status: 200,
      headers: {
        "content-type": found.contentType,
        "cache-control": "no-store",
      },
    });
  };
}

/** 扩展产物的 content-type 表(宿主实现 `readDistFile` 时可直接复用)。 */
export function webextContentTypeFor(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot < 0 ? "" : file.slice(dot).toLowerCase();
  switch (ext) {
    case ".mjs":
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
