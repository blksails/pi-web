import { describe, it, expect } from "vitest";
import {
  companyNameForDisplay,
  mergeProfileIntoTenant,
} from "../../src/identity/profile-enrich.js";

const TENANT = { userId: "u1", companyId: "3", role: "admin", displayName: "Jxk" };

describe("mergeProfileIntoTenant", () => {
  it("补 username/avatar/公司,不覆盖权威 userId", () => {
    const merged = mergeProfileIntoTenant(TENANT, {
      username: "杰阔",
      fullName: "Jxk",
      avatarUrl: "https://cdn.example/a.webp",
      companyName: "长沙捷同网络科技有限公司",
      companySource: "crm",
    });
    expect(merged.userId).toBe("u1");
    expect(merged.username).toBe("杰阔");
    expect(merged.avatarUrl).toBe("https://cdn.example/a.webp");
    expect(merged.companyName).toBe("长沙捷同网络科技有限公司");
  });
});

describe("companyNameForDisplay", () => {
  it("source=pilabs 不展示", () => {
    expect(companyNameForDisplay("个人公司", "pilabs")).toBeUndefined();
    expect(companyNameForDisplay("捷同", null)).toBe("捷同");
  });
});
