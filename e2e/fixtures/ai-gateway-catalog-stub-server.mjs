/**
 * ai-gateway 目录桩服务器夹具(spec multi-gateway-providers,任务 8.2;Req 1.3, 11.3)。
 *
 * 供 `multi-gateway-instances.e2e.ts` 的「gateways」playwright project 使用:一个进程只
 * 起一个 `/v1/models` 端点(OpenAI 兼容形状 `{ data: [{ id, owned_by }] }`),与
 * `test/ai-gateway-multi-instance.integration.test.ts` 的 `makeCatalogServer` 同构 ——
 * 两个网关实例(cloudflare / blksails-ai)各自起一份(不同端口 + 不同模型 id),证明
 * `GatewayModelCatalog` 真的按实例各自独立拉取,而不是共享一份桩数据碰巧看起来分开。
 *
 * ★ 绝不打真实上游网关(不可达/需密钥)——本机可控桩,与既有 fixture
 * (`fake-cloud-server.mjs`)同一惯例:独立 node http 进程,经 playwright `webServer`
 * 数组的独立 entry 启动,端口由 env 传入。
 *
 * env:
 *  - `AI_GATEWAY_STUB_PORT`(必填):监听端口。
 *  - `AI_GATEWAY_STUB_MODEL_ID`(必填):`/v1/models` 返回的唯一模型 id。
 *  - `AI_GATEWAY_STUB_OWNED_BY`(可选,默认 `openai`):模型的 `owned_by`,须落在
 *    `DEFAULT_PROVIDER_ALLOWLIST`(`packages/adapters/src/ai-gateway/config.ts`:
 *    anthropic/openai/google-ai-studio)内,否则实例配置未显式给 `_ALLOWLIST` 时会被
 *    白名单滤空。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.AI_GATEWAY_STUB_PORT);
if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error("AI_GATEWAY_STUB_PORT 未设置或不合法");
}
const MODEL_ID = process.env.AI_GATEWAY_STUB_MODEL_ID;
if (typeof MODEL_ID !== "string" || MODEL_ID.length === 0) {
  throw new Error("AI_GATEWAY_STUB_MODEL_ID 未设置");
}
const OWNED_BY = process.env.AI_GATEWAY_STUB_OWNED_BY ?? "openai";

const server = createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: MODEL_ID, owned_by: OWNED_BY }] }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`ai-gateway-catalog-stub on http://127.0.0.1:${PORT} (model=${MODEL_ID})`);
});
