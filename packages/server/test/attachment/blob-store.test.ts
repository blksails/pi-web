/**
 * attachment-store · BlobStore 端口契约单元测试(Req 1.1, 1.5, 1.6, 1.8)。
 *
 * 本任务偏类型/接口定义(非行为)。这里断言:
 * - 「未找到」错误 {@link BlobNotFoundError} 可经 `instanceof` 识别、是 Error 子类、
 *   携带命中的 key、有稳定 `name`(Req 1.5 可类型识别的未找到结果;Req 1.8 错误类型化);
 * - `BlobMeta` 形状(mimeType/size)可被引用并构造(Req 1.6 getReadStream meta 统一);
 * - `BlobStore` 端口可被一个最小实现实现并满足类型(Req 1.1 五能力 / 1.8 异步 verb+noun)。
 *   读取不存在对象的契约:抛出可识别的 {@link BlobNotFoundError}。
 */
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  BlobNotFoundError,
  type BlobMeta,
  type BlobStore,
} from "../../src/attachment/blob-store.js";

describe("BlobNotFoundError", () => {
  it("是 Error 子类且可经 instanceof 识别(Req 1.5/1.8)", () => {
    const err = new BlobNotFoundError("att_missing");
    expect(err).toBeInstanceOf(BlobNotFoundError);
    expect(err).toBeInstanceOf(Error);
  });

  it("携带命中的 key 并有稳定 name", () => {
    const err = new BlobNotFoundError("att_missing");
    expect(err.key).toBe("att_missing");
    expect(err.name).toBe("BlobNotFoundError");
    expect(err.message).toContain("att_missing");
  });

  it("经 catch 后仍可按类型区分于普通 Error(Req 1.5 与成功明确区分)", () => {
    let caught: unknown;
    try {
      throw new BlobNotFoundError("k");
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof BlobNotFoundError).toBe(true);
  });
});

describe("BlobMeta 形状可被引用(Req 1.6)", () => {
  it("承载 mimeType 与 size", () => {
    const meta: BlobMeta = { mimeType: "image/png", size: 1234 };
    expect(meta.mimeType).toBe("image/png");
    expect(meta.size).toBe(1234);
  });
});

describe("BlobStore 端口可被实现(Req 1.1 五能力 / 1.8 异步 verb+noun)", () => {
  // 最小内存实现仅用于证明端口契约可被后端实现/门面引用并满足类型;
  // 真实落盘后端为 task 2.2(LocalFsBlobBackend)。
  function makeMemoryStore(): BlobStore {
    const blobs = new Map<string, { bytes: Uint8Array; meta: BlobMeta }>();
    return {
      async put(key, body, meta) {
        const bytes = body instanceof Uint8Array ? body : new Uint8Array();
        blobs.set(key, { bytes, meta });
        return {};
      },
      async getReadStream(key) {
        const found = blobs.get(key);
        if (!found) throw new BlobNotFoundError(key);
        return { stream: Readable.from(Buffer.from(found.bytes)), meta: found.meta };
      },
      async head(key) {
        const found = blobs.get(key);
        if (!found) throw new BlobNotFoundError(key);
        return found.meta;
      },
      async presignUrl(key) {
        return `/attachments/${key}/raw?exp=0&sig=x`;
      },
      async delete(key) {
        blobs.delete(key);
      },
    };
  }

  it("put → head 往返一致 mime/size", async () => {
    const store = makeMemoryStore();
    const meta: BlobMeta = { mimeType: "text/plain", size: 3 };
    await store.put("k1", new Uint8Array([1, 2, 3]), meta);
    await expect(store.head("k1")).resolves.toEqual(meta);
  });

  it("getReadStream 返回 stream + 导出的 BlobMeta", async () => {
    const store = makeMemoryStore();
    await store.put("k2", new Uint8Array([9]), { mimeType: "application/octet-stream", size: 1 });
    const { stream, meta } = await store.getReadStream("k2");
    expect(meta.mimeType).toBe("application/octet-stream");
    expect(typeof (stream as { pipe?: unknown }).pipe).toBe("function");
  });

  it("读取不存在对象 → 抛可识别的 BlobNotFoundError(Req 1.5)", async () => {
    const store = makeMemoryStore();
    await expect(store.getReadStream("nope")).rejects.toBeInstanceOf(BlobNotFoundError);
    await expect(store.head("nope")).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("presignUrl 产出可达 URL 形态、delete 可调用(Req 1.1 五能力齐备)", async () => {
    const store = makeMemoryStore();
    await store.put("k3", new Uint8Array([0]), { mimeType: "image/png", size: 1 });
    await expect(store.presignUrl("k3")).resolves.toContain("/attachments/k3/raw");
    await expect(store.delete("k3")).resolves.toBeUndefined();
  });
});
