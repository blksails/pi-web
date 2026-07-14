/**
 * pi-web server — 脱 Next 的宿主装配。
 *
 * 取代 `app/api/**` 下 11 个转发器文件:`createPiWebHandler` 本就是标准
 * `(Request) => Promise<Response>`,SSE 的 `ReadableStream` 响应体原样透传,
 * 故整个 `/api/*` 面只需一条 `app.all`。
 *
 * Hono 在此**只作为 fetch↔Node 适配器**使用(`@hono/node-server` 负责
 * `IncomingMessage` ↔ Web `Request`/`Response` 的桥接,含 SSE 流式响应),
 * 不引入框架级抽象 —— 避免用一个框架依赖替换另一个。
 *
 * 本文件是**唯一**注册路由的地方(spec vite-spa-migration 任务 3.3):`singletons.ts` 与
 * `webext-routes.ts` 只交付处理器,不自行挂载,以免并行开发时争抢同一路由表。
 *
 * ⚠ 产物入口必须位于**产物根**(`dist/server.mjs`)。`packages/server` 的
 * `runnerBootstrapPath()` / `resolvePiCliEntry()` 在 `import.meta.url` 被打包器内联后
 * 会回退到 `process.cwd()`,而 CLI 以 `dirname(serverJs)` 作 cwd。入口若置于子目录,
 * 该回退全部失效,异机/异 OS 上真实会话必崩。
 */
// ⚠ 必须是第一个 import:加载 `.env` / `.env.local`(旧宿主由 Next 内置完成)。
// 下面的模块在求值时就会读 process.env(如 isProduction、pi-handler 的 loadConfig)。
import "./load-env.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getHandler, shutdownHandler } from "../lib/app/pi-handler.js";
import { forgetSessionSource } from "../lib/app/session-source-map.js";
import { buildBootstrap } from "./bootstrap.js";
import { handleSingleton } from "./singletons.js";
import { handleWebextDist, handleWebextResolve } from "./webext-routes.js";
import { serveSpaFallback, serveStatic, productionCsp } from "./static.js";
import { wholeSessionIdFromUrl } from "./session-url.js";

const app = new Hono();
const isProduction = process.env.NODE_ENV === "production";

/**
 * 鉴权门(接缝)。
 *
 * 多租户门控(`PI_WEB_MULTI_TENANT`)与 Supabase 登录墙尚未合入 main —— 本文件基于 main
 * 装配,故此处只保留接缝:门控关闭(默认)时表现与本中间件不存在完全一致(Req 1.6)。
 *
 * 合并后,原 `middleware.ts` 的逻辑迁到这里:未登录时页面重定向 `/login`、`/api/*` 返回 401,
 * `/login` 与 `/api/webext/*` 为公共路径。
 *
 * 迁移收益:Hono 中间件跑在 Node runtime,不再受 Next Edge runtime 约束,可以直接
 * `import { isMultiTenant } from "@blksails/pi-web-server"` —— 旧 middleware 因 Edge 打包
 * 会拉入 `node:fs` 而失败,只好手写一行 env 判断来复刻它。
 */
app.use("*", async (c, next) => {
  await next();
  if (isProduction) c.res.headers.set("content-security-policy", productionCsp());
});

// ── webext 端点(须早于通用 /api/* 转发,否则被 handler 抢匹配) ──────────────
app.get("/api/webext/singletons/:name", (c) => handleSingleton(c.req.param("name")));

app.get("/api/webext/resolve", (c) => handleWebextResolve(new URL(c.req.url)));

app.get("/api/webext/dist/:dir/*", (c) => {
  const dir = c.req.param("dir");
  const prefix = `/api/webext/dist/${dir}/`;
  const rel = new URL(c.req.url).pathname.slice(prefix.length);
  return handleWebextDist(dir, rel);
});

/** SPA 运行时配置(替代 server component 的 props 注入 + 构建期内联的 NEXT_PUBLIC_*)。 */
app.get("/api/bootstrap", async (c) => c.json(await buildBootstrap(new URL(c.req.url))));

/**
 * 其余 `/api/*` → 单例 handler。
 *
 * `c.req.raw` 是标准 `Request`;handler 返回的 `Response`(含 SSE `ReadableStream` body)
 * 原样交还,不重写 status/headers/body、不缓冲。
 */
app.all("/api/*", async (c) => {
  const res = await getHandler()(c.req.raw);

  // 整会话删除成功时,顺带丢弃 app 级 sessionId → source 映射,避免陈旧条目堆积。
  // 尽力而为,绝不改变 handler 的响应(Req 1.5);子资源删除(多余路径段)不触发(Req 1.4)。
  if (c.req.method === "DELETE" && res.ok) {
    const id = wholeSessionIdFromUrl(c.req.url);
    if (id !== undefined) {
      try {
        await forgetSessionSource(id);
      } catch {
        // 清理失败不影响 handler 的原始响应。
      }
    }
  }
  return res;
});

// ── 前端静态资源 + SPA 回退 ────────────────────────────────────────────────
app.get("*", async (c) => {
  const { pathname } = new URL(c.req.url);
  const asset = await serveStatic(pathname);
  return asset ?? (await serveSpaFallback());
});

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  process.stdout.write(`pi-web on http://${hostname}:${info.port}\n`);
});

async function shutdown(): Promise<void> {
  server.close();
  await shutdownHandler();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
