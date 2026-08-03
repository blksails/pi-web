/**
 * desktop-cloud-login 任务 7.1 · 进程内登录态单测(Req 2.2/4.4/5.2/6.2)。
 */
import { describe, it, expect } from "vitest";
import { AuthSessionState } from "../../src/auth/auth-session-state.js";

function makeCredential(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.sig`;
}

const A = makeCredential({
  userId: "user-A",
  companyId: "co-A",
  scope: "desktop",
  exp: 4_000_000_000,
});
const B = makeCredential({
  userId: "user-B",
  companyId: "co-B",
  scope: "desktop",
  exp: 4_000_000_000,
});
const EXPIRED = makeCredential({
  userId: "user-X",
  companyId: "co-X",
  scope: "desktop",
  exp: 1000, // 1970-01-01 之后不久,恒过期
});

describe("AuthSessionState", () => {
  it("初始未登录", () => {
    const s = new AuthSessionState();
    expect(s.snapshot()).toEqual({ loggedIn: false });
    expect(s.isValid()).toBe(false);
    expect(s.currentCredential()).toBeUndefined();
  });

  it("set 合法凭据 → 登录态投影含身份、不含凭据明文", () => {
    const s = new AuthSessionState();
    const r = s.set(A);
    expect(r.ok).toBe(true);
    const snap = s.snapshot();
    expect(snap).toMatchObject({
      loggedIn: true,
      userId: "user-A",
      companyId: "co-A",
      status: "valid",
    });
    // 投影绝不含凭据明文(Req 5.2)。
    expect(JSON.stringify(snap)).not.toContain("sig");
    expect(s.currentCredential()).toBe(A);
  });

  it("切号:二次 set 用新身份替换旧(Req 6.2)", () => {
    const s = new AuthSessionState();
    s.set(A);
    s.set(B);
    expect(s.snapshot()).toMatchObject({ loggedIn: true, userId: "user-B" });
    expect(s.currentCredential()).toBe(B);
  });

  it("clear → 回退未登录(Req 4.4)", () => {
    const s = new AuthSessionState();
    s.set(A);
    s.clear();
    expect(s.snapshot()).toEqual({ loggedIn: false });
    expect(s.currentCredential()).toBeUndefined();
  });

  it("set 非法凭据 → {ok:false, reason:invalid},不改变现态", () => {
    const s = new AuthSessionState();
    s.set(A);
    const r = s.set("garbage-not-a-credential");
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(s.snapshot()).toMatchObject({ userId: "user-A" });
  });

  it("set 过期凭据 → {ok:false, reason:expired},不登录", () => {
    const s = new AuthSessionState();
    const r = s.set(EXPIRED);
    expect(r).toEqual({ ok: false, reason: "expired" });
    expect(s.snapshot()).toEqual({ loggedIn: false });
  });

  it("过期凭据不下发:currentCredential 返回 undefined(Req 3.7)", () => {
    // 用可注入 now,先在有效期内 set,再把时间推进到过期后。
    let now = 500_000; // 500s
    const s = new AuthSessionState({ now: () => now });
    const cred = makeCredential({
      userId: "u",
      companyId: "c",
      scope: "desktop",
      exp: 1000, // 1000s
    });
    expect(s.set(cred).ok).toBe(true);
    expect(s.currentCredential()).toBe(cred);
    now = 2_000_000; // 2000s > exp
    expect(s.currentCredential()).toBeUndefined();
    expect(s.isValid()).toBe(false);
    expect(s.snapshot()).toMatchObject({ loggedIn: true, status: "expired" });
  });
});
