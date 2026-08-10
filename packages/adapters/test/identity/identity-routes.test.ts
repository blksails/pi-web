/**
 * 身份 HTTP 面(spec: desktop-account-login,任务 5.2;Req 1.3/1.4/2.2-2.4/8.2)。
 *
 * 两条最有杀伤力的断言:
 *  1. **`canExchange` 由方法存在性派生** —— 同一套路由面对两个实现给出不同的值。
 *     若哪天有人改成让实现自己声明,这里会红。
 *  2. **响应体逐字段扫描不含敏感材料** —— 密码/凭据/token 一个都不许回显(Req 8.2)。
 */
import { describe, it, expect } from "vitest";
import { HOST_CONTRACT_VERSION } from "@blksails/pi-web-core/host-contract-version.js";
import { createIdentityRoutes } from "../../src/identity/identity-routes.js";
import type {
  IdentityExchangeFailure,
  IdentityProvider,
  IdentityState,
} from "../../src/identity/types.js";
import { createSessionIdentityProvider } from "../../src/identity/session-identity-provider.js";
import type { InjectedRoute } from "@blksails/pi-web-core/http/index.js";

const TENANT = { userId: "u1", companyId: "c1", role: "member" };
const PASSWORD = "p@ssw0rd-marker";
const CREDENTIAL = "credential-marker";
const TOKEN = "grant-token-marker";

function routeOf(routes: ReadonlyArray<InjectedRoute>, method: string, path: string): InjectedRoute {
  const r = routes.find((x) => x.method === method && x.path === path);
  if (r === undefined) throw new Error(`route not found: ${method} ${path}`);
  return r;
}

/** 最小 ctx:路由只用到 `ctx.req.json()`。 */
function ctxWith(body?: unknown): Parameters<InjectedRoute["handler"]>[0] {
  return {
    req: {
      json: async () => {
        if (body === undefined) throw new Error("no body");
        return body;
      },
    },
  } as unknown as Parameters<InjectedRoute["handler"]>[0];
}

async function call(
  route: InjectedRoute,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const res = await route.handler(ctxWith(body));
  const raw = await (res as Response).text();
  // `jsonResponse` 一律附加 protocolVersion(既有全局约定,与本特性无关)。
  // 此处剥掉,使断言只面对 IdentityView 自身的字段集。
  const parsed = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const { protocolVersion: _pv, ...json } = parsed;
  return { status: (res as Response).status, json, raw };
}

function fakeProvider(opts: {
  state?: IdentityState;
  exchangeResult?: { ok: true; state: IdentityState } | { ok: false; reason: IdentityExchangeFailure };
  withExchange?: boolean;
  withRevoke?: boolean;
  currentThrows?: boolean;
}): IdentityProvider {
  const p: {
    contractVersion: typeof HOST_CONTRACT_VERSION;
    current: () => Promise<IdentityState>;
    exchange?: IdentityProvider["exchange"];
    revoke?: IdentityProvider["revoke"];
  } = {
    contractVersion: HOST_CONTRACT_VERSION,
    current: async () => {
      if (opts.currentThrows === true) throw new Error("probe failed");
      return opts.state ?? { kind: "anonymous" };
    },
  };
  if (opts.withExchange !== false) {
    p.exchange = async () =>
      opts.exchangeResult ?? { ok: true, state: { kind: "authenticated", tenant: TENANT } };
  }
  if (opts.withRevoke !== false) p.revoke = async () => {};
  return p as IdentityProvider;
}

describe("GET /identity", () => {
  it("已登录 → authenticated + tenant", async () => {
    const routes = createIdentityRoutes({
      provider: fakeProvider({ state: { kind: "authenticated", tenant: TENANT } }),
    });
    const r = await call(routeOf(routes, "GET", "/identity"));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      state: "authenticated",
      tenant: TENANT,
      canExchange: true,
      methods: ["password"],
    });
  });

  it("未登录 → anonymous", async () => {
    const routes = createIdentityRoutes({ provider: fakeProvider({}) });
    const r = await call(routeOf(routes, "GET", "/identity"));
    expect(r.json).toEqual({ state: "anonymous", canExchange: true, methods: ["password"] });
  });

  it("实现违约抛错 → 仍返回 200 anonymous,不 500(Req 1.6)", async () => {
    const routes = createIdentityRoutes({ provider: fakeProvider({ currentThrows: true }) });
    const r = await call(routeOf(routes, "GET", "/identity"));
    expect(r.status).toBe(200);
    expect(r.json.state).toBe("anonymous");
  });
});

