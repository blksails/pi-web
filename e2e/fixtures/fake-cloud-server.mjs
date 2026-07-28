/**
 * 假 cloud + 假 registry 夹具 —— 让「从 registry 拉 agent 源」这条链路可在 e2e 里真实跑通
 * (spec agent-plugin-commands,任务 4.4)。
 *
 * 既有的 desktop-cloud-login e2e 把 egress base 指向一个**不可达**的占位地址,只验登录状态机;
 * 本夹具提供一个**真实可达**的云端,于是 登录 → capabilities 换 sources 授予 → GET /sources
 * → 并入 GET /agent-sources → `/agent list` 这一整条可以端到端验证,而不必依赖兄弟仓
 * pi-clouds 的 registry-server。
 *
 * 三个端点的契约逐个取自消费方源码,不是猜的:
 *   POST /api/desktop/login        {email,password} → { token }
 *       ← cloud-login-client.ts:成功响应字段名是 `token`(不是 credential)
 *   POST /api/desktop/capabilities Bearer <凭据>, body "{}" → { sources: {baseUrl, token, expiresAt} }
 *       ← desktop-capabilities-client.ts:POST + Bearer;sources 逐项解析,缺项只置 undefined
 *   GET  {sources.baseUrl}/sources Bearer <sources.token> → { sources: [...] }
 *       ← registry-http-provider.ts:GET `${base}/sources`;`kind:"plugin"` 的条目会被过滤
 *
 * capabilities URL 由 pi-web 从 egress base 推导(`.../api/desktop/egress/v1` →
 * `.../api/desktop/capabilities`),故只需给它 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE` 一个 env。
 *
 * 端口经 `FAKE_CLOUD_PORT` 指定(playwright.config.ts 传入)。`GET /__hits` 返回收到的请求序列,
 * 供用例断言链路真的走过、以及排障时看卡在哪一步。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_CLOUD_PORT ?? 4599);

/**
 * ★ 桌面凭据不是随便一个字符串:pi-web 侧按 `<base64url(payload)>.<sig>` 两段解析,payload 必须含
 * `userId/companyId/scope/exp`(packages/server/src/auth/credential.ts)。返回纯字符串会让
 * `POST /auth/session` 判非法 → 前端**停在登录页、identity 恒 anonymous**,而本夹具的日志却显示
 * login/capabilities/sources 三步全都打通了 —— 症状与病灶隔了一层,极易误判成 registry 侧故障。
 * 签名内容 server 不校验(验签在真云端)。
 */
function makeDesktopCredential() {
  const payload = {
    userId: "fake-user",
    companyId: "fake-company",
    scope: "desktop",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${b64}.fake-signature`;
}

const DESKTOP_TOKEN = makeDesktopCredential();
const SOURCES_TOKEN = "fake-sources-token";
const hits = [];

/**
 * registry 返回的源清单。`kind:"plugin"` 那条**应当被 provider 过滤掉**(plugin 不进会话 agent
 * 选择器,registry-http-provider.ts),用例据此断言过滤真的生效 —— 这也是 registry 目前只有
 * agent source 粒度这一事实的可执行文档。
 */
const REGISTRY_SOURCES = [
  {
    id: "acme/hello-cloud",
    displayName: "Hello Cloud",
    description: "registry 上的示例 agent",
    kind: "agent",
  },
  {
    id: "acme/data-wrangler",
    displayName: "Data Wrangler",
    description: "另一个远端 agent",
    kind: "agent",
  },
  {
    id: "acme/some-plugin",
    displayName: "Some Plugin",
    description: "不应出现在 agent 列表里",
    kind: "plugin",
  },
];

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearer(req) {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  // 只记 Authorization 的前 12 字符:够断言"带了哪一枚 token",又不把凭据整条写进日志。
  const auth = bearer(req);
  hits.push(`${req.method} ${url.pathname} auth=${auth ? auth.slice(0, 12) : "(none)"}`);

  if (req.method === "GET" && url.pathname === "/__health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/__hits") {
    return json(res, 200, { hits });
  }

  if (req.method === "POST" && url.pathname === "/api/desktop/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let email = "";
      try {
        email = JSON.parse(body || "{}").email ?? "";
      } catch {
        email = "";
      }
      // 空邮箱 → 401,供"登录失败"用例复用同一夹具。
      if (!email) return json(res, 401, { error: "Invalid login credentials" });
      json(res, 200, { token: DESKTOP_TOKEN });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/desktop/capabilities") {
    if (bearer(req) !== DESKTOP_TOKEN) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, {
      tenant: { id: "fake-tenant", name: "Fake Tenant" },
      sources: {
        baseUrl: `http://127.0.0.1:${PORT}/registry`,
        token: SOURCES_TOKEN,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/registry/sources") {
    if (bearer(req) !== SOURCES_TOKEN) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, { sources: REGISTRY_SOURCES });
  }

  json(res, 404, { error: "not found", path: url.pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`fake-cloud on http://127.0.0.1:${PORT}`);
});
