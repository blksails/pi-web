import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAttachments } from "../../src/hooks/use-attachments.js";
import type { UploadAttachmentResponse } from "@blksails/pi-web-protocol";

/** 构造一个带指定 mimeType 与字节内容的 File(jsdom 真实 File/Blob)。 */
function makeFile(name: string, mimeType: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeType });
}

/** 构造一个 mock 的上传成功响应描述符(server 铸造的正式 id + 展示 URL)。 */
function makeUploadResponse(
  id: string,
  name: string,
  mimeType: string,
  displayUrl: string,
): UploadAttachmentResponse {
  return {
    attachment: {
      id,
      name,
      mimeType,
      size: 8,
      origin: "upload",
      sessionId: "sess-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    displayUrl,
  };
}

/** PNG 魔数前缀(任意字节即可,这里用可辨识的序列)。 */
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// base64("\x89PNG\r\n\x1a\n") = "iVBORw0KGgo="
const PNG_BASE64 = "iVBORw0KGgo=";

/**
 * 默认注入选项:成功的 upload mock(server 铸造正式 id `att_<name>` + 展示 URL)。
 * 每次按文件名回传可辨识的正式 id/URL,便于断言。
 */
function okOptions(): {
  baseUrl: string;
  sessionId: string;
  upload: ReturnType<typeof vi.fn>;
} {
  const upload = vi.fn(
    async (
      _baseUrl: string,
      _sessionId: string,
      file: File,
    ): Promise<UploadAttachmentResponse> =>
      makeUploadResponse(
        `att_${file.name}`,
        file.name,
        file.type,
        `/attachments/att_${file.name}/raw?exp=1&sig=x`,
      ),
  );
  return { baseUrl: "/api", sessionId: "sess-1", upload };
}

describe("useAttachments", () => {
  it("starts empty and supported by default", () => {
    const { result } = renderHook(() => useAttachments(okOptions()));
    expect(result.current.items).toEqual([]);
    expect(result.current.supported).toBe(true);
  });

  it("adds image files to items and returns no rejected", async () => {
    const { result } = renderHook(() => useAttachments(okOptions()));
    let rejected: string[] = [];
    await act(async () => {
      const res = await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
      ]);
      rejected = res.rejected;
    });
    expect(rejected).toEqual([]);
    await waitFor(() =>
      expect(result.current.items[0]?.status).toBe("ready"),
    );
    expect(result.current.items).toHaveLength(1);
    const item = result.current.items[0];
    expect(item?.name).toBe("a.png");
    expect(item?.mimeType).toBe("image/png");
    expect(item?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(typeof item?.id).toBe("string");
    expect(item?.id).not.toBe("");
  });

  it("transitions an added attachment uploading -> ready with server-minted id and displayUrl", async () => {
    const opts = okOptions();
    const { result } = renderHook(() => useAttachments(opts));

    // 用一个延迟的 upload,捕捉 uploading 中间态。
    let resolveUpload!: (r: UploadAttachmentResponse) => void;
    opts.upload.mockImplementationOnce(
      () =>
        new Promise<UploadAttachmentResponse>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    await act(async () => {
      await result.current.add([makeFile("a.png", "image/png", PNG_BYTES)]);
    });

    // 上传尚未完成:处于 uploading 态,无正式 id/展示 URL。
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.status).toBe("uploading");
    expect(result.current.items[0]?.attachmentId).toBeUndefined();
    expect(result.current.items[0]?.displayUrl).toBeUndefined();

    await act(async () => {
      resolveUpload(
        makeUploadResponse(
          "att_official_1",
          "a.png",
          "image/png",
          "/attachments/att_official_1/raw?exp=1&sig=x",
        ),
      );
    });

    await waitFor(() =>
      expect(result.current.items[0]?.status).toBe("ready"),
    );
    expect(result.current.items[0]?.attachmentId).toBe("att_official_1");
    // 展示侧用 hook 的 baseUrl(此处 "/api")把根相对 displayUrl 解析为带前缀的可达 URL;
    // baseUrl 仅作展示前缀,不进 HMAC 签名输入(签名只覆盖裸 id)。
    expect(result.current.items[0]?.displayUrl).toBe(
      "/api/attachments/att_official_1/raw?exp=1&sig=x",
    );
    // 调用方未自造正式 id:正式 id 来自 mock 上传返回。
    expect(opts.upload).toHaveBeenCalledTimes(1);
    expect(opts.upload).toHaveBeenCalledWith(
      "/api",
      "sess-1",
      expect.any(File),
    );
  });

  it("displayUrl 已含 baseUrl 前缀时不重复 prepend(避免 /api/api 双前缀)", async () => {
    const opts = okOptions();
    opts.upload.mockImplementationOnce(async () =>
      makeUploadResponse(
        "att_official_2",
        "b.png",
        "image/png",
        // server 返回已含 /api 前缀的完整 displayUrl(presignUrl 经 config 注入 /api)。
        "/api/attachments/att_official_2/raw?exp=1&sig=x",
      ),
    );
    const { result } = renderHook(() => useAttachments(opts));
    await act(async () => {
      await result.current.add([makeFile("b.png", "image/png", PNG_BYTES)]);
    });
    await waitFor(() =>
      expect(result.current.items[0]?.status).toBe("ready"),
    );
    // 不双前缀:保持单 /api,而非 /api/api/attachments。
    expect(result.current.items[0]?.displayUrl).toBe(
      "/api/attachments/att_official_2/raw?exp=1&sig=x",
    );
  });

  it("leaves an already-absolute displayUrl unchanged (no baseUrl prefix)", async () => {
    const opts = okOptions();
    opts.upload.mockImplementationOnce(async (_b, _s, file: File) =>
      makeUploadResponse(
        "att_abs",
        file.name,
        file.type,
        "https://cdn.example.com/attachments/att_abs/raw?exp=1&sig=x",
      ),
    );
    const { result } = renderHook(() => useAttachments(opts));

    await act(async () => {
      await result.current.add([makeFile("a.png", "image/png", PNG_BYTES)]);
    });

    await waitFor(() => expect(result.current.items[0]?.status).toBe("ready"));
    expect(result.current.items[0]?.displayUrl).toBe(
      "https://cdn.example.com/attachments/att_abs/raw?exp=1&sig=x",
    );
  });

  it("marks an attachment error on upload failure and does not count it as a committed reference", async () => {
    const opts = okOptions();
    opts.upload.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useAttachments(opts));

    await act(async () => {
      await result.current.add([makeFile("a.png", "image/png", PNG_BYTES)]);
    });

    await waitFor(() =>
      expect(result.current.items[0]?.status).toBe("error"),
    );
    // 失败项仍在列表(以呈现错误),但无正式 id、不计入可提交引用。
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.attachmentId).toBeUndefined();
    expect(result.current.referenceIds!()).toEqual([]);
  });

  it("referenceIds returns only server-minted ids of ready attachments", async () => {
    const opts = okOptions();
    // 第一项成功、第二项失败。
    opts.upload
      .mockImplementationOnce(async (_b, _s, file: File) =>
        makeUploadResponse(
          "att_ok",
          file.name,
          file.type,
          "/attachments/att_ok/raw?exp=1&sig=x",
        ),
      )
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAttachments(opts));

    await act(async () => {
      await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
        makeFile("b.png", "image/png", PNG_BYTES),
      ]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status).toBe("ready");
      expect(result.current.items[1]?.status).toBe("error");
    });
    expect(result.current.referenceIds!()).toEqual(["att_ok"]);
  });

  it("rejects non-image files by name and does not add them", async () => {
    const { result } = renderHook(() => useAttachments(okOptions()));
    let rejected: string[] = [];
    await act(async () => {
      const res = await result.current.add([
        makeFile("doc.pdf", "application/pdf", [1, 2, 3]),
        makeFile("ok.png", "image/png", PNG_BYTES),
      ]);
      rejected = res.rejected;
    });
    expect(rejected).toEqual(["doc.pdf"]);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.name).toBe("ok.png");
  });

  it("remove drops a single attachment by id", async () => {
    const { result } = renderHook(() => useAttachments(okOptions()));
    await act(async () => {
      await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
        makeFile("b.png", "image/png", PNG_BYTES),
      ]);
    });
    expect(result.current.items).toHaveLength(2);
    const removeId = result.current.items[0]!.id;
    act(() => {
      result.current.remove(removeId);
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items.find((i) => i.id === removeId)).toBeUndefined();
  });

  it("clear removes all attachments", async () => {
    const { result } = renderHook(() => useAttachments(okOptions()));
    await act(async () => {
      await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
        makeFile("b.png", "image/png", PNG_BYTES),
      ]);
    });
    expect(result.current.items).toHaveLength(2);
    act(() => {
      result.current.clear();
    });
    expect(result.current.items).toEqual([]);
  });

  it("toImageContents produces ImageContent with raw base64 (no data URL prefix)", async () => {
    const { result } = renderHook(() => useAttachments(okOptions()));
    await act(async () => {
      await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
      ]);
    });
    await waitFor(() =>
      expect(result.current.items[0]?.status).toBe("ready"),
    );
    const contents = result.current.toImageContents();
    expect(contents).toHaveLength(1);
    expect(contents[0]).toEqual({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
  });

  it("toFileParts 在落库前用本地 dataUrl(uploading 态),便于乐观消息即时显示", async () => {
    // 上传永不 resolve → 状态停在 uploading,displayUrl 尚无,toFileParts 应回退 dataUrl。
    const pendingUpload = vi.fn(
      () => new Promise<UploadAttachmentResponse>(() => undefined),
    );
    const { result } = renderHook(() =>
      useAttachments({ baseUrl: "/api", sessionId: "sess-1", upload: pendingUpload }),
    );
    await act(async () => {
      await result.current.add([makeFile("a.png", "image/png", PNG_BYTES)]);
    });
    expect(result.current.items[0]?.status).toBe("uploading");
    const parts = result.current.toFileParts!();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("file");
    expect(parts[0]?.mediaType).toBe("image/png");
    expect(parts[0]?.filename).toBe("a.png");
    expect(parts[0]?.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it("toFileParts 落库就绪后优先用 displayUrl(轻量分发 URL)", async () => {
    const opts = okOptions();
    const { result } = renderHook(() => useAttachments(opts));
    await act(async () => {
      await result.current.add([makeFile("a.png", "image/png", PNG_BYTES)]);
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe("ready"));
    const parts = result.current.toFileParts!();
    expect(parts[0]?.url).toBe("/api/attachments/att_a.png/raw?exp=1&sig=x");
  });

  it("supported=false when options disable image input", () => {
    const { result } = renderHook(() =>
      useAttachments({ ...okOptions(), supported: false }),
    );
    expect(result.current.supported).toBe(false);
  });

  it("does not add anything while supported=false and reports files as rejected", async () => {
    const opts = { ...okOptions(), supported: false };
    const { result } = renderHook(() => useAttachments(opts));
    let rejected: string[] = [];
    await act(async () => {
      const res = await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
      ]);
      rejected = res.rejected;
    });
    expect(result.current.items).toEqual([]);
    expect(rejected).toEqual(["a.png"]);
    expect(opts.upload).not.toHaveBeenCalled();
  });

  describe("addReference(既有附件按 att_ id 引用,不上传字节)", () => {
    it("把既有附件登记为 ready 引用(isReference/attachmentId/displayUrl 经 baseUrl 解析,不触发上传)", () => {
      const opts = okOptions();
      const { result } = renderHook(() => useAttachments(opts));
      act(() => {
        result.current.addReference([
          {
            attachmentId: "att_gen1",
            displayUrl: "/attachments/att_gen1/raw?exp=1&sig=x",
            name: "海报A",
          },
        ]);
      });
      expect(result.current.items).toHaveLength(1);
      const item = result.current.items[0];
      expect(item?.status).toBe("ready");
      expect(item?.isReference).toBe(true);
      expect(item?.attachmentId).toBe("att_gen1");
      expect(item?.name).toBe("海报A");
      // 展示 URL 经 baseUrl("/api")解析加前缀(与上传落库同处理)。
      expect(item?.displayUrl).toBe("/api/attachments/att_gen1/raw?exp=1&sig=x");
      // 不上传字节。
      expect(opts.upload).not.toHaveBeenCalled();
      // 立即计入可提交引用(随正常发送以 body.attachmentIds 上行)。
      expect(result.current.referenceIds!()).toEqual(["att_gen1"]);
    });

    it("引用排除出 toImageContents(引用无本地 base64,只经 attachmentIds 上行)", () => {
      const { result } = renderHook(() => useAttachments(okOptions()));
      act(() => {
        result.current.addReference([
          { attachmentId: "att_gen1", displayUrl: "https://cdn.example.com/x.png" },
        ]);
      });
      expect(result.current.toImageContents()).toEqual([]);
      expect(result.current.referenceIds!()).toEqual(["att_gen1"]);
    });

    it("按 attachmentId 去重(同 id 多次/多批不重复入列)", () => {
      const { result } = renderHook(() => useAttachments(okOptions()));
      act(() => {
        result.current.addReference([
          { attachmentId: "att_x" },
          { attachmentId: "att_x" },
        ]);
      });
      act(() => {
        result.current.addReference([{ attachmentId: "att_x" }]);
      });
      expect(result.current.items).toHaveLength(1);
      expect(result.current.referenceIds!()).toEqual(["att_x"]);
    });

    it("toFileParts 用引用的 displayUrl(乐观消息即时显示既有素材)", () => {
      const { result } = renderHook(() => useAttachments(okOptions()));
      act(() => {
        result.current.addReference([
          {
            attachmentId: "att_x",
            displayUrl: "https://cdn.example.com/x.png",
            mimeType: "image/webp",
            name: "n",
          },
        ]);
      });
      const parts = result.current.toFileParts!();
      expect(parts).toHaveLength(1);
      expect(parts[0]?.url).toBe("https://cdn.example.com/x.png");
      expect(parts[0]?.mediaType).toBe("image/webp");
    });

    it("remove / clear 同样作用于引用项", () => {
      const { result } = renderHook(() => useAttachments(okOptions()));
      act(() => {
        result.current.addReference([
          { attachmentId: "att_a" },
          { attachmentId: "att_b" },
        ]);
      });
      expect(result.current.items).toHaveLength(2);
      const removeId = result.current.items[0]!.id;
      act(() => {
        result.current.remove(removeId);
      });
      expect(result.current.items).toHaveLength(1);
      act(() => {
        result.current.clear();
      });
      expect(result.current.items).toEqual([]);
    });

    it("supported=false 时不加入任何引用", () => {
      const { result } = renderHook(() =>
        useAttachments({ ...okOptions(), supported: false }),
      );
      act(() => {
        result.current.addReference([{ attachmentId: "att_x" }]);
      });
      expect(result.current.items).toEqual([]);
    });

    it("与上传项共存:referenceIds 含两者,toImageContents 只含上传项(base64)", async () => {
      const opts = okOptions();
      const { result } = renderHook(() => useAttachments(opts));
      await act(async () => {
        await result.current.add([makeFile("a.png", "image/png", PNG_BYTES)]);
      });
      await waitFor(() =>
        expect(result.current.items[0]?.status).toBe("ready"),
      );
      act(() => {
        result.current.addReference([
          { attachmentId: "att_ref", displayUrl: "https://cdn.example.com/r.png" },
        ]);
      });
      expect([...result.current.referenceIds!()].sort()).toEqual(
        ["att_a.png", "att_ref"].sort(),
      );
      // 上传项进内联 images(base64),引用项不进。
      const contents = result.current.toImageContents();
      expect(contents).toHaveLength(1);
      expect(contents[0]?.data).toBe(PNG_BASE64);
    });
  });
});
