/**
 * aigc-proxy · 会话 token 单元测试(Req 3.1, 3.2, 3.3, 3.4)。
 *
 * 断言:
 * - 同 secret 签发/校验互验通过,校验产出的 sessionId/exp 与签发一致(Req 3.1, 3.4);
 * - 篡改 sessionId / exp / sig 任一字段 → 校验失败且判别原因正确(Req 3.3);
 * - 过期判定使用注入时钟(`nowMs`),便于测试构造过期场景(Req 3.2, 3.3);
 * - sessionId 含 `.` → 签发路径直接拒签抛错(格式分隔符冲突);
 * - 格式错误(非 token 形状)→ malformed,不抛;
 * - 签名域前缀隔离:token 签名与附件签名 URL 的签名域不同,同 secret 也不可互认(通过手工构造
 *   同 payload 不同前缀的签名验证隔离性);
 * - secret 解析:PI_WEB_AIGC_PROXY_SECRET 优先,回退 PI_WEB_ATTACHMENT_SECRET,皆缺抛清晰错误。
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  mintSessionToken,
  resolveAigcProxySecret,
  verifySessionToken,
} from "../../src/aigc-proxy/session-token.js";

const SECRET = "test-aigc-proxy-secret-stable-0123456789";
const SESSION_ID = "sess_abcDEF123-_";

describe("mintSessionToken / verifySessionToken", () => {
  it("同 secret 签发/校验互验通过,返回一致的 sessionId/exp", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 60_000, secret: SECRET });
    expect(typeof token).toBe("string");
    expect(token.startsWith("pwap1.")).toBe(true);

    const result = verifySessionToken({ token, secret: SECRET });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.exp).toBeGreaterThan(Date.now());
    }
  });

  it("篡改 sessionId → bad-signature", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 60_000, secret: SECRET });
    const parts = token.split(".");
    parts[1] = parts[1] + "x";
    const tampered = parts.join(".");
    const result = verifySessionToken({ token: tampered, secret: SECRET });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("篡改 exp → bad-signature(未过期的伪造 exp 仍须签名比对失败)", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 60_000, secret: SECRET });
    const parts = token.split(".");
    const originalExp = Number(parts[2]);
    parts[2] = String(originalExp + 1_000);
    const tampered = parts.join(".");
    const result = verifySessionToken({ token: tampered, secret: SECRET });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("篡改 sig → bad-signature", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 60_000, secret: SECRET });
    const parts = token.split(".");
    const sig = parts[3] ?? "";
    const last = sig.slice(-1);
    const flipped = sig.slice(0, -1) + (last === "a" ? "b" : "a");
    parts[3] = flipped;
    const tampered = parts.join(".");
    const result = verifySessionToken({ token: tampered, secret: SECRET });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("已过期(注入时钟 nowMs 超过 exp)→ expired", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 1_000, secret: SECRET });
    const parts = token.split(".");
    const exp = Number(parts[2]);
    const result = verifySessionToken({ token, secret: SECRET, nowMs: exp + 1 });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("未过期(注入时钟 nowMs 等于 exp)→ 校验通过", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 1_000, secret: SECRET });
    const parts = token.split(".");
    const exp = Number(parts[2]);
    const result = verifySessionToken({ token, secret: SECRET, nowMs: exp });
    expect(result.ok).toBe(true);
  });

  it("sessionId 含 . → 签发路径直接拒签抛错", () => {
    expect(() =>
      mintSessionToken({ sessionId: "sess.with.dot", ttlMs: 60_000, secret: SECRET }),
    ).toThrow();
  });

  it("格式错误(非 token 形状)→ malformed,不抛", () => {
    expect(() => verifySessionToken({ token: "not-a-token", secret: SECRET })).not.toThrow();
    expect(verifySessionToken({ token: "not-a-token", secret: SECRET })).toEqual({
      ok: false,
      reason: "malformed",
    });

    expect(
      verifySessionToken({ token: "pwap1.only.three", secret: SECRET }),
    ).toEqual({ ok: false, reason: "malformed" });

    expect(
      verifySessionToken({
        token: `wrongprefix.${SESSION_ID}.${Date.now() + 60_000}.deadbeef`,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed" });

    expect(
      verifySessionToken({
        token: `pwap1.${SESSION_ID}.not-a-number.deadbeef`,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("常量时间比较:长度不一致的 sig 稳定返回 bad-signature 且不抛", () => {
    const exp = Date.now() + 60_000;
    const token = `pwap1.${SESSION_ID}.${exp}.deadbeef`;
    expect(() => verifySessionToken({ token, secret: SECRET })).not.toThrow();
    expect(verifySessionToken({ token, secret: SECRET })).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("签名域前缀隔离:同 payload 不同签名域前缀产出的摘要不互认", () => {
    const exp = Date.now() + 60_000;
    // 手工构造一枚使用附件签名 URL 风格签名域(`${id}.${exp}`,无 aigc-proxy 前缀)的伪 token,
    // 验证其无法通过 aigc-proxy 的校验(签名域隔离,Security Considerations)。
    const foreignSig = createHmac("sha256", SECRET)
      .update(`${SESSION_ID}.${exp}`)
      .digest("hex");
    const token = `pwap1.${SESSION_ID}.${exp}.${foreignSig}`;
    const result = verifySessionToken({ token, secret: SECRET });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("不同 secret 校验失败", () => {
    const token = mintSessionToken({ sessionId: SESSION_ID, ttlMs: 60_000, secret: SECRET });
    const result = verifySessionToken({ token, secret: SECRET + "-different" });
    expect(result.ok).toBe(false);
  });
});

describe("resolveAigcProxySecret", () => {
  it("优先读取 PI_WEB_AIGC_PROXY_SECRET", () => {
    const env = {
      PI_WEB_AIGC_PROXY_SECRET: "proxy-secret",
      PI_WEB_ATTACHMENT_SECRET: "attachment-secret",
    } as NodeJS.ProcessEnv;
    expect(resolveAigcProxySecret(env)).toBe("proxy-secret");
  });

  it("PI_WEB_AIGC_PROXY_SECRET 缺失时回退 PI_WEB_ATTACHMENT_SECRET", () => {
    const env = {
      PI_WEB_ATTACHMENT_SECRET: "attachment-secret",
    } as NodeJS.ProcessEnv;
    expect(resolveAigcProxySecret(env)).toBe("attachment-secret");
  });

  it("两者皆缺时抛清晰错误", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(() => resolveAigcProxySecret(env)).toThrow();
  });
});
