import { describe, it, expect, vi } from "vitest";
import {
  clampRect,
  rotatedSize,
  createMask,
  cropImage,
  uploadDataUri,
  parseDataUri,
  type CanvasLike,
  type Ctx2DLike,
  type UploadFn,
} from "../../src/canvas/client-image-ops.js";

function fakeCanvas(): { canvas: CanvasLike; ctx: Ctx2DLike; fills: number[][] } {
  const fills: number[][] = [];
  const ctx: Ctx2DLike = {
    fillStyle: "",
    fillRect: (x, y, w, h) => fills.push([x, y, w, h]),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "data:image/png;base64,ZZZZ",
  };
  return { canvas, ctx, fills };
}

describe("client-image-ops 几何", () => {
  it("clampRect 钳制到边界内", () => {
    expect(clampRect({ x: -5, y: -5, width: 100, height: 100 }, { width: 50, height: 40 })).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    });
    expect(clampRect({ x: 10, y: 10, width: 100, height: 100 }, { width: 50, height: 50 })).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
  });

  it("rotatedSize 90/270 交换宽高", () => {
    expect(rotatedSize({ width: 800, height: 600 }, 90)).toEqual({ width: 600, height: 800 });
    expect(rotatedSize({ width: 800, height: 600 }, 270)).toEqual({ width: 600, height: 800 });
    expect(rotatedSize({ width: 800, height: 600 }, 180)).toEqual({ width: 800, height: 600 });
  });

  it("createMask 输出画布尺寸=源图(坐标系对齐)+ region 涂白", () => {
    const f = fakeCanvas();
    const uri = createMask(
      { width: 512, height: 384 },
      [{ x: 10, y: 20, width: 100, height: 50 }],
      { canvasFactory: () => f.canvas },
    );
    expect(f.canvas.width).toBe(512);
    expect(f.canvas.height).toBe(384);
    // 黑底 fillRect(0,0,512,384) + region(clamped) fillRect(10,20,100,50)。
    expect(f.fills[0]).toEqual([0, 0, 512, 384]);
    expect(f.fills[1]).toEqual([10, 20, 100, 50]);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("cropImage 输出尺寸=钳制后的裁剪框", () => {
    const f = fakeCanvas();
    cropImage(
      { width: 200, height: 200 },
      { x: 50, y: 50, width: 100, height: 100 },
      { canvasFactory: () => f.canvas },
    );
    expect(f.canvas.width).toBe(100);
    expect(f.canvas.height).toBe(100);
  });

  it("parseDataUri 提取 mimeType + base64", () => {
    expect(parseDataUri("data:image/png;base64,QUJD")).toEqual({
      mimeType: "image/png",
      base64: "QUJD",
    });
  });

  it("uploadDataUri:data URI → File → upload,回传 att_id(二进制不进 payload)", async () => {
    const upload: UploadFn = vi.fn(async (_b, _s, file) => ({
      attachment: { id: "att_up" },
      displayUrl: `/att/att_up?name=${file.name}`,
    }));
    const res = await uploadDataUri({
      dataUri: "data:image/png;base64,QUJD",
      name: "x.png",
      baseUrl: "/api",
      sessionId: "s1",
      upload,
      fileFactory: (bytes, name, mimeType) =>
        ({ name, type: mimeType, size: bytes.length } as unknown as File),
    });
    expect(res.attachmentId).toBe("att_up");
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
