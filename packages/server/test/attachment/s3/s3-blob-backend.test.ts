/**
 * attachment · S3BlobBackend 单测(attachment-backend-pluggable spec,任务 4.3;Req 5.1/5.3/5.4)。
 *
 * 注入假 fetch 断言五方法与未找到映射(BlobNotFoundError,不泄漏 S3NotFoundError)。
 */
import { describe, expect, it, vi } from "vitest";
import { BlobNotFoundError } from "../../../src/attachment/blob-store.js";
import { S3BlobBackend } from "../../../src/attachment/s3/s3-blob-backend.js";

const BASE_CONFIG = {
  bucket: "att-bucket",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("S3BlobBackend(Req 5.1/5.3/5.4)", () => {
  it("put → 写入 <prefix>blob/<key>,回执为空(单后端契约,由 union 层报告后端名)", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const backend = new S3BlobBackend({ ...BASE_CONFIG, prefix: "att/", fetchImpl });
    const receipt = await backend.put("att_1", new Uint8Array([1, 2]), {
      mimeType: "image/png",
      size: 2,
    });
    expect(receipt).toEqual({});
    expect(calls[0]).toContain("/att/blob/att_1");
  });

  it("getReadStream 成功 → 流 + meta(mimeType/size 经对象头);未找到 → BlobNotFoundError", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([5, 6]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "2" },
      }),
    ) as unknown as typeof fetch;
    const backend = new S3BlobBackend({ ...BASE_CONFIG, fetchImpl });
    const { stream, meta } = await backend.getReadStream("k1");
    expect(meta).toEqual({ mimeType: "image/webp", size: 2 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([5, 6]);

    const notFoundFetch = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const backend2 = new S3BlobBackend({ ...BASE_CONFIG, fetchImpl: notFoundFetch });
    await expect(backend2.getReadStream("missing")).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("head 成功 → meta;未找到 → BlobNotFoundError", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "9" },
      }),
    ) as unknown as typeof fetch;
    const backend = new S3BlobBackend({ ...BASE_CONFIG, fetchImpl });
    await expect(backend.head("k2")).resolves.toEqual({ mimeType: "text/plain", size: 9 });

    const notFoundFetch = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const backend2 = new S3BlobBackend({ ...BASE_CONFIG, fetchImpl: notFoundFetch });
    await expect(backend2.head("missing")).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("presignUrl 产出携带 X-Amz-Signature 的直达 URL,expiresInMs 换算为秒", async () => {
    const backend = new S3BlobBackend(BASE_CONFIG);
    const url = await backend.presignUrl("k3", { expiresInMs: 60_000 });
    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-Expires")).toBe("60");
    expect(url).toContain("/blob/k3");
  });

  it("delete 幂等(不存在不抛)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const backend = new S3BlobBackend({ ...BASE_CONFIG, fetchImpl });
    await expect(backend.delete("missing")).resolves.toBeUndefined();
  });

  it("无 diskPath 能力(非本地承载,门面 localPath 契约天然返回 undefined)", () => {
    const backend = new S3BlobBackend(BASE_CONFIG);
    expect((backend as unknown as { diskPath?: unknown }).diskPath).toBeUndefined();
  });
});
