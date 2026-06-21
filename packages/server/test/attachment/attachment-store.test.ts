/**
 * attachment-store · AttachmentStore 门面集成测试(task 2.4;Req 1.3, 1.6, 1.7, 2.3, 2.4, 2.5, 2.7, 4.5)。
 *
 * 组合 BlobStore(LocalFsBlobBackend)+ AttachmentRegistry + UrlSigner,断言:
 * - `put` 写路径内铸造 `att_…` 公开 id、落盘字节、写描述符,返回**不含字节**的描述符
 *   (记 origin/sessionId/size/createdAt)(Req 2.3/2.4/2.1);
 * - 经 `presignUrl` 签发的 URL 可经 `verifyUrl` 校验,且 `getReadStream` 取回原始字节(Req 4.5/1.6);
 * - `head` 返回属主与 mime/size(Req 2.1);
 * - `localPath(id)` 返回 `<root>/<id>`(委托 LocalFs diskPath,Req 1.7);
 * - `listBySession` 会话隔离(委托 Registry,Req 2.7);
 * - 公开 id 仅由 `put` 产生(门面无对外铸造入口);
 * - origin 可传 `tool-output`(store 不对取值设限);
 * - 先落 blob 再写描述符:save 失败不暴露半落库引用(Req 单一身份/先落库后引用)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createUrlSigner } from "../../src/attachment/url-signer.js";
import { LocalFsBlobBackend } from "../../src/attachment/local-fs-backend.js";
import { AttachmentRegistry } from "../../src/attachment/attachment-registry.js";
import {
  AttachmentStore,
  type PutInput,
} from "../../src/attachment/attachment-store.js";

const SECRET = "test-secret-stable";

let root: string;

async function makeStore(): Promise<AttachmentStore> {
  const signer = createUrlSigner(SECRET);
  const backend = new LocalFsBlobBackend(root, signer);
  const registry = new AttachmentRegistry(root);
  return new AttachmentStore({ blob: backend, registry, signer, backend });
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function baseInput(overrides: Partial<PutInput> = {}): PutInput {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    name: "hello.png",
    mimeType: "image/png",
    size: 4,
    sessionId: "sess-A",
    origin: "upload",
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attstore-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("AttachmentStore.put 写路径(Req 2.3/2.4/2.1)", () => {
  it("铸造 att_ 形 id、落盘字节、返回不含字节的描述符", async () => {
    const store = await makeStore();
    const att = await store.put(baseInput());

    expect(att.id).toMatch(/^att_[A-Za-z0-9_-]+$/);
    expect(att.name).toBe("hello.png");
    expect(att.mimeType).toBe("image/png");
    expect(att.size).toBe(4);
    expect(att.origin).toBe("upload");
    expect(att.sessionId).toBe("sess-A");
    expect(typeof att.createdAt).toBe("string");
    expect(new Date(att.createdAt).toISOString()).toBe(att.createdAt);
    // 描述符不含字节
    expect(att).not.toHaveProperty("bytes");
  });

  it("公开 id 由 put 产生,门面无对外铸造入口(Req 2.4)", async () => {
    const store = await makeStore();
    // 门面对象上不存在任何 mint*/createId 等对外铸造方法
    const keys = [
      ...Object.getOwnPropertyNames(store),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(store)),
    ];
    expect(keys.some((k) => /mint|create.*id/i.test(k))).toBe(false);
    const a = await store.put(baseInput());
    const b = await store.put(baseInput());
    expect(a.id).not.toBe(b.id); // 不可枚举、互异
  });

  it("origin 可传 tool-output,store 不对取值设限", async () => {
    const store = await makeStore();
    const att = await store.put(baseInput({ origin: "tool-output" }));
    expect(att.origin).toBe("tool-output");
  });
});

