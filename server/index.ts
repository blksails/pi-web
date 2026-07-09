/**
 * pi-web server — 脱 Next 的宿主装配(P1)。
 *
 * 取代 `app/api/**` 下 11 个转发器文件:`createPiWebHandler` 本就是标准
 * `(Request) => Promise<Response>`,SSE 的 `ReadableStream` 响应体原样透传,
 * 故整个 `/api/*` 面只需一条 `app.all`。
 *
 * Hono 在此**只作为 fetch↔Node 适配器**使用(`@hono/node-server` 负责
 * `IncomingMessage` ↔ Web `Request`/`Response` 的桥接,含 SSE 流式响应),
 * 不引入框架级抽象 —— 避免用一个框架依赖替换另一个。
 *
 * 与 Next 并存:跑在独立端口,业务行为应逐字节等价(见 e2e/parity/)。
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getHandler, shutdownHandler } from "../lib/app/pi-handler.js";
import { forgetSessionSource } from "../lib/app/session-source-map.js";
import { buildBootstrap } from "./bootstrap.js";

const app = new Hono();

/**
 * 鉴权门。
 *
 * 多租户门控(`PI_WEB_MULTI_TENANT`)与 Supabase 登录墙在 `feat/multi-tenancy` 分支上,
 * 尚未合入 main —— 本文件基于 main 装配,故此处只保留接缝。合并后,原
 * `middleware.ts` 的逻辑迁到这里:关闭时直接 next()(等价本中间件不存在);开启时未登录
 * 页面重定向 `/login`、`/api/*` 返回 401,`/login` 与 `/api/webext/*` 为公共路径。
 *
 * 迁移收益:Hono 中间件跑在 Node runtime,不再受 Next Edge runtime 约束,可以直接
 * `import { isMultiTenant } from "@blksails/pi-web-server"`,不必手写一行 env 判断来复刻它。
 */
app.use("*", async (c, next) => {
  await next();
});

/** SPA 运行时配置(替代 server component 的 props 注入 + 构建期内联的 NEXT_PUBLIC_*)。 */
app.get("/api/bootstrap", async (c) => {
  const payload = await buildBootstrap(new URL(c.req.url));
  return c.json(payload);
});

/**
 * 整个 `/api/*` 面 → 单例 handler。
 *
 * `c.req.raw` 是标准 `Request`;handler 返回的 `Response`(含 SSE `ReadableStream` body)
 * 原样交还,不重写 status/headers/body、不缓冲。
 */
app.all("/api/*", async (c) => {
  const res = await getHandler()(c.req.raw);

  // 整会话删除成功时,顺带丢弃 app 级 sessionId → source 映射,避免陈旧条目堆积。
  // 尽力而为,绝不改变 handler 的响应;子资源删除(多余路径段)不触发。
  if (c.req.method === "DELETE" && res.ok) {
    const id = wholeSessionIdFromUrl(c.req.url);
    if (id !== undefined) await forgetSessionSource(id);
  }
  return res;
});

/** 从恰好 `/api/sessions/:id`(整会话删除)提取 `:id`;否则 undefined。 */
function wholeSessionIdFromUrl(url: string): string | undefined {
  const raw = new URL(url).pathname.match(/\/api\/sessions\/([^/]+)\/?$/)?.[1];
  return raw !== undefined ? decodeURIComponent(raw) : undefined;
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  process.stdout.write(`pi-web (hono) on http://${hostname}:${info.port}\n`);
});

async function shutdown(): Promise<void> {
  server.close();
  await shutdownHandler();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
