/**
 * 两个身份实现(spec: desktop-account-login,任务 4.3;Req 1.2/1.6/4.2/6.2/7.1/7.2)。
 *
 * 最重要的一条:**`loadStatic` 抛时 `AuthSessionState.set` 未被调用**。
 * 那是 Req 4.2「授予整体失败 → 不进已登录态」的行为证明 —— 顺序一旦被人调换,
 * 单测仍会在别处全绿,只有这条断言会红。
 */
import { describe, it, expect } from "vitest";
import { AuthSessionState } from "../../src/auth/auth-session-state.js";
import { CapabilitiesLoadError } from "../../src/auth/desktop-capabilities-client.js";
import type { DesktopCapabilitiesClient } from "../../src/auth/desktop-capabilities-client.js";
import type { CloudLoginClient, CloudLoginResult } from "../../src/auth/cloud-login-client.js";
import type { StaticCapabilitySnapshot } from "@blksails/pi-web-core/capability/types.js";
import { createDesktopPasswordIdentityProvider } from "../../src/identity/desktop-password-identity-provider.js";
import { createSessionIdentityProvider } from "../../src/identity/session-identity-provider.js";

const NOW = 1_700_000_000_000;
const EXP = Math.floor(NOW / 1000) + 3600;

/** 构造合法桌面凭据:`base64url(JSON payload) + "." + HMAC`(本仓只解 payload、不验签)。 */
function credentialFor(userId: string, companyId = "c1"): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, companyId, scope: "desktop", exp: EXP }),
    "utf8",
  ).toString("base64url");
  return `${payload}.sig`;
}

const TENANT_A = { userId: "u-a", companyId: "c1", role: "member" };
const TENANT_B = { userId: "u-b", companyId: "c2", role: "admin" };

interface Harness {
  readonly provider: ReturnType<typeof createDesktopPasswordIdentityProvider>;
  readonly authState: AuthSessionState;
  readonly calls: { setCount: number; clearCacheCount: number; loadStaticCreds: string[] };
}

function harness(opts: {
  login?: CloudLoginResult;
  snapshot?: StaticCapabilitySnapshot | (() => StaticCapabilitySnapshot);
  loadThrows?: boolean;
}): Harness {
  const calls = { setCount: 0, clearCacheCount: 0, loadStaticCreds: [] as string[] };
  const authState = new AuthSessionState({ now: () => NOW });
  const realSet = authState.set.bind(authState);
  authState.set = (c: string) => {
    calls.setCount += 1;
    return realSet(c);
  };

  const loginClient: CloudLoginClient = {
    async login() {
      return opts.login ?? { ok: true, credential: credentialFor("u-a") };
    },
  };

  const capabilitiesClient: DesktopCapabilitiesClient = {
    async loadStatic(credential?: string) {
      calls.loadStaticCreds.push(credential ?? "<from-state>");
      if (opts.loadThrows === true) {
        throw new CapabilitiesLoadError("bad-status", "boom");
      }
      const s = opts.snapshot ?? { tenant: TENANT_A };
      return typeof s === "function" ? s() : s;
    },
    async getSourcesGrant() {
      return undefined;
    },
    // 发布相关的两项对本文件的登录场景无关紧要,给出"不可用"的诚实缺省即可。
    async getPublishGrant() {
      return undefined;
    },
    async registerPublishKey() {
      return { ok: false, kind: "no-grant" } as const;
    },
    cachedStatic() {
      return undefined;
    },
    clearCache() {
      calls.clearCacheCount += 1;
    },
  };

  return {
    provider: createDesktopPasswordIdentityProvider({
      loginClient,
      capabilitiesClient,
      authState,
    }),
    authState,
    calls,
  };
}

const PW = { method: "password", email: "a@example.com", password: "pw" } as const;

describe("DesktopPasswordIdentityProvider — 交换成功", () => {
  it("登录 → 取授予 → 落凭据,返回 tenant", async () => {
    const h = harness({});
    const r = await h.provider.exchange!(PW);
    expect(r).toEqual({ ok: true, state: { kind: "authenticated", tenant: TENANT_A } });
    expect(h.authState.isValid()).toBe(true);
    await expect(h.provider.current()).resolves.toEqual({
      kind: "authenticated",
      tenant: TENANT_A,
    });
  });

  it("用**新**凭据显式取授予(而非改写共享登录态后再取)", async () => {
    const cred = credentialFor("u-a");
    const h = harness({ login: { ok: true, credential: cred } });
    await h.provider.exchange!(PW);
    expect(h.calls.loadStaticCreds).toEqual([cred]);
  });

  it("current() 命中缓存,不重复打云端", async () => {
    const h = harness({});
    await h.provider.exchange!(PW);
    const before = h.calls.loadStaticCreds.length;
    await h.provider.current();
    await h.provider.current();
    expect(h.calls.loadStaticCreds.length).toBe(before);
  });
});