describe("AttachmentStore 读路径(Req 4.5/1.6/2.1)", () => {
  it("presignUrl 可经 verifyUrl 校验,getReadStream 取回原始字节", async () => {
    const store = await makeStore();
    const att = await store.put(baseInput());

    const url = await store.presignUrl(att.id);
    expect(url).toContain(`/attachments/${att.id}/raw`);
    const params = new URL(url, "http://x").searchParams;
    const exp = Number(params.get("exp"));
    const sig = params.get("sig")!;
    expect(store.verifyUrl(att.id, exp, sig)).toBe(true);
    expect(store.verifyUrl(att.id, exp, "tampered")).toBe(false);

    const { stream, meta } = await store.getReadStream(att.id);
    expect(meta.mimeType).toBe("image/png");
    expect(meta.size).toBe(4);
    const bytes = await readAll(stream);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });

  it("head 返回属主与 mime(Req 2.1)", async () => {
    const store = await makeStore();
    const att = await store.put(baseInput());
    const head = await store.head(att.id);
    expect(head).toBeDefined();
    expect(head!.sessionId).toBe("sess-A");
    expect(head!.mimeType).toBe("image/png");
    expect(head!.origin).toBe("upload");
  });

  it("head 对不存在 id 返回 undefined", async () => {
    const store = await makeStore();
    await expect(store.head("att_missing")).resolves.toBeUndefined();
  });

  it("接受可读流 body 落盘并取回(Req 1.3 流式)", async () => {
    const store = await makeStore();
    const att = await store.put(
      baseInput({ bytes: Readable.from(Buffer.from([7, 8, 9])), size: 3 }),
    );
    const { stream } = await store.getReadStream(att.id);
    expect([...(await readAll(stream))]).toEqual([7, 8, 9]);
  });
});

describe("AttachmentStore 一等只读访问器(Req 1.7/2.7)", () => {
  it("localPath 返回 <root>/<id>,委托 LocalFs diskPath", async () => {
    const store = await makeStore();
    const att = await store.put(baseInput());
    await expect(store.localPath(att.id)).resolves.toBe(join(root, att.id));
    // 盘上确实落了该字节文件
    await expect(stat(join(root, att.id))).resolves.toBeDefined();
  });

  it("listBySession 会话隔离(委托 Registry,Req 2.7)", async () => {
    const store = await makeStore();
    const a1 = await store.put(baseInput({ sessionId: "sess-A" }));
    const a2 = await store.put(baseInput({ sessionId: "sess-A" }));
    const b1 = await store.put(baseInput({ sessionId: "sess-B" }));

    const listA = await store.listBySession("sess-A");
    const idsA = listA.map((a) => a.id).sort();
    expect(idsA).toEqual([a1.id, a2.id].sort());
    expect(idsA).not.toContain(b1.id);

    const listB = await store.listBySession("sess-B");
    expect(listB.map((a) => a.id)).toEqual([b1.id]);
  });
});

describe("AttachmentStore 先落 blob 再写描述符 — save 失败不暴露半落库引用", () => {
  it("registry.save 抛错时 put 抛出且不返回 id,已落 blob 被回滚", async () => {
    const signer = createUrlSigner(SECRET);
    const backend = new LocalFsBlobBackend(root, signer);
    const registry = new AttachmentRegistry(root);
    // 注入会抛错的 save,模拟描述符写失败
    let savedId: string | undefined;
    registry.save = async (att) => {
      savedId = att.id;
      throw new Error("disk full");
    };
    const store = new AttachmentStore({ blob: backend, registry, signer, backend });

    await expect(store.put(baseInput())).rejects.toThrow();
    expect(savedId).toBeDefined();
    // 半落库回滚:blob 字节文件不应残留(否则即暴露了未注册的半落库对象)
    await expect(stat(join(root, savedId!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("AttachmentStore.delete", () => {
  it("删除后 blob 字节文件移除(getReadStream 抛未找到)", async () => {
    const store = await makeStore();
    const att = await store.put(baseInput());
    await store.delete(att.id);
    await expect(stat(join(root, att.id))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(store.getReadStream(att.id)).rejects.toBeDefined();
  });
});
