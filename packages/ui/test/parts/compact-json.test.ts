import { describe, expect, it } from "vitest";
import { compactJson, MAX_RENDERED_JSON_CHARS } from "../../src/lib/compact-json.js";

describe("compactJson", () => {
  it("keeps ordinary values readable", () => {
    expect(compactJson({ ok: true })).toContain('"ok": true');
  });

  it("bounds oversized tool data", () => {
    const value = { text: "x".repeat(MAX_RENDERED_JSON_CHARS * 2) };
    const result = compactJson(value);
    expect(result.length).toBeLessThan(MAX_RENDERED_JSON_CHARS + 80);
    expect(result).toContain("展示已截断");
  });
});
