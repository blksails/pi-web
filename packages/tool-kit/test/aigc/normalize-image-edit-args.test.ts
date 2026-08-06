/**
 * image_edit 入参 image / images 双向归一化单测。
 */
import { describe, it, expect } from "vitest";
import { normalizeImageEditMediaArgs } from "../../src/aigc/run-image-tool.js";

describe("normalizeImageEditMediaArgs", () => {
  it("images[] → 补齐 image + reference_images", () => {
    const m: Record<string, unknown> = {
      images: ["att_a", "att_b", "att_c"],
      prompt: "edit",
    };
    normalizeImageEditMediaArgs(m);
    expect(m.images).toEqual(["att_a", "att_b", "att_c"]);
    expect(m.image).toBe("att_a");
    expect(m.reference_images).toEqual(["att_b", "att_c"]);
  });

  it("image + reference_images → 补齐 images[]", () => {
    const m: Record<string, unknown> = {
      image: "att_main",
      reference_images: ["att_r1"],
      prompt: "edit",
    };
    normalizeImageEditMediaArgs(m);
    expect(m.images).toEqual(["att_main", "att_r1"]);
    expect(m.image).toBe("att_main");
  });

  it("仅 image → images 单元素", () => {
    const m: Record<string, unknown> = { image: "att_only" };
    normalizeImageEditMediaArgs(m);
    expect(m.images).toEqual(["att_only"]);
  });

  it("两边都有时以 images[] 为准", () => {
    const m: Record<string, unknown> = {
      images: ["att_new"],
      image: "att_old",
      reference_images: ["att_x"],
    };
    normalizeImageEditMediaArgs(m);
    expect(m.images).toEqual(["att_new"]);
    expect(m.image).toBe("att_new");
    expect(m.reference_images).toBeUndefined();
  });
});
