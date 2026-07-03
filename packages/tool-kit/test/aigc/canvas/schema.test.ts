import { describe, it, expect } from "vitest";
import {
  CanvasLineageSchema,
  GalleryAssetSchema,
  GalleryStateSchema,
  EditArgsSchema,
  InpaintArgsSchema,
  ReferenceArgsSchema,
  VariantsArgsSchema,
  OutpaintArgsSchema,
  ReframeArgsSchema,
  RegisterArgsSchema,
  DeleteArgsSchema,
  emptyGalleryState,
} from "../../../src/aigc/canvas/schema.js";

describe("aigc-canvas schema", () => {
  it("GalleryState round-trip(newest-first assets)", () => {
    const state = {
      assets: [
        {
          attachmentId: "att_1",
          displayUrl: "/attachments/att_1/raw?sig=x",
          mimeType: "image/png",
          name: "a.png",
          createdAt: "2026-07-02T10:00:00.000Z",
          origin: "tool-output" as const,
          derivedFrom: "att_0",
          genParams: { prompt: "hi" },
        },
      ],
    };
    const parsed = GalleryStateSchema.parse(state);
    expect(parsed).toEqual(state);
  });

  it("GalleryAsset / CanvasLineage round-trip", () => {
    const asset = {
      attachmentId: "att_2",
      displayUrl: "u",
      mimeType: "image/jpeg",
      name: "b.jpg",
      createdAt: "2026-07-02T10:00:00.000Z",
      origin: "upload" as const,
    };
    expect(GalleryAssetSchema.parse(asset)).toEqual(asset);
    expect(CanvasLineageSchema.parse({ derivedFrom: "att_1" }).derivedFrom).toBe("att_1");
    expect(CanvasLineageSchema.parse({}).derivedFrom).toBeUndefined();
  });

  it("emptyGalleryState 返回独立引用", () => {
    const a = emptyGalleryState();
    const b = emptyGalleryState();
    expect(a).toEqual({ assets: [] });
    expect(a).not.toBe(b);
    expect(a.assets).not.toBe(b.assets);
  });

  it("EditArgs:合法通过、缺 image 拒绝", () => {
    expect(EditArgsSchema.safeParse({ image: "att_1", prompt: "p" }).success).toBe(true);
    expect(EditArgsSchema.safeParse({ prompt: "p" }).success).toBe(false);
    expect(EditArgsSchema.safeParse({ image: "att_1" }).success).toBe(false);
  });

  it("InpaintArgs 需 mask;ReferenceArgs 需非空 reference_images", () => {
    expect(
      InpaintArgsSchema.safeParse({ image: "att_1", prompt: "p", mask: "att_m" }).success,
    ).toBe(true);
    expect(InpaintArgsSchema.safeParse({ image: "att_1", prompt: "p" }).success).toBe(false);
    expect(
      ReferenceArgsSchema.safeParse({ image: "att_1", prompt: "p", reference_images: ["att_r"] })
        .success,
    ).toBe(true);
    expect(
      ReferenceArgsSchema.safeParse({ image: "att_1", prompt: "p", reference_images: [] }).success,
    ).toBe(false);
  });

  it("VariantsArgs n 边界 / OutpaintArgs / ReframeArgs", () => {
    expect(VariantsArgsSchema.safeParse({ image: "a", prompt: "p", n: 3 }).success).toBe(true);
    expect(VariantsArgsSchema.safeParse({ image: "a", prompt: "p", n: 0 }).success).toBe(false);
    expect(VariantsArgsSchema.safeParse({ image: "a", prompt: "p", n: 11 }).success).toBe(false);
    expect(OutpaintArgsSchema.safeParse({ image: "a", prompt: "p" }).success).toBe(true);
    expect(ReframeArgsSchema.safeParse({ image: "a", size: "1024x1536" }).success).toBe(true);
    expect(ReframeArgsSchema.safeParse({ image: "a" }).success).toBe(false);
  });

  it("Register / Delete args", () => {
    expect(RegisterArgsSchema.safeParse({ attachmentId: "att_1" }).success).toBe(true);
    expect(RegisterArgsSchema.safeParse({}).success).toBe(false);
    expect(DeleteArgsSchema.safeParse({ attachmentId: "att_1" }).success).toBe(true);
  });

  it("拒绝二进制字段(GalleryAsset 无 data/base64;额外键被剥离)", () => {
    const parsed = GalleryAssetSchema.parse({
      attachmentId: "att_1",
      displayUrl: "u",
      mimeType: "image/png",
      name: "n",
      createdAt: "2026-07-02T10:00:00.000Z",
      origin: "upload",
      data: "AAAA",
      base64: "BBBB",
    } as Record<string, unknown>);
    expect("data" in parsed).toBe(false);
    expect("base64" in parsed).toBe(false);
  });
});