describe("★ canExchange 由 exchange 方法存在性派生(design.md D2)", () => {
  it("提供 exchange 的实现 → true", async () => {
    const routes = createIdentityRoutes({ provider: fakeProvider({}) });
    const r = await call(routeOf(routes, "GET", "/identity"));
    expect(r.json.canExchange).toBe(true);
  });

  it("SessionIdentityProvider(无 exchange)→ false,且 UI 据此不渲染登录表单", async () => {
    const routes = createIdentityRoutes({
      provider: createSessionIdentityProvider({ resolveTenant: () => TENANT }),
    });
    const r = await call(routeOf(routes, "GET", "/identity"));
    expect(r.json).toEqual({
      state: "authenticated",
      tenant: TENANT,
      canExchange: false,
      methods: ["password"],
    });
  });

  it("不支持交换的实现 POST /identity/exchange → 405(Req 1.4:不是缺陷,是正常态)", async () => {
    const routes = createIdentityRoutes({
      provider: createSessionIdentityProvider({ resolveTenant: () => TENANT }),
    });
    const r = await call(routeOf(routes, "POST", "/identity/exchange"), {
      email: "a@b.c",
      password: PASSWORD,
    });
    expect(r.status).toBe(405);
  });

  it("不支持 revoke 的实现 DELETE /identity → 405", async () => {
    const routes = createIdentityRoutes({
      provider: createSessionIdentityProvider({ resolveTenant: () => TENANT }),
    });
    const r = await call(routeOf(routes, "DELETE", "/identity"));
    expect(r.status).toBe(405);
  });
});

describe("POST /identity/exchange — 入参校验(Req 2.2)", () => {
  it.each([
    ["缺 email", { password: PASSWORD }],
    ["缺 password", { email: "a@b.c" }],
    ["email 为空白", { email: "   ", password: PASSWORD }],
    ["password 为空串", { email: "a@b.c", password: "" }],
    ["两者皆缺", {}],
  ])("%s → 400", async (_n, body) => {
    const routes = createIdentityRoutes({ provider: fakeProvider({}) });
    const r = await call(routeOf(routes, "POST", "/identity/exchange"), body);
    expect(r.status).toBe(400);
  });

  it("请求体不是 JSON → 400", async () => {
    const routes = createIdentityRoutes({ provider: fakeProvider({}) });
    const r = await call(routeOf(routes, "POST", "/identity/exchange"));
    expect(r.status).toBe(400);
  });
});

describe("POST /identity/exchange — 失败类别 → HTTP 状态(Req 2.3/2.4)", () => {
  it.each([
    ["invalid-request", 400],
    ["invalid-credentials", 401],
    ["cloud-unreachable", 502],
    ["capabilities-failed", 502],
  ] as const)("%s → %d", async (reason, status) => {
    const routes = createIdentityRoutes({
      provider: fakeProvider({ exchangeResult: { ok: false, reason } }),
    });
    const r = await call(routeOf(routes, "POST", "/identity/exchange"), {
      email: "a@b.c",
      password: PASSWORD,
    });
    expect(r.status).toBe(status);
    // reason 须可被 UI 读到 —— 否则前端只能按状态码猜文案,而 502 有两种成因。
    expect(r.raw).toContain(reason);
  });

  it("成功 → 200 + authenticated", async () => {
    const routes = createIdentityRoutes({ provider: fakeProvider({}) });
    const r = await call(routeOf(routes, "POST", "/identity/exchange"), {
      email: "a@b.c",
      password: PASSWORD,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      state: "authenticated",
      tenant: TENANT,
      canExchange: true,
      methods: ["password"],
    });
  });
});

describe("★ 响应体不含任何敏感材料(Req 8.2)", () => {
  it.each([
    ["成功", { ok: true as const, state: { kind: "authenticated" as const, tenant: TENANT } }],
    ["401", { ok: false as const, reason: "invalid-credentials" as const }],
    ["502", { ok: false as const, reason: "capabilities-failed" as const }],
  ])("%s 路径:响应体不含密码/凭据/token", async (_n, exchangeResult) => {
    const routes = createIdentityRoutes({ provider: fakeProvider({ exchangeResult }) });
    const r = await call(routeOf(routes, "POST", "/identity/exchange"), {
      email: "a@b.c",
      password: PASSWORD,
    });
    for (const secret of [PASSWORD, CREDENTIAL, TOKEN]) {
      expect(r.raw).not.toContain(secret);
    }
  });

  it("IdentityView 的字段集是封闭的(新增字段须显式评估是否泄漏)", async () => {
    const routes = createIdentityRoutes({
      provider: fakeProvider({ state: { kind: "authenticated", tenant: TENANT } }),
    });
    const r = await call(routeOf(routes, "GET", "/identity"));
    expect(Object.keys(r.json).sort()).toEqual(["canExchange", "methods", "state", "tenant"]);
    expect(Object.keys(r.json.tenant as object).sort()).toEqual([
      "companyId",
      "role",
      "userId",
    ]);
  });
});

describe("DELETE /identity(Req 7.1)", () => {
  it("调用 revoke 并回 anonymous", async () => {
    let revoked = 0;
    const provider: IdentityProvider = {
      contractVersion: HOST_CONTRACT_VERSION,
      current: async () => ({ kind: "authenticated", tenant: TENANT }),
      exchange: async () => ({ ok: true, state: { kind: "authenticated", tenant: TENANT } }),
      revoke: async () => {
        revoked += 1;
      },
    };
    const r = await call(routeOf(createIdentityRoutes({ provider }), "DELETE", "/identity"));
    expect(revoked).toBe(1);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ state: "anonymous", canExchange: true, methods: ["password"] });
  });
});
