/**
 * 单元:管理员授权门控接缝(Req 7.1–7.5/10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  createDefaultAdminPolicy,
  defaultAdminPolicy,
} from "../../src/extensions/security/admin-policy.js";
import type { AuthContext } from "../../src/http/index.js";

const anon: AuthContext = { anonymous: true };
const user = (id: string): AuthContext => ({ anonymous: false, userId: id });

describe("defaultAdminPolicy — deny by default", () => {
  it("denies anonymous context (not silently admin)", () => {
    expect(defaultAdminPolicy(anon)).toBe(false);
  });

  it("denies an authenticated user with no explicit admin allowlist", () => {
    expect(defaultAdminPolicy(user("alice"))).toBe(false);
  });
});

describe("createDefaultAdminPolicy — explicit config", () => {
  it("grants only userIds in the explicit admin allowlist", () => {
    const policy = createDefaultAdminPolicy({ adminUserIds: ["root"] });
    expect(policy(user("root"))).toBe(true);
    expect(policy(user("alice"))).toBe(false);
    expect(policy(anon)).toBe(false);
  });

  it("allowAnyAuthenticated grants any authenticated identity but never anonymous", () => {
    const policy = createDefaultAdminPolicy({ allowAnyAuthenticated: true });
    expect(policy(user("alice"))).toBe(true);
    expect(policy(anon)).toBe(false);
  });
});
