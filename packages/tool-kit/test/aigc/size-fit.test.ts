import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIZE_CONSTRAINT,
  formatSize,
  isLegal,
  parseSize,
  planGenSize,
  planGeometry,
  planModelAndTargetSize,
  ratioToSize,
  resolveUserSize,
} from "../../src/aigc/size-fit.js";

describe("parse / ratio / resolve", () => {
  it("parseSize 接受 * / x / ×", () => {
    expect(parseSize("1080*1920")).toEqual({ w: 1080, h: 1920 });
    expect(parseSize("1080x1920")).toEqual({ w: 1080, h: 1920 });
    expect(parseSize("1080×1920")).toEqual({ w: 1080, h: 1920 });
    expect(parseSize("auto")).toBeNull();
  });

  it("9:16 / 16:9 走预设画布", () => {
    expect(ratioToSize("9:16")).toEqual({ w: 720, h: 1280 });
    expect(ratioToSize("16:9")).toEqual({ w: 1280, h: 720 });
    expect(resolveUserSize("9:16")).toEqual({ w: 720, h: 1280 });
  });
});

describe("planGenSize · 16 步进", () => {
  it("1080x1920 不是 16 倍 → 576x1024", () => {
    const gen = planGenSize({ w: 1080, h: 1920 }, DEFAULT_SIZE_CONSTRAINT);
    expect(gen).toEqual({ w: 576, h: 1024 });
    expect(isLegal(gen, DEFAULT_SIZE_CONSTRAINT)).toBe(true);
    expect(gen.w % 16).toBe(0);
    expect(gen.h % 16).toBe(0);
  });

  it("本就合法且 ≤ genEdge → 保持", () => {
    expect(planGenSize({ w: 1024, h: 1024 })).toEqual({ w: 1024, h: 1024 });
  });
});

describe("planModelAndTargetSize", () => {
  it("保留用户目标,模型侧 snap", () => {
    const plan = planModelAndTargetSize("1080x1920");
    expect(plan?.targetSize).toEqual({ w: 1080, h: 1920 });
    expect(plan?.modelSize).toEqual({ w: 576, h: 1024 });
    expect(formatSize(plan!.modelSize)).toBe("576x1024");
  });

  it("本就 16 合法 → 原样发给模型,不后裁", () => {
    const plan = planModelAndTargetSize("1536x1024");
    expect(plan?.modelSize).toEqual({ w: 1536, h: 1024 });
    expect(plan?.targetSize).toEqual({ w: 1536, h: 1024 });
  });

  it("auto / custom / 空 → undefined", () => {
    expect(planModelAndTargetSize("auto")).toBeUndefined();
    expect(planModelAndTargetSize("custom")).toBeUndefined();
    expect(planModelAndTargetSize("")).toBeUndefined();
  });
});

describe("planGeometry", () => {
  it("同尺寸 skip;同比例 contain;否则 cover", () => {
    expect(planGeometry({ w: 10, h: 10 }, { w: 10, h: 10 })).toBe("skip");
    expect(planGeometry({ w: 1024, h: 1024 }, { w: 800, h: 800 })).toBe("contain");
    expect(planGeometry({ w: 576, h: 1024 }, { w: 1080, h: 1920 })).toBe("contain");
    expect(planGeometry({ w: 1024, h: 1024 }, { w: 1080, h: 1920 })).toBe("cover");
  });
});
