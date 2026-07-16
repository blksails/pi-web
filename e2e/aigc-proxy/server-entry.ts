/**
 * aigc-key-proxy e2e(任务 5.1)—— 真实 pi-web server 侧最小装配。
 *
 * 与 `packages/server/test/aigc-proxy/proxy-routes.integration.test.ts` 的
 * `handlerWith()` 同一惯例(最小 SessionManager/InMemorySessionStore + 直接
 * `createAigcProxyRoutes` 注入),区别是这里用真实 `@hono/node-server` 起一个真实
 * `node:http` 监听端口 —— 子进程(`sandbox-child.ts`)经真实 TCP 连接过来,不共享
 * 内存,是完整的进程边界(与单元/集成测试里"同进程直调 handler(Request)"不同)。
 *
 * `fetchImpl` 注入「只重写 origin,保留 path/query」的包装 fetch,把 upstreamBase
 * (登记表写死的 `https://www.apiservices.top/v1`)指向本地 stub 上游 —— 这是
 * `createAigcProxyRoutes` 本就开放的测试接缝(`CreateAigcProxyRoutesDeps.fetchImpl`),
 * proxy-routes.ts 生产代码零改动;两段(子进程→本 server、本 server→stub)都是真实网络。
 *
 * 环境变量(由 e2e 编排脚本传入,不继承父 shell 全部 env):
 *  - PORT               本 server 监听端口(0 = 随机)
 *  - PROXY_SECRET       aigc-proxy token 签名 secret(与签发同源)
 *  - STUB_ORIGIN        stub 上游 origin(如 http://127.0.0.1:54321)
 *  - NEWAPI_API_KEY     宿主侧持有的"真实" provider key(proxy-routes 请求期从此读取)
 *
 * 就绪后向 stdout 打印一行 `PROXY_CHAIN_READY <json>`(含 port + 已签发的
 * valid/expired token),供编排脚本解析;此行是本脚本与编排脚本之间的唯一契约。
 */
import { serve } from "@hono/node-server";
import {
  createPiWebHandler,
  SessionManager,
  InMemorySessionStore,
  createAigcProxyRoutes,
  mintSessionToken,
} from "@blksails/pi-web-server";

const PORT = Number(process.env.PORT ?? 0);
const SECRET = process.env.PROXY_SECRET;
const STUB_ORIGIN = process.env.STUB_ORIGIN;
const SESSION_ID = "sess-e2e-51";

if (!SECRET) throw new Error("[server-entry] 缺少 PROXY_SECRET");
if (!STUB_ORIGIN) throw new Error("[server-entry] 缺少 STUB_ORIGIN");

/** 只重写 origin(协议+host+port),path/query 原样保留;真实网络往返仍走全局 fetch。 */
function makeRewritingFetch(targetOrigin: string): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const originalUrl =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL((input as Request).url);
    const rewritten = new URL(`${originalUrl.pathname}${originalUrl.search}`, targetOrigin);
    return fetch(rewritten, init);
  }) as typeof fetch;
}

const store = new InMemorySessionStore(true);
const manager = new SessionManager({ store, idleMs: 0 });

const routes = createAigcProxyRoutes({
  secret: SECRET,
  fetchImpl: makeRewritingFetch(STUB_ORIGIN),
  // env 缺省 process.env:本 server 进程持有真实 NEWAPI_API_KEY(宿主侧凭据)。
});

const handler = createPiWebHandler({
  manager,
  store,
  routes,
  authResolver: () => ({ anonymous: true }),
});

const validToken = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 60_000, secret: SECRET });
const expiredToken = mintSessionToken({ sessionId: SESSION_ID, ttlMs: -1_000, secret: SECRET });

serve(
  { fetch: (req: Request) => handler(req), port: PORT, hostname: "127.0.0.1" },
  (info) => {
    process.stdout.write(
      `PROXY_CHAIN_READY ${JSON.stringify({ port: info.port, validToken, expiredToken })}\n`,
    );
  },
);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
