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
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
  // PWA 清单。缺失时会落到 `application/octet-stream` —— 浏览器仍能解析，
  // 但不符合规范，且 devtools 会提示 MIME 类型不正确。
  ".webmanifest": "application/manifest+json",
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
 * 内联 `<script>` 的 CSP hash(sha256-base64)。
 *
 * 浏览器对 `'sha256-…'` 的计算对象是 script 元素的**文本内容原文**(不含标签、不做 trim)。
 */
function sha256Script(source: string): string {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

/**
 * `index.html` 里全部内联 script 的 hash。
 *
 * SPA 下唯一的内联脚本是**单例 import map** —— 它必须内联(浏览器只认首个 import 之前的
 * import map,且外部 import map 支持面不足)。用 hash 精确放行它,即可移除 `'unsafe-inline'`。
 *
 * 结果按 `clientDir()` 缓存:index.html 在一次进程生命周期内不变。
 */
let cachedHashes: { readonly dir: string; readonly hashes: readonly string[] } | undefined;

export function inlineScriptHashes(): readonly string[] {
  const dir = clientDir();
  if (cachedHashes?.dir === dir) return cachedHashes.hashes;

  let hashes: readonly string[] = [];
  try {
    const html = readFileSync(join(dir, "index.html"), "utf8");
    hashes = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => sha256Script(m[1] as string),
    );
  } catch (err) {
    hashes = [];
    process.stderr.write(
      `[pi-web] 读取 index.html 失败,内联脚本 hash 为空: ${String(err)}\n`,
    );
  }
  // 静默降级到 `script-src 'self'` 会**禁掉 import map** —— 页面看似正常,代码 webext 却
  // 全部加载失败。宁可吵闹:产物必定含至少一个内联 script(import map)。
  if (hashes.length === 0) {
    process.stderr.write(
      `[pi-web] ⚠ 未在 ${join(dir, "index.html")} 找到内联 script;` +
        `生产 CSP 将禁止 import map,代码 webext 无法加载。\n`,
    );
  }
  cachedHashes = { dir, hashes };
  return hashes;
}

/**
 * 生产内容安全策略。
 *
 * 逐字段迁移自旧宿主的 production headers,并**收紧**两处:
 *
 *  - 禁 `unsafe-eval` —— 代码 webext 经同源原生动态 import 加载,不需要它(P0 已实证:
 *    产物 0 个 `new Function` / `eval(`,注入一个即被浏览器拦截)。
 *  - 移除 `script-src 'unsafe-inline'` —— 它在旧宿主里只为 Next 的内联 hydration bootstrap
 *    而存在(`next.config.ts` 注释自陈「无 nonce 基建时」)。SPA 下改为对 import map 做 hash 放行。
 *
 * `style-src 'unsafe-inline'` 保留:Tailwind 运行时注入与 webext 的 scoped CSS 需要它。
 */
export function productionCsp(): string {
  return [
    "default-src 'self'",
    // 外部脚本同源;唯一内联脚本(import map)经 hash 精确放行。
    `script-src 'self' ${inlineScriptHashes().join(" ")}`.trim(),
    // 样式:宿主 + 扩展 scoped css(同源);Tailwind 运行时注入需 inline。
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    // artifact:独立 origin sandbox iframe(srcdoc/blob)
    "frame-src 'self' blob: data:",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}
