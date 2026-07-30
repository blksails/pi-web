/**
 * attachment-tool-bridge · L2 投影 `resolveAttachment` / `AttachmentHandle` 单元测试
 * (task 2.2;Req 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 9.2)。
 *
 * 断言(design.md §AttachmentHandle / resolve · Testing Strategy/Unit 1):
 * - `resolve(store, id)` 返回携带上游 `Attachment` 元数据的句柄(Req 1.1);
 * - `localPath()` **经门面 `localPath(id)` 直返落盘路径 `<root>/<id>`、不复制**
 *   (断言返回值 === 门面 `localPath(id)` 的值,Req 1.3);
 * - `bytes()`/`stream()` 往返字节一致,`stream()` 的 meta 为上游 `BlobMeta`(Req 1.2);
 * - `url()` 复用门面 `presignUrl`(签名同形,Req 1.5);
 * - 不存在 id → 抛可 `instanceof` 识别的 `AttachmentResolveError`,不返回空当成功(Req 1.6);
 * - 句柄**无 base64/data 形态**(无该名字段或方法,Req 9.2)。
 *
 * 用临时目录经 `attachmentStoreConfigFromEnv` 构造真实 store 喂 resolve;afterEach 清理。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentStoreConfigFromEnv,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} from "../../src/attachment/config.js";
import type { AttachmentStore } from "../../src/attachment/attachment-store.js";
import {
  resolveAttachment,
  AttachmentResolveError,
} from "../../src/attachment-bridge/index.js";

const SECRET = "stable-secret-for-resolve-test";

let root: string;
let store: AttachmentStore;

const PAYLOAD = new Uint8Array([11, 22, 33, 44, 55]);

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function putSample() {
  return store.put({
    bytes: PAYLOAD,
    name: "sample.bin",
    mimeType: "application/octet-stream",
    size: PAYLOAD.length,
    sessionId: "sess-resolve",
    origin: "tool-output",
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "attresolve-"));
  ({ store } = attachmentStoreConfigFromEnv({
    [ATTACHMENT_DIR_ENV]: root,
    [ATTACHMENT_SECRET_ENV]: SECRET,
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveAttachment — 四形态句柄 + meta(Req 1.1)", () => {
  it("返回携带上游 Attachment 元数据的句柄", async () => {
    const att = await putSample();
    const handle = await resolveAttachment(store, att.id);

    // meta 为上游 Attachment 描述符(复用,不内联重定义)。
    expect(handle.meta).toMatchObject({
      id: att.id,
      name: "sample.bin",
      mimeType: "application/octet-stream",
      size: PAYLOAD.length,
      origin: "tool-output",
      sessionId: "sess-resolve",
    });
  });
});

describe("resolveAttachment — localPath 经门面直返不复制(Req 1.3)", () => {
  it("localPath() === 门面 localPath(id) 的值(=<root>/<id>,不复制)", async () => {
    const att = await putSample();
    const handle = await resolveAttachment(store, att.id);

    const fromFacade = await store.localPath(att.id);
    expect(fromFacade).toBe(join(root, att.id));

    // 句柄 localPath 就是门面 localPath 的值(委托直返,不复制到别处)。
    await expect(handle.localPath()).resolves.toBe(fromFacade);
  });
});

describe("resolveAttachment — bytes/stream 往返一致(Req 1.2)", () => {
  it("bytes() 往返字节一致", async () => {
    const att = await putSample();
    const handle = await resolveAttachment(store, att.id);
    const bytes = await handle.bytes();
    expect([...bytes]).toEqual([...PAYLOAD]);
  });

  it("stream() 往返字节一致,meta 为上游 BlobMeta({mimeType,size})", async () => {
    const att = await putSample();
    const handle = await resolveAttachment(store, att.id);
    const { stream, meta } = await handle.stream();
    expect(meta).toEqual({
      mimeType: "application/octet-stream",
      size: PAYLOAD.length,
    });
    expect([...(await readAll(stream))]).toEqual([...PAYLOAD]);
  });
});

describe("resolveAttachment — url 复用分发签名同形(Req 1.5)", () => {
  it("url() 复用门面 presignUrl(同 id 同形 /raw?exp&sig)", async () => {
    const att = await putSample();
    const handle = await resolveAttachment(store, att.id);
    const url = await handle.url();
    const params = new URL(url, "http://x").searchParams;
    expect(url).toContain(att.id);
    expect(params.get("exp")).not.toBeNull();
    expect(params.get("sig")).not.toBeNull();
    // 主进程同 secret 校验通过(与门面 presignUrl 同形)。
    expect(
      store.verifyUrl(att.id, Number(params.get("exp")), params.get("sig")!),
    ).toBe(true);
  });
});

describe("resolveAttachment — 不存在 id 抛可识别错误(Req 1.6)", () => {
  it("不存在 id → 抛 AttachmentResolveError(instanceof),不返回空", async () => {
    await expect(resolveAttachment(store, "att_does_not_exist")).rejects.toBeInstanceOf(
      AttachmentResolveError,
    );
  });

  it("AttachmentResolveError 携带命中的 id 且是 Error 子类", async () => {
    const err = await resolveAttachment(store, "att_missing").catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentResolveError);
    expect(err).toBeInstanceOf(Error);
    expect((err as AttachmentResolveError).id).toBe("att_missing");
  });
});

describe("resolveAttachment — 句柄无 base64 形态(Req 9.2)", () => {
  it("句柄对象无 base64/data 字段或方法", async () => {
    const att = await putSample();
    const handle = await resolveAttachment(store, att.id);

    const keys = new Set<string>();
    for (
      let obj: object | null = handle;
      obj && obj !== Object.prototype;
      obj = Object.getPrototypeOf(obj)
    ) {
      for (const k of Object.getOwnPropertyNames(obj)) keys.add(k);
    }
    for (const k of keys) {
      expect(k.toLowerCase()).not.toContain("base64");
      expect(k.toLowerCase()).not.toContain("data");
    }
    // 显式断言四形态在、base64/data 形态不在。
    expect(typeof handle.bytes).toBe("function");
    expect(typeof handle.stream).toBe("function");
    expect(typeof handle.localPath).toBe("function");
    expect(typeof handle.url).toBe("function");
    expect((handle as unknown as Record<string, unknown>).base64).toBeUndefined();
    expect((handle as unknown as Record<string, unknown>).data).toBeUndefined();
  });
});
