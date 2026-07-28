/**
 * 上传前图片压缩 单元测试(spec `upload-image-compression`,任务 1.4)。
 *
 * jsdom 无 `createImageBitmap` / `OffscreenCanvas` / canvas 2D 实现,故以**全局桩**覆盖:
 * 短路路径断言「零调用」,成功路径断言**调用契约**(方向选项、白底填充)——后两者是
 * 不可回归的硬约束(EXIF 清除后方向无法在下游补救;透明区不铺白底会变黑)。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  compressImage,
  shouldCompress,
  fitWithinMaxEdge,
} from "../../src/attachments/compress-image.js";

const THRESHOLD = 200 * 1024;

/** 造一个指定体积与类型的 File(内容无意义,只有 size/type 参与判定)。 */
function fakeFile(size: number, type: string, name = "photo.png"): File {
  const f = new File([new Uint8Array(0)], name, { type });
  // File.size 只读,用 defineProperty 伪造体积,避免真的分配 MB 级内存。
  Object.defineProperty(f, "size", { value: size });
  return f;
}

interface Ctx2D {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

/** 装上 createImageBitmap + OffscreenCanvas 两个全局桩,返回可断言的 spy。 */
function stubImagePipeline(opts: {
  bitmapSize?: { width: number; height: number };
  blobSize?: number | null;
  decodeError?: Error;
}) {
  const { width = 800, height = 600 } = opts.bitmapSize ?? {};
  const close = vi.fn();
  // 形参显式声明:否则 mock 推断为零参,断言 calls[0][1](第二参数)会越界(TS2493)。
  const createImageBitmap = vi.fn(async (_src: unknown, _opts?: { imageOrientation?: string }) => {
    if (opts.decodeError) throw opts.decodeError;
    return { width, height, close } as unknown as ImageBitmap;
  });
  const ctx: Ctx2D = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const convertToBlob = vi.fn(async () =>
    opts.blobSize === null
      ? null
      : ({ size: opts.blobSize ?? 1024, type: "image/jpeg" } as unknown as Blob),
  );
  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(): Ctx2D {
      return ctx;
    }
    convertToBlob = convertToBlob;
  }
  vi.stubGlobal("createImageBitmap", createImageBitmap);
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  return { createImageBitmap, ctx, convertToBlob, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shouldCompress —— 短路判定(Req 1.5/3.2/3.3/4.2)", () => {
  it("体积未达阈值 → 不压缩", () => {
    vi.stubGlobal("createImageBitmap", vi.fn());
    expect(shouldCompress(fakeFile(THRESHOLD, "image/png"))).toBe(false);
    expect(shouldCompress(fakeFile(THRESHOLD + 1, "image/png"))).toBe(true);
  });

  it("GIF / SVG 一律跳过(压后变静帧 / 栅格化反而更大)", () => {
    vi.stubGlobal("createImageBitmap", vi.fn());
    expect(shouldCompress(fakeFile(999_999, "image/gif"))).toBe(false);
    expect(shouldCompress(fakeFile(999_999, "image/svg+xml"))).toBe(false);
  });

  it("环境无 createImageBitmap → 不压缩", () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(shouldCompress(fakeFile(999_999, "image/png"))).toBe(false);
  });
});

describe("fitWithinMaxEdge —— 默认不缩放(Req 1.3/1.4)", () => {
  it("长边未超上限 → 原尺寸(本设计的核心取向:转码而非缩放)", () => {
    expect(fitWithinMaxEdge(764, 763)).toEqual({ width: 764, height: 763 });
    expect(fitWithinMaxEdge(4096, 2000)).toEqual({ width: 4096, height: 2000 });
  });

  it("长边超上限 → 等比缩放,长边恰为上限", () => {
    expect(fitWithinMaxEdge(8192, 4096)).toEqual({ width: 4096, height: 2048 });
    expect(fitWithinMaxEdge(4096, 8192)).toEqual({ width: 2048, height: 4096 });
  });
});

describe("compressImage —— 回退路径(Req 4)", () => {
  it("未达阈值 → 返回同一个对象,且**零调用**解码接口", async () => {
    const { createImageBitmap } = stubImagePipeline({});
    const file = fakeFile(1024, "image/png");
    await expect(compressImage(file)).resolves.toBe(file);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("GIF → 原样返回且零调用", async () => {
    const { createImageBitmap } = stubImagePipeline({});
    const file = fakeFile(999_999, "image/gif", "anim.gif");
    await expect(compressImage(file)).resolves.toBe(file);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("解码抛错 → 静默回退原图,不抛出", async () => {
    stubImagePipeline({ decodeError: new Error("decode boom") });
    const file = fakeFile(999_999, "image/png");
    await expect(compressImage(file)).resolves.toBe(file);
  });

  it("编码结果不小于原图 → 保留原图(Req 3.4)", async () => {
    stubImagePipeline({ blobSize: 999_999 });
    const file = fakeFile(999_999, "image/png");
    await expect(compressImage(file)).resolves.toBe(file);
  });

  it("编码返回 null → 保留原图", async () => {
    stubImagePipeline({ blobSize: null });
    const file = fakeFile(999_999, "image/png");
    await expect(compressImage(file)).resolves.toBe(file);
  });
});

describe("compressImage —— 成功路径与调用契约", () => {
  it("产出 image/jpeg 且文件名改为 .jpg(Req 1.2)", async () => {
    stubImagePipeline({ blobSize: 1024 });
    const out = await compressImage(fakeFile(999_999, "image/png", "微信图片_123.png"));
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("微信图片_123.jpg");
  });

  it("★解码必须带 imageOrientation:'from-image'(Req 2.2)—— 移除即躺倒且无法补救", async () => {
    const { createImageBitmap } = stubImagePipeline({ blobSize: 1024 });
    await compressImage(fakeFile(999_999, "image/png"));
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap.mock.calls[0]![1]).toEqual({ imageOrientation: "from-image" });
  });

  it("★绘制前必须铺白底(Req 3.1)—— 否则透明 PNG 的透明区变黑", async () => {
    const { ctx } = stubImagePipeline({ blobSize: 1024 });
    await compressImage(fakeFile(999_999, "image/png"));
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillStyle).toBe("#ffffff");
    // 顺序契约:白底必须先于图像绘制
    expect(ctx.fillRect.mock.invocationCallOrder[0]!).toBeLessThan(
      ctx.drawImage.mock.invocationCallOrder[0]!,
    );
  });

  it("画布尺寸:未超上限用原尺寸,超上限等比缩放(Req 1.3/1.4)", async () => {
    const a = stubImagePipeline({ bitmapSize: { width: 764, height: 763 }, blobSize: 1024 });
    await compressImage(fakeFile(999_999, "image/png"));
    expect(a.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 764, 763);

    vi.unstubAllGlobals();
    const b = stubImagePipeline({ bitmapSize: { width: 8192, height: 4096 }, blobSize: 1024 });
    await compressImage(fakeFile(999_999, "image/png"));
    expect(b.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4096, 2048);
  });

  it("用完释放解码资源(批量上传时决定内存峰值)", async () => {
    const { close } = stubImagePipeline({ blobSize: 1024 });
    await compressImage(fakeFile(999_999, "image/png"));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
