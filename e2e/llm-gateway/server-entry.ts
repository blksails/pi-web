/**
 * llm-gateway e2e(spec sandbox-credentials-v2,Task 4.1)—— 真实 pi-web server 侧最小装配。
 *
 * 与 `packages/server/test/llm-gateway/gateway-routes.test.ts` 的最小注入惯例同源
 * (`createLlmGatewayRoutes({ secret, registry, ... })`),区别是这里经真实
 * `@hono/node-server` 起一个真实 `node:http` 监听端口 —— 子进程(`sandbox-child.ts`)经真实
 * TCP 连接过来,不共享内存,是完整的进程边界(与集成测试里"同进程直调 handler(Request)"
 * 不同)。
 *
 * provider 登记表在本 e2e 里不用内置表(`resolveLlmGatewayProviderTable`),而是直接构造一条
 * `newapi` 条目,把 `upstreamBase` 指向本地 stub SSE 上游(`STUB_ORIGIN`)——这是
 * `createLlmGatewayRoutes` 本就开放的注入面(`CreateLlmGatewayRoutesDeps.registry`),
 * 网关路由生产代码零改动;两段(子进程→本 server、本 server→stub)都是真实网络。
 *
 * `PI_LLM_GATEWAY_BASE`/`PI_LLM_TOKEN_<ID>` 的产出复用真实 `buildSandboxLlmEnv`
 * (`lib/app/llm-gateway-config.ts`,与 e2b 装配同一函数,Req 2.2 的跨仓契约),token 签发
 * 复用真实 `mintScopedToken`(scope=`llm:newapi`),secret 解析复用真实
 * `resolveLlmGatewaySecret`(Req 1.5)——本文件不重新实现任何这些原语,只做进程级最小组装。
 *
 * 环境变量(由 e2e 编排脚本传入,不继承父 shell 全部 env):
 *  - PORT                        本 server 监听端口(0 = 随机)
 *  - PI_WEB_LLM_GATEWAY_SECRET   scoped token 签名 secret(与签发/校验同源;Req 1.5)
 *  - STUB_ORIGIN                 stub 上游 origin(如 http://127.0.0.1:54321)
 *  - NEWAPI_API_KEY              宿主侧持有的"真实"(stub)provider key(网关换钥期从此读取)
 *
 * 就绪后向 stdout 打印一行 `GATEWAY_CHAIN_READY <json>`(含 port + 沙箱侧应注入的 env
 * (`sandboxEnv`,即 `buildSandboxLlmEnv` 产物)+ 供负路径断言用的 expired/wrong-scope
 * token),供编排脚本解析;此行是本脚本与编排脚本之间的唯一契约。
 */
import { serve } from "@hono/node-server";
import {
  createPiWebHandler,
  SessionManager,
  InMemorySessionStore,
  createLlmGatewayRoutes,
  mintScopedToken,
  resolveLlmGatewaySecret,
  type LlmGatewayProviderTable,
} from "@blksails/pi-web-server";
import { buildSandboxLlmEnv } from "../../lib/app/llm-gateway-config.js";

const PORT = Number(process.env.PORT ?? 0);
const STUB_ORIGIN = process.env.STUB_ORIGIN;
const SESSION_ID = "sess-e2e-llm-gw";

if (!process.env.PI_WEB_LLM_GATEWAY_SECRET) {
  throw new Error("[server-entry] 缺少 PI_WEB_LLM_GATEWAY_SECRET");
}
if (!STUB_ORIGIN) throw new Error("[server-entry] 缺少 STUB_ORIGIN");

// 真实 secret 解析路径(Req 1.5):本 e2e 显式设置了专属 env,故走优先分支(非回退)。
const SECRET = resolveLlmGatewaySecret(process.env);

/** 单条 provider 登记(newapi 指向本地 stub,而非真实 apiservices.top 上游)。 */
const REGISTRY: LlmGatewayProviderTable = {
  newapi: {
    upstreamBase: `${STUB_ORIGIN}/v1`,
    keyEnvCandidates: ["NEWAPI_API_KEY"],
  },
};

const routes = createLlmGatewayRoutes({ secret: SECRET, registry: REGISTRY });

const store = new InMemorySessionStore(true);
const manager = new SessionManager({ store, idleMs: 0 });

const handler = createPiWebHandler({
  manager,
  store,
  routes,
  authResolver: () => ({ anonymous: true }),
  // 与真实装配(`lib/app/pi-handler.ts`)一致的 basePath,使 `/api/aigc-proxy/*`(已摘除、
  // 未注册)在同一路由前缀下天然 404,`/api/llm-gateway/*` 天然可达(Req 6.4)。
  sse: { basePath: "/api" },
});

// 三枚 token:正路径(scope=llm:newapi,交给沙箱子进程)、过期(负路径④)、
// scope 不符(负路径,scope=llm:sufy 打 newapi 路由 → 403)。
const validToken = mintScopedToken({
  scope: "llm:newapi",
  sessionId: SESSION_ID,
  ttlMs: 60_000,
  secret: SECRET,
});
const expiredToken = mintScopedToken({
  scope: "llm:newapi",
  sessionId: SESSION_ID,
  ttlMs: -1_000,
  secret: SECRET,
});
const wrongScopeToken = mintScopedToken({
  scope: "llm:sufy",
  sessionId: SESSION_ID,
  ttlMs: 60_000,
  secret: SECRET,
});

serve(
  { fetch: (req: Request) => handler(req), port: PORT, hostname: "127.0.0.1" },
  (info) => {
    const publicBase = `http://127.0.0.1:${info.port}`;
    // 真实 buildSandboxLlmEnv(跨仓契约产物):`{ PI_LLM_GATEWAY_BASE, PI_LLM_TOKEN_NEWAPI }`。
    const sandboxEnv = buildSandboxLlmEnv({ publicBase, tokens: { newapi: validToken } });
    process.stdout.write(
      `GATEWAY_CHAIN_READY ${JSON.stringify({
        port: info.port,
        publicBase,
        sandboxEnv,
        expiredToken,
        wrongScopeToken,
      })}\n`,
    );
  },
);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