describe("★ DesktopPasswordIdentityProvider — 授予失败不进已登录态(Req 4.2)", () => {
  it("loadStatic 抛 → capabilities-failed,且 authState.set 从未被调用", async () => {
    const h = harness({ loadThrows: true });
    const r = await h.provider.exchange!(PW);
    expect(r).toEqual({ ok: false, reason: "capabilities-failed" });
    expect(h.calls.setCount).toBe(0);
    expect(h.authState.isValid()).toBe(false);
    await expect(h.provider.current()).resolves.toEqual({ kind: "anonymous" });
  });

  it("失败后状态与调用前一致(端口后置条件)", async () => {
    const h = harness({ loadThrows: true });
    const before = h.authState.snapshot();
    await h.provider.exchange!(PW);
    expect(h.authState.snapshot()).toEqual(before);
  });

  it.each([
    ["invalid-credentials", { ok: false, reason: "invalid-credentials" }],
    ["cloud-unreachable", { ok: false, reason: "cloud-unreachable" }],
    ["invalid-request", { ok: false, reason: "invalid-request" }],
  ] as const)("登录失败 %s 直接透传,且不触碰授予与登录态", async (reason, login) => {
    const h = harness({ login: login as CloudLoginResult });
    const r = await h.provider.exchange!(PW);
    expect(r).toEqual({ ok: false, reason });
    expect(h.calls.setCount).toBe(0);
    expect(h.calls.loadStaticCreds).toEqual([]);
  });

  it("授予成功但无 tenant → 仍算登录成功,退回凭据 payload 的最小身份(Req 4.3/5.3)", async () => {
    const h = harness({ snapshot: {}, login: { ok: true, credential: credentialFor("u-fallback") } });
    const r = await h.provider.exchange!(PW);
    expect(r.ok).toBe(true);
    expect(r.ok && r.state).toEqual({
      kind: "authenticated",
      tenant: { userId: "u-fallback", companyId: "c1", role: "" },
    });
  });
});

describe("DesktopPasswordIdentityProvider — 登出与切号(Req 7.1/7.2)", () => {
  it("revoke 同时清凭据与授予缓存", async () => {
    const h = harness({});
    await h.provider.exchange!(PW);
    const before = h.calls.clearCacheCount;
    await h.provider.revoke!();
    expect(h.authState.isValid()).toBe(false);
    expect(h.calls.clearCacheCount).toBeGreaterThan(before);
    await expect(h.provider.current()).resolves.toEqual({ kind: "anonymous" });
  });

  it("切号:A → B 后身份整体替换,且交换前先清了授予缓存", async () => {
    let tenant = TENANT_A;
    let cred = credentialFor("u-a");
    const calls = { clearCacheCount: 0 };
    const authState = new AuthSessionState({ now: () => NOW });
    const provider = createDesktopPasswordIdentityProvider({
      loginClient: { async login() { return { ok: true, credential: cred }; } },
      capabilitiesClient: {
        async loadStatic() { return { tenant }; },
        async getSourcesGrant() { return undefined; },
        async getPublishGrant() { return undefined; },
        async registerPublishKey() { return { ok: false, kind: "no-grant" } as const; },
        cachedStatic() { return undefined; },
        clearCache() { calls.clearCacheCount += 1; },
      },
      authState,
    });

    await provider.exchange!(PW);
    await expect(provider.current()).resolves.toEqual({
      kind: "authenticated",
      tenant: TENANT_A,
    });

    tenant = TENANT_B;
    cred = credentialFor("u-b", "c2");
    const beforeSwitch = calls.clearCacheCount;
    await provider.exchange!(PW);
    // 切号前必须清缓存,否则新凭据的 loadStatic 可能命中旧账号的缓存条目。
    expect(calls.clearCacheCount).toBeGreaterThan(beforeSwitch);
    await expect(provider.current()).resolves.toEqual({
      kind: "authenticated",
      tenant: TENANT_B,
    });
  });
});

describe("DesktopPasswordIdentityProvider — current() 不抛(Req 1.6)", () => {
  it("未登录 → anonymous", async () => {
    const h = harness({});
    await expect(h.provider.current()).resolves.toEqual({ kind: "anonymous" });
  });

  it("凭据由外部播种但授予加载失败 → anonymous 而非上抛", async () => {
    const h = harness({ loadThrows: true });
    // 模拟桌面壳经 env 播种凭据的启动路径:凭据有效,但本进程还没做过授予加载。
    h.authState.set(credentialFor("u-seeded"));
    await expect(h.provider.current()).resolves.toEqual({ kind: "anonymous" });
  });
});

describe("SessionIdentityProvider(Req 1.2/1.4/6.1/6.2/6.3)", () => {
  it("会话有身份 → authenticated,无需任何交互", async () => {
    const p = createSessionIdentityProvider({ resolveTenant: () => TENANT_A });
    await expect(p.current()).resolves.toEqual({ kind: "authenticated", tenant: TENANT_A });
  });

  it("会话失效(undefined)→ anonymous,交由该宿主自身登录路径处理", async () => {
    const p = createSessionIdentityProvider({ resolveTenant: () => undefined });
    await expect(p.current()).resolves.toEqual({ kind: "anonymous" });
  });

  it("resolveTenant 抛 → anonymous 而非上抛(端口不变式 1)", async () => {
    const p = createSessionIdentityProvider({
      resolveTenant: () => {
        throw new Error("session store down");
      },
    });
    await expect(p.current()).resolves.toEqual({ kind: "anonymous" });
  });

  it("★ 不提供 exchange / revoke —— 这是 P5「可选交换」这条路径的活证明(Req 1.4)", () => {
    const p = createSessionIdentityProvider({ resolveTenant: () => TENANT_A });
    expect(p.exchange).toBeUndefined();
    expect(p.revoke).toBeUndefined();
  });
});
