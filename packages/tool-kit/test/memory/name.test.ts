import { describe, expect, it } from "vitest";
import { normalizeMemoryName, isValidMemoryName } from "../../src/memory/name.js";

describe("memory name", () => {
  it("normalizes spaces and case", () => {
    const r = normalizeMemoryName("  User Prefs  ");
    expect(r).toEqual({ ok: true, name: "user-prefs" });
  });

  it("rejects empty", () => {
    expect(normalizeMemoryName("   ").ok).toBe(false);
  });

  it("rejects illegal characters", () => {
    expect(normalizeMemoryName("foo/bar").ok).toBe(false);
    expect(normalizeMemoryName("../x").ok).toBe(false);
  });

  it("accepts valid slugs", () => {
    expect(isValidMemoryName("a")).toBe(true);
    expect(isValidMemoryName("user_prefs-1")).toBe(true);
  });
});
