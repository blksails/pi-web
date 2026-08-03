/**
 * 壳凭据取回端点(spec: desktop-account-login,Req 12;方案 A)。
 *
 * ★ 本文件真正在守的是**三条门**,不是"能取到凭据":
 *   ① token 不符 → 401,且不区分「没带」与「带错」(区分开等于告诉试探者他离对答案多近)
 *   ② 未登录 → 200 + `credential: null`,**不是** 404 —— 壳据此清钥匙串;
 *     若返回 404,壳分不清「没登录」与「端点不存在」,只能什么都不做,
 *     于是登出后钥匙串残留上一次的凭据,下次启动又被播种回去
 *   ③ 过期凭据不下发 —— 否则壳会把一个已死的凭据写进钥匙串,下次启动拿它去登录必失败
 */
import { describe, it, expect } from "vitest";
import { AuthSessionState } from "../../src/auth/auth-session-state.js";
import {
  createShellCredentialRoutes,
  resolveShellToken,
  SHELL_TOKEN_ENV,
} from "../../src/auth/shell-credential-route.js";
import type { InjectedRoute } from "@blksails/pi-web-core/http/index.js";

const TOKEN = "a".repeat(64);
const NOW = 1_700_000_000_000;

function credentialFor(userId: string, expOffsetS: number): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      companyId: "c1",
      scope: "desktop",
      exp: Math.floor(NOW / 1000) + expOffsetS,
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.sig`;
}

function call(
  route: InjectedRoute,
  authHeader?: string,
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const ctx = {
    req: {
      headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? authHeader ?? null : null) },
    },
  } as unknown as Parameters<InjectedRoute["handler"]>[0];
  return route.handler(ctx).then(async (res) => {
    const raw = await (res as Response).text();
    const parsed = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const { protocolVersion: _pv, ...body } = parsed;
    return { status: (res as Response).status, body, raw };
  });
}

function setup(credential?: string): { route: InjectedRoute; state: AuthSessionState } {
  const state = new AuthSessionState({ now: () => NOW });
  if (credential !== undefined) state.set(credential);
  const routes = createShellCredentialRoutes({ state, token: TOKEN });
  const route = routes.find((r) => r.method === "GET" && r.path === "/desktop/credential");
  if (route === undefined) throw new Error("route missing");
  return { route, state };
}

describe("resolveShellToken — 未配置即不挂载的判据(Req 12.7)", () => {
  it("有值 → 返回", () => {
    expect(resolveShellToken({ [SHELL_TOKEN_ENV]: TOKEN })).toBe(TOKEN);
  });

  it.each([
    ["未设置", {}],
    ["空串", { [SHELL_TOKEN_ENV]: "" }],
    ["纯空白", { [SHELL_TOKEN_ENV]: "   " }],
  ])("%s → undefined(装配处据此不挂载端点)", (_n, env) => {
    expect(resolveShellToken(env)).toBeUndefined();
  });
});

describe("★ 门 ①:token 校验", () => {
  it("正确 token → 200", async () => {
    const { route } = setup(credentialFor("u1", 3600));
    const r = await call(route, `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
  });

  it.each([
    ["不带 Authorization", undefined],
    ["空 Bearer", "Bearer "],
    ["错误 token", `Bearer ${"b".repeat(64)}`],
    ["前缀正确但被截断(逐字节试探的典型形态)", `Bearer ${"a".repeat(63)}`],
    ["多一位", `Bearer ${"a".repeat(65)}`],
    ["非 Bearer 方案", `Basic ${TOKEN}`],
    ["裸 token 不带方案", TOKEN],
  ])("%s → 401", async (_n, header) => {
    const { route } = setup(credentialFor("u1", 3600));
    const r = await call(route, header);
    expect(r.status).toBe(401);
  });

  it("401 的响应体不泄漏任何凭据或 token 材料", async () => {
    const cred = credentialFor("u1", 3600);
    const { route } = setup(cred);
    const r = await call(route, "Bearer wrong");
    expect(r.raw).not.toContain(cred);
    expect(r.raw).not.toContain(TOKEN);
  });

  it("Bearer 大小写不敏感(HTTP 方案名本就不区分大小写)", async () => {
    const { route } = setup(credentialFor("u1", 3600));
    await expect(call(route, `bearer ${TOKEN}`)).resolves.toMatchObject({ status: 200 });
  });
});

describe("★ 门 ②:未登录返回 200 + null,不是 404", () => {
  it("从未登录 → 200 { credential: null }", async () => {
    const { route } = setup();
    const r = await call(route, `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ credential: null });
  });

  it("登出后 → 200 { credential: null }(壳据此清钥匙串,不留残余)", async () => {
    const { route, state } = setup(credentialFor("u1", 3600));
    state.clear();
    const r = await call(route, `Bearer ${TOKEN}`);
    expect(r.body).toEqual({ credential: null });
  });
});

describe("★ 门 ③:过期凭据不下发", () => {
  it("已过期 → credential: null(不能把一个已死的凭据写进钥匙串)", async () => {
    const { route } = setup(credentialFor("u1", -10));
    const r = await call(route, `Bearer ${TOKEN}`);
    expect(r.body).toEqual({ credential: null });
  });
});

describe("正常取回", () => {
  it("已登录 → 返回凭据原文(壳要拿它写钥匙串)", async () => {
    const cred = credentialFor("u1", 3600);
    const { route } = setup(cred);
    const r = await call(route, `Bearer ${TOKEN}`);
    expect(r.body).toEqual({ credential: cred });
  });

  it("响应字段集封闭(新增字段须显式评估是否泄漏)", async () => {
    const { route } = setup(credentialFor("u1", 3600));
    const r = await call(route, `Bearer ${TOKEN}`);
    expect(Object.keys(r.body)).toEqual(["credential"]);
  });
});
