/**
 * tokens · scoped token 单元测试(design.md ScopedToken,Req 1.1-1.6)。
 *
 * 断言:
 * - 同 secret 签发/校验互验通过,校验产出的 sessionId/scope/exp 与签发一致(Req 1.1, 1.2);
 * - 四种失败判别原因:malformed(格式错误)、expired(注入时钟超过 exp)、scope-mismatch
 *   (scope 逐字不等于 expectedScope)、bad-signature(篡改 sig/sessionId/exp 或不同 secret)
 *   (Req 1.3, 1.6);
 * - scope 逐字匹配:`llm:newapi` 签发的 token 用 expectedScope=`llm:sufy` 校验 → scope-mismatch
 *   (Req 1.3);
 * - scope/sessionId 含 `.` → 签发路径直接拒签抛错(Req 1.1);
 * - 签名域隔离:本模块(`pi-token.v2.`)与 `attachment/url-signer.ts`、
 *   `aigc-proxy/session-token.ts`(`aigc-proxy.v1.`)的签名域不同,即便共用同一 secret,产物也
 *   互不可换认(Req 1.4)。
 */
import { describe, expect, it } from "vitest";
import { createUrlSigner } from "../../src/attachment/url-signer.js";
import {
  mintSessionToken,
  verifySessionToken,
} from "../../src/aigc-proxy/session-token.js";
import {
  mintScopedToken,
  verifyScopedToken,
} from "../../src/tokens/scoped-token.js";

const SECRET = "test-scoped-token-secret-stable-0123456789";
const SESSION_ID = "sess_abcDEF123-_";
const SCOPE_NEWAPI = "llm:newapi";
const SCOPE_SUFY = "llm:sufy";

describe("mintScopedToken / verifyScopedToken", () => {
  it("同 secret 签发/校验互验通过,返回一致的 sessionId/scope/exp", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    expect(typeof token).toBe("string");
    expect(token.startsWith("pw2.")).toBe(true);

    const result = verifyScopedToken({
      token,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.scope).toBe(SCOPE_NEWAPI);
      expect(result.exp).toBeGreaterThan(Date.now());
    }
  });

  it("scope 逐字匹配:llm:newapi 签发的 token 用 expectedScope=llm:sufy 校验 → scope-mismatch", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const result = verifyScopedToken({
      token,
      expectedScope: SCOPE_SUFY,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "scope-mismatch" });
  });

  it("已过期(注入时钟 nowMs 超过 exp)→ expired", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 1_000,
      secret: SECRET,
    });
    const parts = token.split(".");
    const exp = Number(parts[3]);
    const result = verifyScopedToken({
      token,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
      nowMs: exp + 1,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("未过期(注入时钟 nowMs 等于 exp)→ 校验通过", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 1_000,
      secret: SECRET,
    });
    const parts = token.split(".");
    const exp = Number(parts[3]);
    const result = verifyScopedToken({
      token,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
      nowMs: exp,
    });
    expect(result.ok).toBe(true);
  });

  it("格式错误(非 token 形状)→ malformed,不抛", () => {
    expect(() =>
      verifyScopedToken({
        token: "not-a-token",
        expectedScope: SCOPE_NEWAPI,
        secret: SECRET,
      }),
    ).not.toThrow();
    expect(
      verifyScopedToken({
        token: "not-a-token",
        expectedScope: SCOPE_NEWAPI,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed" });

    expect(
      verifyScopedToken({
        token: "pw2.llm:newapi.only.three",
        expectedScope: SCOPE_NEWAPI,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed" });

    expect(
      verifyScopedToken({
        token: "pw2.llm:newapi.sess.not-a-number.sig",
        expectedScope: SCOPE_NEWAPI,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("篡改 sig → bad-signature", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const parts = token.split(".");
    const sig = parts[4] ?? "";
    const last = sig.slice(-1);
    const flipped = sig.slice(0, -1) + (last === "a" ? "b" : "a");
    parts[4] = flipped;
    const tampered = parts.join(".");
    const result = verifyScopedToken({
      token: tampered,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("篡改 sessionId → bad-signature", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const parts = token.split(".");
    parts[2] = parts[2] + "x";
    const tampered = parts.join(".");
    const result = verifyScopedToken({
      token: tampered,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("篡改 exp(未过期的伪造 exp)→ bad-signature", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const parts = token.split(".");
    const originalExp = Number(parts[3]);
    parts[3] = String(originalExp + 1_000);
    const tampered = parts.join(".");
    const result = verifyScopedToken({
      token: tampered,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("不同 secret 校验失败(bad-signature)", () => {
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const result = verifyScopedToken({
      token,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET + "-different",
    });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("scope 含 . → 签发路径直接拒签抛错", () => {
    expect(() =>
      mintScopedToken({
        scope: "llm.newapi",
        sessionId: SESSION_ID,
        ttlMs: 60_000,
        secret: SECRET,
      }),
    ).toThrow();
  });

  it("sessionId 含 . → 签发路径直接拒签抛错", () => {
    expect(() =>
      mintScopedToken({
        scope: SCOPE_NEWAPI,
        sessionId: "sess.with.dot",
        ttlMs: 60_000,
        secret: SECRET,
      }),
    ).toThrow();
  });

  it("签名域隔离:与 attachment/url-signer 的签名不可互换(同 secret 校验必失败)", () => {
    // url-signer 对 `${id}.${exp}` 签名(域前缀为空);构造同 payload 形状但走 url-signer 签发的
    // sig,拿去冒充 scoped token 的 sig 字段,校验必须失败(scoped token 签名域含
    // `pi-token.v2.` + scope 前缀,url-signer 无此前缀,两者摘要不同)。
    const signer = createUrlSigner(SECRET);
    const token = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const parts = token.split(".");
    const exp = Number(parts[3]);
    // url-signer 对 `${sessionId}.${exp}` 签名(与 scoped token 校验的 payload 形状不同但共用
    // 同一 secret);把它的 sig 换进 scoped token 结构,校验必须判定 bad-signature。
    const { sig: urlSignerSig } = signer.sign(SESSION_ID, exp - Date.now());
    parts[4] = urlSignerSig;
    const crossDomainToken = parts.join(".");
    const result = verifyScopedToken({
      token: crossDomainToken,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["bad-signature", "expired"]).toContain(result.reason);
    }
  });

  it("签名域隔离:与 aigc-proxy/session-token 的 token 不可互换(同 secret 交叉校验必失败)", () => {
    // aigc-proxy session-token 签名域前缀为 `aigc-proxy.v1.`,与本模块 `pi-token.v2.` 不同;
    // 即便 sessionId 相同、共用同一 secret,把 aigc-proxy token 的 sig 段搬进 scoped token 结构,
    // 校验也必须判定 bad-signature。
    const aigcToken = mintSessionToken({
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const aigcResult = verifySessionToken({ token: aigcToken, secret: SECRET });
    expect(aigcResult.ok).toBe(true);

    const aigcParts = aigcToken.split(".");
    const aigcSig = aigcParts[3] ?? "";

    const scopedToken = mintScopedToken({
      scope: SCOPE_NEWAPI,
      sessionId: SESSION_ID,
      ttlMs: 60_000,
      secret: SECRET,
    });
    const scopedParts = scopedToken.split(".");
    scopedParts[4] = aigcSig;
    const crossDomainToken = scopedParts.join(".");

    const result = verifyScopedToken({
      token: crossDomainToken,
      expectedScope: SCOPE_NEWAPI,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });
});
