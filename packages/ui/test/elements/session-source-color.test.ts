/**
 * sourceAccentColor(spec session-meta-index, 任务 2.3 / Req 6.3/6.4)。
 */
import { describe, expect, it } from "vitest";
import {
  SOURCE_ACCENT_PALETTE_SIZE,
  sourceAccentColor,
} from "../../src/elements/session-source-color.js";

describe("sourceAccentColor", () => {
  it("同一来源恒得同色(Req 6.4)", () => {
    const source = "/Users/me/projects/aigc-canvas-agent";
    const first = sourceAccentColor(source);
    for (let i = 0; i < 20; i += 1) {
      expect(sourceAccentColor(source)).toBe(first);
    }
  });

  it("前后空白不影响取色(同一来源的不同书写形式仍同色)", () => {
    expect(sourceAccentColor("  builtin:demo  ")).toBe(sourceAccentColor("builtin:demo"));
  });

  it("不同来源分布覆盖调色板多个取值(Req 6.3)", () => {
    const sources = Array.from({ length: 60 }, (_, i) => `builtin:agent-${i}`);
    const colors = new Set(sources.map((s) => sourceAccentColor(s)));
    // 60 个来源应铺开到调色板的大部分取值;不要求全覆盖(哈希取模不保证均匀)
    expect(colors.size).toBeGreaterThanOrEqual(SOURCE_ACCENT_PALETTE_SIZE - 1);
  });

  it("空串 / 空白串 / undefined → 中性回退色,不抛", () => {
    const neutral = sourceAccentColor("");
    expect(sourceAccentColor("   ")).toBe(neutral);
    expect(sourceAccentColor(undefined)).toBe(neutral);
  });

  it("返回值恒为可用的 CSS 颜色字面量", () => {
    for (const s of ["a", "builtin:x", "git+https://example.com/r.git", ""]) {
      expect(sourceAccentColor(s)).toMatch(/^hsl\(/);
    }
  });

  it("超长与含非 ASCII 的来源不抛且稳定", () => {
    const weird = `包含中文与 emoji 🎨 的来源-${"x".repeat(500)}`;
    expect(sourceAccentColor(weird)).toBe(sourceAccentColor(weird));
    expect(sourceAccentColor(weird)).toMatch(/^hsl\(/);
  });
});
