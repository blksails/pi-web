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
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
 * 选择器,registry-http-provider.ts),用例据此断言过滤真的生效。
 *
 * ⚠ 该过滤是**列举面**的行为,不代表「registry 上没有 plugin」—— registry 的发布清单本就支持
 * `kind: "plugin"`,且能经 `/plugin install` 安装(见下方 REGISTRY_PACKAGES 与安装通道端点)。
 * 早先把这条过滤当成「registry 只有 agent 粒度」的依据,是错的。
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

// ---------------------------------------------------------------------------
// 假 registry 的 resolve / bundle(spec installer-registry-channel,任务 4.1)
//
// 端点路径取自 `@pi-clouds/registry-client` 的 `RegistryHttpClient`:
//   GET {base}/sources/{encodeURIComponent(id)}/resolve?channel=...  → ResolveResponse
//   GET {base}/sources/{encodeURIComponent(id)}/bundle?key=...       → { dataBase64 }
// 注意两点契约细节,猜错就整条跑不通:
//   · id 里的 `/` 被 encodeURIComponent 编码,故 pathname 形如 `/registry/sources/acme%2Fx/resolve`
//     —— Node 的 URL 会**自动解码** pathname,所以下面按解码后的形态匹配;
//   · bundle 走 **base64-in-JSON**(不是裸字节流),字段名 `dataBase64`。
// ---------------------------------------------------------------------------

/**
 * ★ bundle 与 manifest 的 integrity 必须自洽,故**启动时现场打包并现算** ——
 * 硬编码两个常量必然随内容漂移,而 integrity 一旦不符,安装侧的 sha384 复核必然失败,
 * 症状(「INTEGRITY_MISMATCH」)与病灶(「夹具里的常量过期了」)隔了一层,极难排查。
 */
function buildBundle(entryContent) {
  const stage = mkdtempSync(join(tmpdir(), "fake-reg-src-"));
  mkdirSync(join(stage, ".pi"), { recursive: true });
  writeFileSync(join(stage, "index.ts"), entryContent);
  const out = mkdtempSync(join(tmpdir(), "fake-reg-tgz-"));
  const tgz = join(out, "b.tgz");
  // strip=0:bundle 根即文件树(与 registry 侧默认、与 installFromRegistry 的解包方式对齐)。
  execFileSync("tar", ["-czf", tgz, "-C", stage, "."]);
  const bytes = readFileSync(tgz);
  rmSync(stage, { recursive: true, force: true });
  return {
    base64: bytes.toString("base64"),
    integrity: `sha384-${createHash("sha384").update(entryContent).digest("base64")}`,
    cleanup: () => rmSync(out, { recursive: true, force: true }),
  };
}

/** 可经 registry 通道安装的包。kind 显式写死 —— 两侧缺省相反,安装侧不接受缺省。 */
const REGISTRY_PACKAGES = {
  "acme/hello-cloud": { kind: "agent", version: "1.0.0", entry: "export default { name: 'hello-cloud' };\n" },
  // 供「/agent install 一个 plugin 包 → 指路 /plugin」这条边界用例。
  "acme/some-plugin": { kind: "plugin", version: "0.3.0", entry: "export default { name: 'some-plugin' };\n" },
};
for (const pkg of Object.values(REGISTRY_PACKAGES)) {
  const built = buildBundle(pkg.entry);
  pkg.bundleBase64 = built.base64;
  pkg.integrity = built.integrity;
  pkg.cleanup = built.cleanup;
}
process.on("exit", () => {
  for (const pkg of Object.values(REGISTRY_PACKAGES)) pkg.cleanup?.();
});

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

  // ── registry 安装通道:resolve / bundle ──
  // ★ Node 的 `new URL()` **不会**解码 pathname 里的 `%2F`,所以这里拿到的是
  //   `acme%2Fhello-cloud`,必须显式 decodeURIComponent —— 否则查表恒 miss,
  //   表现为「源不存在」,与真正的 404 无法区分。(本条由夹具冒烟实测抓到。)
  const regMatch = /^\/registry\/sources\/([^/]+)\/(resolve|bundle)$/.exec(url.pathname);
  if (req.method === "GET" && regMatch) {
    if (bearer(req) !== SOURCES_TOKEN) return json(res, 401, { error: "unauthorized" });
    const sourceId = decodeURIComponent(regMatch[1]);
    const action = regMatch[2];
    const pkg = REGISTRY_PACKAGES[sourceId];
    // 错误体形状取自 registry-client 的 parseErrorBody:{ error: { code, message } }。
    // ★ code 必须用 registry-client 认识的**线上码** `NOT_FOUND`(它再映射成本仓的
    //   `SOURCE_ABSENT`)。早先这里直接写 `SOURCE_ABSENT` —— 那是本仓侧的名字,
    //   registry-client 不认,会落到 `OTHER`,于是「源不存在」被报成别的原因。
    if (!pkg) {
      return json(res, 404, { error: { code: "NOT_FOUND", message: `no such source: ${sourceId}` } });
    }
    if (action === "resolve") {
      return json(res, 200, {
        sourceId,
        version: pkg.version,
        origin: { type: "oss", bundle: `bundle-${sourceId}` },
        hydrate: "runtime",
        policy: {},
        capabilities: {},
        publisherFingerprint: "fake-fingerprint",
        // ★ kind 显式声明:安装侧以它为权威判据,缺失会被判 MANIFEST_KIND_UNKNOWN。
        manifest: {
          kind: pkg.kind,
          entry: { path: "index.ts", integrity: pkg.integrity },
        },
      });
    }
    return json(res, 200, { dataBase64: pkg.bundleBase64 });
  }

  json(res, 404, { error: "not found", path: url.pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`fake-cloud on http://127.0.0.1:${PORT}`);
});
