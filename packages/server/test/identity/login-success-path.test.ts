/**
 * 登录**成功路径**端到端(spec: desktop-account-login;补 tasks.md 记录的证据缺口)。
 *
 * ## 为什么单独立一个文件
 *
 * 本 spec 交付至今,登录**失败**路径有真机证据(真打 pi-cloud 拿到 401),
 * 成功路径**一直没有** —— 需要一组真实账号密码,而那不是我该持有的东西。
 * 期间又改过三处都落在成功路径上:响应字段名(`credential`→`token`)、登录门禁、展示名。
 * 那三处改完之后,成功路径连一次端到端的运行都没有过。
 *
 * 本文件把能拿到的证据拿满:**除云端本身外全部用真实组件** ——
 * 真 `createCloudLoginClient` + 真 `createDesktopCapabilitiesClient` + 真
 * `createDesktopPasswordIdentityProvider` + 真 `createIdentityRoutes` + 真 `AuthSessionState`,
 * 只把 `fetch` 换成按**实测云端契约**应答的桩(`POST /login → {token}`、
 * `POST /capabilities → {tenant,egress,sources}`)。
 *
 * 它证明不了的:云端真实响应是否就是这个形状。那一条只能由持有账号的人重登一次补上
 * —— 而这正是首版把 `token` 写成 `credential` 却全绿的那个缺口所在。
 */
import { describe, it, expect } from "vitest";
import { AuthSessionState } from "../../src/auth/auth-session-state.js";
import { createCloudLoginClient } from "../../src/auth/cloud-login-client.js";
import { createDesktopCapabilitiesClient } from "../../src/auth/desktop-capabilities-client.js";
import { createDesktopPasswordIdentityProvider } from "../../src/identity/desktop-password-identity-provider.js";
import { createIdentityRoutes } from "../../src/identity/identity-routes.js";
import type { InjectedRoute } from "../../src/http/index.js";

const CLOUD = "https://cloud.example";
const LOGIN_URL = `${CLOUD}/api/desktop/login`;
const CAPS_URL = `${CLOUD}/api/desktop/capabilities`;
const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

const EMAIL = "user@example.com";
const PASSWORD = "correct-horse-battery-staple";

/** 云端签发的桌面凭据:`base64url(payload) + "." + HMAC`(本仓只解 payload、不验签)。 */
function issueToken(userId: string, companyId = "c-1"): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, companyId, scope: "desktop", exp: NOW_S + 3600 }),
    "utf8",
  ).toString("base64url");
  return `${payload}.stub-signature`;
}

interface StubOpts {
  readonly token: string;
  /** 能力端点返回的 tenant;`null` 表示不带该字段。 */
  readonly tenant?: Record<string, unknown> | null;
  readonly withEgress?: boolean;
  readonly withSources?: boolean;
}

interface Harness {
  readonly routes: ReadonlyArray<InjectedRoute>;
  readonly authState: AuthSessionState;
  readonly capabilities: ReturnType<typeof createDesktopCapabilitiesClient>;
  /** 观测:云端各端点被打了几次、带了什么授权头。 */
  readonly seen: { login: number; caps: number; capsAuth: string[]; loginBodies: string[] };
}

