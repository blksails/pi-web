/**
 * 附件添加接入压缩与并发闸门 集成测试(spec `upload-image-compression`,任务 3.2)。
 *
 * ★核心防回归点(Req 1.6):压缩后的文件必须**同时**用于本地预览与实际上传。
 * 只改预览、却把原 file 交给上传,是本次接入最容易犯且最难察觉的错 —— 界面看着变小了,
 * 传到 provider 的仍是原图,等于什么都没优化。故这里直接断言 upload 收到的那个 File。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAttachments } from "../../src/hooks/use-attachments.js";
import type { UploadAttachmentResponse } from "@blksails/pi-web-protocol";

const THRESHOLD = 200 * 1024;

function bigPng(name = "photo.png"): File {
  const f = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
  Object.defineProperty(f, "size", { value: THRESHOLD + 1 });
  return f;
}

function smallPng(name = "tiny.png"): File {
  return new File([new Uint8Array([0x89, 0x50])], name, { type: "image/png" });
}

function uploadResponse(id: string, file: File): UploadAttachmentResponse {
  return {
    attachment: {
      id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      origin: "upload",
      sessionId: "sess-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    displayUrl: `/attachments/${id}/raw`,
  };
}

/** 装上压缩所需的全局桩:产出一个明显更小的 jpeg blob。 */
function stubCompressionPipeline() {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 764, height: 763, close: vi.fn() }) as unknown as ImageBitmap),
  );
  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    }
    async convertToBlob(): Promise<Blob> {
      return { size: 1024, type: "image/jpeg" } as unknown as Blob;
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
}

function makeOpts() {
  const uploaded: File[] = [];
  const upload = vi.fn(async (_b: string, _s: string, file: File) => {
    uploaded.push(file);
    return uploadResponse(`att_${uploaded.length}`, file);
  });
  return { uploaded, opts: { baseUrl: "/api", sessionId: "sess-1", upload } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAttachments 接入压缩(Req 1.1/1.6)", () => {
  it("★超阈值图片:预览与上传取自同一压缩结果,不出现「预览已压、上传仍原图」", async () => {
    stubCompressionPipeline();
    const { uploaded, opts } = makeOpts();
    const { result } = renderHook(() => useAttachments(opts));

    await act(async () => {
      await result.current.add([bigPng("微信图片_123.png")]);
    });

    // 入列项(即预览来源)反映压缩后的类型与名称
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]!.mimeType).toBe("image/jpeg");
    expect(result.current.items[0]!.name).toBe("微信图片_123.jpg");

    // ★上传侧收到的必须是同一个压缩结果,而不是原 PNG
    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.type).toBe("image/jpeg");
    expect(uploaded[0]!.name).toBe("微信图片_123.jpg");
    expect(uploaded[0]!.size).toBeLessThan(THRESHOLD);
  });

  it("未达阈值的小图:原样上传,类型与名称不变", async () => {
    stubCompressionPipeline();
    const { uploaded, opts } = makeOpts();
    const { result } = renderHook(() => useAttachments(opts));

    await act(async () => {
      await result.current.add([smallPng("tiny.png")]);
    });

    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.type).toBe("image/png");
    expect(uploaded[0]!.name).toBe("tiny.png");
    expect(result.current.items[0]!.mimeType).toBe("image/png");
  });

  it("压缩不可用(环境缺 createImageBitmap)→ 原图照常上传,不阻断", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const { uploaded, opts } = makeOpts();
    const { result } = renderHook(() => useAttachments(opts));

    await act(async () => {
      await result.current.add([bigPng()]);
    });

    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.type).toBe("image/png");
    expect(result.current.items[0]!.status).toBeDefined();
  });
});

describe("useAttachments 批量添加(Req 5.3)", () => {
  it("多张图片:数量与顺序均保持", async () => {
    stubCompressionPipeline();
    const { uploaded, opts } = makeOpts();
    const { result } = renderHook(() => useAttachments(opts));

    const files = ["a.png", "b.png", "c.png", "d.png", "e.png"].map((n) => bigPng(n));
    await act(async () => {
      await result.current.add(files);
    });

    await waitFor(() => expect(result.current.items).toHaveLength(5));
    expect(result.current.items.map((i) => i.name)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
      "d.jpg",
      "e.jpg",
    ]);
    await waitFor(() => expect(uploaded).toHaveLength(5));
    expect(uploaded.map((f) => f.name)).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"]);
  });
});
