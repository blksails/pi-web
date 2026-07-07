/**
 * sizeHint 单测(aigc 尺寸选择器方向文本 + 屏幕比例副标)。
 */
import { describe, it, expect } from "vitest";
import { sizeHint } from "../src/aigc-quick-settings.js";

describe("sizeHint", () => {
  it("方形/横向/纵向 → 方向文本 + 约分比例", () => {
    expect(sizeHint("1024x1024")).toBe("方形 1:1");
    expect(sizeHint("1536x1024")).toBe("宽屏 3:2");
    expect(sizeHint("1024x1536")).toBe("竖屏 2:3");
    expect(sizeHint("1920x1080")).toBe("宽屏 16:9");
  });

  it("大小写 x / 全角 × 均可解析", () => {
    expect(sizeHint("1536X1024")).toBe("宽屏 3:2");
    expect(sizeHint("1536×1024")).toBe("宽屏 3:2");
  });

  it("auto → 自适应;非法 → undefined", () => {
    expect(sizeHint("auto")).toBe("自适应");
    expect(sizeHint("blah")).toBeUndefined();
    expect(sizeHint("0x1024")).toBeUndefined();
    expect(sizeHint("1024x")).toBeUndefined();
  });
});
