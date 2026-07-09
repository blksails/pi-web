/**
 * 前端静态托管 + SPA 回退(spec vite-spa-migration 任务 3.3,Req 3.4/4.5/4.6)。
 *
 * 目录解析基于 `process.cwd()` —— 与 `runnerBootstrapPath()` / `resolvePiCliEntry()` 同一约定:
 * **产物以 cwd = 产物根启动**。esbuild 会把 `import.meta.url` 内联为构建机绝对路径,异机必然
 * 失效,故不可用它推算资源位置。
 *
 * `public/` 的内容(含 Tier4 隔离表面的 `webext-artifact/artifact.html`)由 vite 拷入
 * `client/`,因此与前端资源同源托管,无需单独分支。
 */
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

/** 产物根下的前端目录;dev/e2e 可经 env 指向别处。 */
export function clientDir(): string {
  return resolve(process.env.PI_WEB_CLIENT_DIR ?? join(process.cwd(), "client"));
}

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 把 URL 路径解析为 `client/` 内的绝对路径。
 * 越出 `client/` 的路径(`..` 穿越)返回 undefined。
 */
export function resolveWithinClient(
  pathname: string,
  root = clientDir(),
): string | undefined {
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return undefined;
    }
  })();
  if (decoded === undefined) return undefined;

  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return undefined;
  return candidate;
}

async function readIfFile(path: string): Promise<Buffer | undefined> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return undefined;
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * 静态资源;命中返回 Response,未命中返回 undefined(交给 SPA 回退)。
 * 带指纹的 assets 长缓存;其余不缓存(index.html 必须每次取新)。
 */
export async function serveStatic(pathname: string): Promise<Response | undefined> {
  if (pathname === "/") return undefined; // 交给 SPA 回退,统一从 index.html 出
  const abs = resolveWithinClient(pathname);
  if (abs === undefined) return undefined;

  const bytes = await readIfFile(abs);
  if (bytes === undefined) return undefined;

  const immutable = pathname.startsWith("/assets/");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": mimeFor(abs),
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-store",
    },
  });
}

/** SPA 回退:任何非 `/api/*` 且未命中静态资源的路径都返回入口文档(Req 3.4)。 */
export async function serveSpaFallback(): Promise<Response> {
  const index = join(clientDir(), "index.html");
  const bytes = await readIfFile(index);
  if (bytes === undefined) {
    return new Response(
      "前端产物缺失:未找到 client/index.html。请先执行前端构建。",
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * 生产内容安全策略。
 *
 * 逐字段迁移自 `next.config.ts` 的 production headers。禁 `unsafe-eval` —— 代码 webext 经同源
 * 原生动态 import 加载,不需要它(P0 已实证)。
 *
 * `'unsafe-inline'` 在旧宿主里是为 Next 的内联 hydration bootstrap 而存在;SPA 下唯一的内联
 * 脚本是 `index.html` 的 import map。收紧到 hash 放行是任务 11.4 的工作,此处暂时保持一致以
 * 隔离变量(先证明宿主等价,再收紧策略)。
 */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-src 'self' blob: data:",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");
