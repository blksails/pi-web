import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttachments } from "../../src/hooks/use-attachments.js";

/** 构造一个带指定 mimeType 与字节内容的 File(jsdom 真实 File/Blob)。 */
function makeFile(name: string, mimeType: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeType });
}

/** PNG 魔数前缀(任意字节即可,这里用可辨识的序列)。 */
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// base64("\x89PNG\r\n\x1a\n") = "iVBORw0KGgo="
const PNG_BASE64 = "iVBORw0KGgo=";

describe("useAttachments", () => {
  it("starts empty and supported by default", () => {
    const { result } = renderHook(() => useAttachments());
    expect(result.current.items).toEqual([]);
    expect(result.current.supported).toBe(true);
  });

  it("adds image files to items and returns no rejected", async () => {
    const { result } = renderHook(() => useAttachments());
    let rejected: string[] = [];
    await act(async () => {
      const res = await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
      ]);
      rejected = res.rejected;
    });
    expect(rejected).toEqual([]);
    expect(result.current.items).toHaveLength(1);
    const item = result.current.items[0];
    expect(item?.name).toBe("a.png");
    expect(item?.mimeType).toBe("image/png");
    expect(item?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(typeof item?.id).toBe("string");
    expect(item?.id).not.toBe("");
  });

  it("rejects non-image files by name and does not add them", async () => {
    const { result } = renderHook(() => useAttachments());
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
    const { result } = renderHook(() => useAttachments());
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
    const { result } = renderHook(() => useAttachments());
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
    const { result } = renderHook(() => useAttachments());
    await act(async () => {
      await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
      ]);
    });
    const contents = result.current.toImageContents();
    expect(contents).toHaveLength(1);
    expect(contents[0]).toEqual({
      type: "image",
      data: PNG_BASE64,
      mimeType: "image/png",
    });
  });

  it("supported=false when options disable image input", () => {
    const { result } = renderHook(() => useAttachments({ supported: false }));
    expect(result.current.supported).toBe(false);
  });

  it("does not add anything while supported=false and reports files as rejected", async () => {
    const { result } = renderHook(() => useAttachments({ supported: false }));
    let rejected: string[] = [];
    await act(async () => {
      const res = await result.current.add([
        makeFile("a.png", "image/png", PNG_BYTES),
      ]);
      rejected = res.rejected;
    });
    expect(result.current.items).toEqual([]);
    expect(rejected).toEqual(["a.png"]);
  });
});
