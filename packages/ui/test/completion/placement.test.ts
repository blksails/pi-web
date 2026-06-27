/**
 * 补全浮层定位纯函数单测。
 */
import { describe, expect, it } from "vitest";
import { computePlacement } from "../../src/completion/placement.js";

const base = {
  rect: { top: 100, left: 50 },
  caret: { top: 20, left: 30, height: 16 },
  scrollTop: 0,
  scrollLeft: 0,
  viewportHeight: 800,
  estPopoverHeight: 200,
};

describe("computePlacement", () => {
  it("下方空间充足:在 caret 下方(top = caretTop + height)", () => {
    const p = computePlacement(base);
    expect(p.flip).toBe(false);
    expect(p.left).toBe(50 + 30); // rect.left + caret.left
    if (!p.flip) {
      expect(p.top).toBe(100 + 20 + 16); // caretTop + height
    }
  });

  it("下方空间不足:翻转到上方(返回 bottom)", () => {
    const p = computePlacement({
      ...base,
      viewportHeight: 130, // caretTop=120, below=136 + 200 > 130
    });
    expect(p.flip).toBe(true);
    if (p.flip) {
      expect(p.bottom).toBe(130 - 120); // viewportHeight - caretTop
    }
  });

  it("textarea 自身滚动计入 left/top", () => {
    const p = computePlacement({
      ...base,
      scrollTop: 10,
      scrollLeft: 5,
    });
    expect(p.left).toBe(50 + 30 - 5);
    if (!p.flip) {
      expect(p.top).toBe(100 + (20 - 10) + 16);
    }
  });
});
