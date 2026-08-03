/**
 * attachment · UnionBlobStore 单元测试(attachment-backend-pluggable spec,任务 3.1/3.2)。
 *
 * 覆盖:构造校验(空集/重名)、写路由(缺省首个/自定义策略/未知名抛错)、
 * 读路由(绑定命中/未命中探测链/BlobNotFoundError 穿透/非 NotFound 直抛/全空抛/
 * 绑定失配报错)、删除双路径(有绑定/无绑定幂等全删)。
 */
import { describe, expect, it, vi } from "vitest";
import {
  BlobNotFoundError,
  type BlobMeta,
  type BlobStore,
  type PutReceipt,
} from "../../src/attachment/blob-store.js";
import {
  UnionBlobStore,
  UnknownBackendBindingError,
  type NamedBackend,
} from "../../src/attachment/union-blob-store.js";

function makeMemoryBackend(): BlobStore & { blobs: Map<string, { bytes: Uint8Array; meta: BlobMeta }> } {
  const blobs = new Map<string, { bytes: Uint8Array; meta: BlobMeta }>();
  return {
    blobs,
    async put(key, body, meta): Promise<PutReceipt> {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array();
      blobs.set(key, { bytes, meta });
      return {};
    },
    async getReadStream(key) {
      const found = blobs.get(key);
      if (!found) throw new BlobNotFoundError(key);
      const { Readable } = await import("node:stream");
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

const META: BlobMeta = { mimeType: "image/png", size: 3 };

describe("UnionBlobStore 构造校验(design.md 构造契约)", () => {
  it("空后端集合 → 构造抛错", () => {
    expect(() => new UnionBlobStore({ backends: [], resolveBackendName: async () => undefined })).toThrow(
      /non-empty/,
    );
  });

  it("重名后端 → 构造抛错", () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    const backends: NamedBackend[] = [
      { name: "dup", store: a },
      { name: "dup", store: b },
    ];
    expect(
      () => new UnionBlobStore({ backends, resolveBackendName: async () => undefined }),
    ).toThrow(/duplicate/);
  });
});

describe("UnionBlobStore 写路由(Req 3.1/2.2)", () => {
  it("缺省 writePolicy 恒选 backends[0],回执报告该后端名", async () => {
    const primary = makeMemoryBackend();
    const secondary = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [
        { name: "primary", store: primary },
        { name: "secondary", store: secondary },
      ],
      resolveBackendName: async () => undefined,
    });
    const receipt = await union.put("k1", new Uint8Array([1, 2, 3]), META);
    expect(receipt.backendName).toBe("primary");
    expect(primary.blobs.has("k1")).toBe(true);
    expect(secondary.blobs.has("k1")).toBe(false);
  });

  it("自定义 writePolicy 选定后端落字节并回执该名", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      writePolicy: () => "b",
      resolveBackendName: async () => undefined,
    });
    const receipt = await union.put("k2", new Uint8Array([9]), META);
    expect(receipt.backendName).toBe("b");
    expect(b.blobs.has("k2")).toBe(true);
    expect(a.blobs.has("k2")).toBe(false);
  });

  it("writePolicy 返回未注册名 → put 抛错", async () => {
    const a = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [{ name: "a", store: a }],
      writePolicy: () => "ghost",
      resolveBackendName: async () => undefined,
    });
    await expect(union.put("k3", new Uint8Array([1]), META)).rejects.toThrow(/unknown backend "ghost"/);
  });
});

describe("UnionBlobStore put opts.writeBackend(agent-attachment-profile spec,Req 3.1/3.3)", () => {
  it("opts.writeBackend 优先于 writePolicy(即便 writePolicy 会选另一个后端)", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      writePolicy: () => "a", // 会话默认选 a,但 opts 覆盖为 b
      resolveBackendName: async () => undefined,
    });
    const receipt = await union.put("k4", new Uint8Array([1]), META, { writeBackend: "b" });
    expect(receipt.backendName).toBe("b");
    expect(b.blobs.has("k4")).toBe(true);
    expect(a.blobs.has("k4")).toBe(false);
  });

  it("opts.writeBackend 未注册名字 → put 抛错(与 writePolicy 越权同一语义)", async () => {
    const a = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [{ name: "a", store: a }],
      resolveBackendName: async () => undefined,
    });
    await expect(
      union.put("k5", new Uint8Array([1]), META, { writeBackend: "ghost-profile" }),
    ).rejects.toThrow(/unknown backend "ghost-profile"/);
  });

  it("不传 opts(或 opts.writeBackend 缺省)= 现状:走 writePolicy(既有测试零改动的结构性证明)", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      writePolicy: () => "b",
      resolveBackendName: async () => undefined,
    });
    const receiptNoOpts = await union.put("k6", new Uint8Array([1]), META);
    expect(receiptNoOpts.backendName).toBe("b");
    const receiptEmptyOpts = await union.put("k7", new Uint8Array([1]), META, {});
    expect(receiptEmptyOpts.backendName).toBe("b");
  });
});