/** 除 fetch 外全部真实组件 —— 这正是本文件的价值所在。 */
function harness(opts: StubOpts): Harness {
  const seen = { login: 0, caps: 0, capsAuth: [] as string[], loginBodies: [] as string[] };

  const stubFetch = async (
    url: string,
    init: { readonly headers: Record<string, string>; readonly body?: string },
  ): Promise<{ status: number; text(): Promise<string> }> => {
    if (url === LOGIN_URL) {
      seen.login += 1;
      seen.loginBodies.push(init.body ?? "");
      // ★ 实测的云端形态:字段名是 `token`,不是 `credential`。
      return { status: 200, text: async () => JSON.stringify({ token: opts.token }) };
    }
    if (url === CAPS_URL) {
      seen.caps += 1;
      seen.capsAuth.push(init.headers.authorization ?? "");
      const body: Record<string, unknown> = {};
      if (opts.tenant !== null) {
        body.tenant = opts.tenant ?? {
          userId: "u-1",
          companyId: "c-1",
          role: "member",
          displayName: "胡余义",
        };
      }
      if (opts.withEgress !== false) {
        body.egress = {
          baseUrl: `${CLOUD}/api/desktop/egress/v1`,
          models: ["gpt-x", { id: "claude-y", name: "Claude Y" }],
          expiresAt: NOW_S + 3600,
        };
      }
      if (opts.withSources !== false) {
        body.sources = {
          baseUrl: "https://registry.example",
          token: "sources-token",
          expiresAt: NOW_S + 1800,
        };
      }
      return { status: 200, text: async () => JSON.stringify(body) };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const authState = new AuthSessionState({ now: () => NOW_MS });
  const capabilities = createDesktopCapabilitiesClient({
    capabilitiesUrl: CAPS_URL,
    getDesktopCredential: () => authState.currentCredential(),
    fetchImpl: stubFetch,
    now: () => NOW_MS,
  });
  const provider = createDesktopPasswordIdentityProvider({
    loginClient: createCloudLoginClient({ loginUrl: LOGIN_URL, fetchImpl: stubFetch }),
    capabilitiesClient: capabilities,
    authState,
  });
  return { routes: createIdentityRoutes({ provider }), authState, capabilities, seen };
}

function routeOf(h: Harness, method: string, path: string): InjectedRoute {
  const r = h.routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`route not found: ${method} ${path}`);
  return r;
}

async function call(
  route: InjectedRoute,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const ctx = {
    req: {
      json: async () => {
        if (body === undefined) throw new Error("no body");
        return body;
      },
    },
  } as unknown as Parameters<InjectedRoute["handler"]>[0];
  const res = (await route.handler(ctx)) as Response;
  const raw = await res.text();
  const parsed = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const { protocolVersion: _pv, ...json } = parsed;
  return { status: res.status, json, raw };
}

const CREDS = { method: "password", email: EMAIL, password: PASSWORD } as const;

describe("★ 登录成功路径 · 端到端(除云端外全真实组件)", () => {
  it("填账号密码 → 200 + 已认证 + 展示名", async () => {
    const h = harness({ token: issueToken("u-1") });
    const r = await call(routeOf(h, "POST", "/identity/exchange"), CREDS);

    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      state: "authenticated",
      tenant: { userId: "u-1", companyId: "c-1", role: "member", displayName: "胡余义" },
      canExchange: true,
    });
  });

  it("凭据落进程内登录态,会话 spawn 读得到", async () => {
    const token = issueToken("u-1");
    const h = harness({ token });
    await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    expect(h.authState.isValid()).toBe(true);
    expect(h.authState.currentCredential()).toBe(token);
  });

  it("能力端点带的是**云端刚签发的那个** token(而非旧凭据/空)", async () => {
    const token = issueToken("u-1");
    const h = harness({ token });
    await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    expect(h.seen.capsAuth).toEqual([`Bearer ${token}`]);
  });

  it("登录请求体是 {email,password};响应体与请求体都不含密码回显", async () => {
    const h = harness({ token: issueToken("u-1") });
    const r = await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    expect(JSON.parse(h.seen.loginBodies[0] ?? "{}")).toEqual({
      email: EMAIL,
      password: PASSWORD,
    });
    // 密码与凭据一律不得出现在响应体里(Req 8.1/8.2)。
    expect(r.raw).not.toContain(PASSWORD);
    expect(r.raw).not.toContain("stub-signature");
    expect(r.raw).not.toContain("sources-token");
  });

  it("sources 授予随即可用 —— 线上源枚举不需要再登一次(Req 4.4)", async () => {
    const h = harness({ token: issueToken("u-1") });
    await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    await expect(h.capabilities.getSourcesGrant()).resolves.toEqual({
      baseUrl: "https://registry.example",
      token: "sources-token",
    });
  });

  it("egress 授予随即可用于 spawn env(Req 4.5)", async () => {
    const h = harness({ token: issueToken("u-1") });
    await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    const egress = h.capabilities.cachedStatic()?.egress;
    expect(egress?.baseUrl).toBe(`${CLOUD}/api/desktop/egress/v1`);
    expect(egress?.models).toEqual([{ id: "gpt-x" }, { id: "claude-y", name: "Claude Y" }]);
  });

  it("登录后 GET /identity 与 exchange 返回同一身份(端口后置条件)", async () => {
    const h = harness({ token: issueToken("u-1") });
    const a = await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    const b = await call(routeOf(h, "GET", "/identity"));
    expect(b.json).toEqual(a.json);
  });

  it("★ 一次登录只打一次云端各端点(登录不该顺带打出一串请求)", async () => {
    const h = harness({ token: issueToken("u-1") });
    await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    await call(routeOf(h, "GET", "/identity"));
    expect(h.seen.login).toBe(1);
    expect(h.seen.caps).toBe(1);
  });
});

describe("成功路径的降级分支(Req 4.3/5.3)", () => {
  it("云端不给 displayName → 仍已认证,只是没有展示名(前端退回 userId)", async () => {
    const h = harness({
      token: issueToken("u-1"),
      tenant: { userId: "u-1", companyId: "c-1", role: "member" },
    });
    const r = await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    expect(r.status).toBe(200);
    expect(r.json.tenant).toEqual({ userId: "u-1", companyId: "c-1", role: "member" });
  });

  it("云端不给 tenant → 退回凭据 payload 的最小身份,登录仍成立", async () => {
    const h = harness({ token: issueToken("u-seeded", "c-9"), tenant: null });
    const r = await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    expect(r.status).toBe(200);
    expect(r.json.tenant).toMatchObject({ userId: "u-seeded", companyId: "c-9" });
  });

  it("云端不给 sources → 登录**仍成功**,只是线上源不可用(单项缺失≠整体失败)", async () => {
    const h = harness({ token: issueToken("u-1"), withSources: false });
    const r = await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    expect(r.status).toBe(200);
    await expect(h.capabilities.getSourcesGrant()).resolves.toBeUndefined();
  });
});

describe("登出与切号(Req 7.1/7.2)", () => {
  it("登出清凭据与授予缓存,GET /identity 回 anonymous", async () => {
    const h = harness({ token: issueToken("u-1") });
    await call(routeOf(h, "POST", "/identity/exchange"), CREDS);
    const out = await call(routeOf(h, "DELETE", "/identity"));
    expect(out.json).toEqual({ state: "anonymous", canExchange: true });
    expect(h.authState.isValid()).toBe(false);
    expect(h.capabilities.cachedStatic()).toBeUndefined();
    const me = await call(routeOf(h, "GET", "/identity"));
    expect(me.json.state).toBe("anonymous");
  });
});
