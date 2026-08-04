/**
 * attachment-store · URL 签名器单元测试(Req 4.3, 4.5, 4.6)。
 *
 * 断言:
 * - 有效签名 + 未过期 → verify 通过(Req 4.5 签发可达 URL 的签名件);
 * - 篡改 id / exp / sig 任一 → verify 失败(Req 4.3 无/失效签名拒绝);
 * - 已过期(exp < now)→ verify 失败(Req 4.3 过期拒绝);
 * - 校验走常量时间比较(timingSafeEqual):长度不一致的 sig 不抛、稳定返回 false;
 * - 相同 secret 构造的两个 signer 互验通过(Req 4.6 模拟主/子进程一致);
 * - 不同 secret 构造的两个 signer 互验失败(Req 4.6 secret 隔离)。
 */
import { describe, expect, it } from "vitest";
import { createUrlSigner } from "../../src/attachment/url-signer.js";

const SECRET = "test-secret-stable-source-0123456789";
const ID = "att_abcDEF123-_";

describe("createUrlSigner", () => {
  it("有效签名 + 未过期 → verify 通过", () => {
    const signer = createUrlSigner(SECRET);
    const { exp, sig } = signer.sign(ID, 60_000);
    expect(exp).toBeGreaterThan(Date.now());
    expect(typeof sig).toBe("string");
    expect(sig.length).toBeGreaterThan(0);
    expect(signer.verify(ID, exp, sig)).toBe(true);
  });

  it("篡改 id → verify 失败", () => {
    const signer = createUrlSigner(SECRET);
    const { exp, sig } = signer.sign(ID, 60_000);
    expect(signer.verify(ID + "x", exp, sig)).toBe(false);
  });

  it("篡改 exp(过期戳)→ verify 失败", () => {
    const signer = createUrlSigner(SECRET);
    const { exp, sig } = signer.sign(ID, 60_000);
    expect(signer.verify(ID, exp + 1, sig)).toBe(false);
  });

  it("篡改 sig → verify 失败", () => {
    const signer = createUrlSigner(SECRET);
    const { exp, sig } = signer.sign(ID, 60_000);
    // 反转最后一个字符产出等长但不同的 sig。
    const last = sig.slice(-1);
    const flipped = sig.slice(0, -1) + (last === "a" ? "b" : "a");
    expect(flipped).not.toBe(sig);
    expect(signer.verify(ID, exp, flipped)).toBe(false);
  });

  it("已过期(exp < now)→ verify 失败", () => {
    const signer = createUrlSigner(SECRET);
    // 负的过期窗口 → exp 落在过去。
    const { exp, sig } = signer.sign(ID, -1_000);
    expect(exp).toBeLessThan(Date.now());
    // sig 本身对 id|exp 仍然有效,失败必须来自过期检查。
    expect(signer.verify(ID, exp, sig)).toBe(false);
  });

  it("常量时间比较:长度不一致的 sig 稳定返回 false 且不抛", () => {
    const signer = createUrlSigner(SECRET);
    const { exp } = signer.sign(ID, 60_000);
    expect(() => signer.verify(ID, exp, "")).not.toThrow();
    expect(signer.verify(ID, exp, "")).toBe(false);
    expect(() => signer.verify(ID, exp, "deadbeef")).not.toThrow();
    expect(signer.verify(ID, exp, "deadbeef")).toBe(false);
    // 非法格式(非 hex)也稳定返回 false,不抛。
    expect(() => signer.verify(ID, exp, "zz!!nothex")).not.toThrow();
    expect(signer.verify(ID, exp, "zz!!nothex")).toBe(false);
  });

  it("相同 secret 的两个 signer 互验通过(模拟主/子进程一致)", () => {
    const main = createUrlSigner(SECRET);
    const child = createUrlSigner(SECRET);
    const { exp, sig } = child.sign(ID, 60_000);
    // 子进程签发,主进程校验通过(Req 4.6)。
    expect(main.verify(ID, exp, sig)).toBe(true);
    // 反向亦然。
    const back = main.sign(ID, 60_000);
    expect(child.verify(ID, back.exp, back.sig)).toBe(true);
  });

  it("不同 secret 的两个 signer 互验失败(secret 隔离)", () => {
    const a = createUrlSigner(SECRET);
    const b = createUrlSigner(SECRET + "-different");
    const { exp, sig } = a.sign(ID, 60_000);
    expect(b.verify(ID, exp, sig)).toBe(false);
  });
});