describe("UnionBlobStore 读路由(Req 4.1/4.2/4.3)", () => {
  it("绑定命中 → 仅走绑定后端", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    await a.put("k1", new Uint8Array([1]), META);
    await b.put("k1", new Uint8Array([2]), META); // 同 key 不同内容,证明确实只读 a
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      resolveBackendName: async () => "a",
    });
    const { stream } = await union.getReadStream("k1");
    const { Readable } = await import("node:stream");
    void Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([1]);
  });

  it("绑定命中但描述符指向未找到对象 → 抛既有 BlobNotFoundError(Req 4.1)", async () => {
    const a = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [{ name: "a", store: a }],
      resolveBackendName: async () => "a",
    });
    await expect(union.head("missing")).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("无绑定(undefined)→ 按声明顺序探测,BlobNotFoundError 穿透续试直到命中(Req 4.2)", async () => {
    const first = makeMemoryBackend();
    const second = makeMemoryBackend();
    await second.put("k4", new Uint8Array([7, 8]), META);
    const union = new UnionBlobStore({
      backends: [
        { name: "first", store: first },
        { name: "second", store: second },
      ],
      resolveBackendName: async () => undefined,
    });
    const meta = await union.head("k4");
    expect(meta.size).toBe(META.size);
  });

  it("探测链中非 BlobNotFoundError 的错误直抛,不续试后续后端(Req 4.2)", async () => {
    const boom = makeMemoryBackend();
    boom.head = vi.fn(async () => {
      throw new Error("disk exploded");
    });
    const second = makeMemoryBackend();
    await second.put("k5", new Uint8Array([1]), META);
    const union = new UnionBlobStore({
      backends: [
        { name: "boom", store: boom },
        { name: "second", store: second },
      ],
      resolveBackendName: async () => undefined,
    });
    await expect(union.head("k5")).rejects.toThrow("disk exploded");
  });

  it("探测链全部未命中 → 抛 BlobNotFoundError(Req 4.2)", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      resolveBackendName: async () => undefined,
    });
    await expect(union.head("nope")).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("绑定名未在拓扑中注册 → 抛含后端名的配置错误,不静默探测(Req 4.3)", async () => {
    const a = makeMemoryBackend();
    const union = new UnionBlobStore({
      backends: [{ name: "a", store: a }],
      resolveBackendName: async () => "removed-backend",
    });
    await expect(union.head("k6")).rejects.toBeInstanceOf(UnknownBackendBindingError);
    await expect(union.head("k6")).rejects.toThrow(/removed-backend/);
  });
});

describe("UnionBlobStore 删除双路径(Req 7.1/7.2)", () => {
  it("有绑定 → 仅删绑定后端", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    await a.put("k7", new Uint8Array([1]), META);
    await b.put("k7", new Uint8Array([2]), META);
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      resolveBackendName: async () => "a",
    });
    await union.delete("k7");
    expect(a.blobs.has("k7")).toBe(false);
    expect(b.blobs.has("k7")).toBe(true);
  });

  it("无绑定 → 对全部后端幂等删(不存在不抛)", async () => {
    const a = makeMemoryBackend();
    const b = makeMemoryBackend();
    await a.put("k8", new Uint8Array([1]), META);
    // b 从未写入 k8:验证幂等(delete 对不存在不抛)。
    const union = new UnionBlobStore({
      backends: [
        { name: "a", store: a },
        { name: "b", store: b },
      ],
      resolveBackendName: async () => undefined,
    });
    await expect(union.delete("k8")).resolves.toBeUndefined();
    expect(a.blobs.has("k8")).toBe(false);
  });
});
