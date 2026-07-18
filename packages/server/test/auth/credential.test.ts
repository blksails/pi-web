/**
 * desktop-cloud-login 任务 7.1 · 桌面凭据解析与过期判定单测(Req 2.4/3.7/6.1)。
 */
import { describe, it, expect } from "vitest";
import {
  parseDesktopCredential,
  credentialStatus,
} from "../../src/auth/credential.js";

/** 造一枚桌面凭据串:`base64url(JSON(payload)) + "." + <sig>`(sig 内容本仓不校验)。 */
function makeCredential(
  payload: Record<string, unknown>,
  sig = "deadbeefsig",
): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sig}`;
}

const validPayload = {
  userId: "user-abc",
  companyId: "co-123",
  scope: "desktop",
  exp: 4_000_000_000, // 远期(2096)
};

describe("parseDesktopCredential", () => {
  it("解析合法凭据得 payload 字段", () => {
    const parsed = parseDesktopCredential(makeCredential(validPayload));
    expect(parsed).toEqual(validPayload);
  });

  it("忽略 payload 中的未知字段(passthrough)", () => {
    const parsed = parseDesktopCredential(
      makeCredential({ ...validPayload, extra: "x", role: "admin" }),
    );
    expect(parsed).toEqual(validPayload);
  });

  it.each([
    ["undefined", undefined],
    ["空串", ""],
    ["纯空白", "   "],
    ["无点分隔", "onlyonesegment"],
    ["空签名段", `${Buffer.from("{}").toString("base64url")}.`],
    ["首段非法 base64/JSON", "@@@@.sig"],
    ["JSON 非对象", `${Buffer.from("42").toString("base64url")}.sig`],
  ])("结构非法(%s)→ undefined", (_label, input) => {
    expect(parseDesktopCredential(input as string | undefined)).toBeUndefined();
  });

  it.each([
    ["缺 userId", { companyId: "c", scope: "s", exp: 1 }],
    ["userId 空", { userId: "", companyId: "c", scope: "s", exp: 1 }],
    ["缺 companyId", { userId: "u", scope: "s", exp: 1 }],
    ["exp 非数", { userId: "u", companyId: "c", scope: "s", exp: "soon" }],
    ["缺 scope", { userId: "u", companyId: "c", exp: 1 }],
  ])("字段缺失/类型错误(%s)→ undefined", (_label, payload) => {
    expect(parseDesktopCredential(makeCredential(payload))).toBeUndefined();
  });
});

describe("credentialStatus", () => {
  const payload = { userId: "u", companyId: "c", scope: "desktop", exp: 1000 };

  it("exp 在未来 → valid", () => {
    expect(credentialStatus(payload, 999_000 /* ms → 999s */)).toBe("valid");
  });

  it("exp 已过 → expired", () => {
    expect(credentialStatus(payload, 2_000_000 /* ms → 2000s */)).toBe("expired");
  });

  it("临界:now == exp → expired(不含等号即过期)", () => {
    expect(credentialStatus(payload, 1_000_000 /* ms → 1000s */)).toBe("expired");
  });

  it("临界前一秒 → valid", () => {
    expect(credentialStatus(payload, 999_000)).toBe("valid");
  });
});
