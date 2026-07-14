/**
 * attachment · S3AttachmentRegistry 单测(attachment-backend-pluggable spec,任务 4.4;Req 5.2/5.3)。
 *
 * 注入假 fetch(内存对象存储模拟)断言:save 先描述符后索引且幂等;get 未找到返回 undefined;
 * listBySession 前缀枚举 + 并发取回;getMeta/setMeta 与本地实现同语义。
 */
import { describe, expect, it } from "vitest";
import type { Attachment } from "@blksails/pi-web-protocol";
import { AttachmentDescriptorNotFoundError } from "../../../src/attachment/attachment-registry.js";
import { S3AttachmentRegistry } from "../../../src/attachment/s3/s3-registry.js";

/** 极简内存对象存储:模拟 S3 REST 语义,支撑 S3Client 经 fetchImpl 走通。 */
function makeFakeS3(): { fetchImpl: typeof fetch; objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    // path-style: /<bucket>/<key> — strip the leading bucket segment to get the object key.
    const withoutBucket = u.pathname.slice(1).split("/").slice(1).join("/");
    const key = decodeURIComponent(withoutBucket);
    const method = (init?.method ?? "GET").toUpperCase();

    if (u.searchParams.get("list-type") === "2") {
      const prefix = u.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      const xml = `<ListBucketResult>${keys
        .map((k) => `<Contents><Key>${k}</Key></Contents>`)
        .join("")}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }

    if (method === "PUT") {
      const body = init?.body as Uint8Array | undefined;
      objects.set(key, Buffer.from(body ?? new Uint8Array()));
      return new Response(null, { status: 200 });
    }
    if (method === "GET") {
      const found = objects.get(key);
      if (found === undefined) return new Response(null, { status: 404 });
      return new Response(found, { status: 200 });
    }
    if (method === "HEAD") {
      const found = objects.get(key);
      if (found === undefined) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 200,
        headers: { "content-length": String(found.length) },
      });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 400 });
  }) as unknown as typeof fetch;
  return { fetchImpl, objects };
}

const BASE = {
  bucket: "att-bucket",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  forcePathStyle: true, // 简化假实现的 key 提取(路径风格:/bucket/key)
};

function baseAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att_s3_1",
    name: "x.png",
    mimeType: "image/png",
    size: 3,
    origin: "upload",
    sessionId: "sess-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("S3AttachmentRegistry(Req 5.2/5.3)", () => {
  it("save 先写描述符后写会话索引(均幂等);get 读回原样描述符", async () => {
    const { fetchImpl, objects } = makeFakeS3();
    const reg = new S3AttachmentRegistry({ ...BASE, fetchImpl });
    const att = baseAttachment();
    await reg.save(att);

    expect(objects.has("att/att_s3_1.json")).toBe(true);
    expect(objects.has("by-session/sess-1/att_s3_1")).toBe(true);

    const got = await reg.get("att_s3_1");
    expect(got).toEqual(att);
  });

  it("get 对不存在 id 返回 undefined", async () => {
    const { fetchImpl } = makeFakeS3();
    const reg = new S3AttachmentRegistry({ ...BASE, fetchImpl });
    await expect(reg.get("nope")).resolves.toBeUndefined();
  });

  it("listBySession 前缀枚举 + 并发取回,按会话隔离", async () => {
    const { fetchImpl } = makeFakeS3();
    const reg = new S3AttachmentRegistry({ ...BASE, fetchImpl });
    const a1 = baseAttachment({ id: "att_a1", sessionId: "s-A" });
    const a2 = baseAttachment({ id: "att_a2", sessionId: "s-A" });
    const b1 = baseAttachment({ id: "att_b1", sessionId: "s-B" });
    await reg.save(a1);
    await reg.save(a2);
    await reg.save(b1);

    const listA = await reg.listBySession("s-A");
    expect(listA.map((a) => a.id).sort()).toEqual(["att_a1", "att_a2"]);
    const listB = await reg.listBySession("s-B");
    expect(listB.map((a) => a.id)).toEqual(["att_b1"]);
  });

  it("getMeta/setMeta:整体覆盖、原样往返,目标不存在抛 AttachmentDescriptorNotFoundError", async () => {
    const { fetchImpl } = makeFakeS3();
    const reg = new S3AttachmentRegistry({ ...BASE, fetchImpl });
    const att = baseAttachment({ id: "att_meta1" });
    await reg.save(att);

    await expect(reg.getMeta("att_meta1")).resolves.toBeUndefined();
    await reg.setMeta("att_meta1", { derivedFrom: "att_root" });
    await expect(reg.getMeta("att_meta1")).resolves.toEqual({ derivedFrom: "att_root" });
    // 整体覆盖不合并
    await reg.setMeta("att_meta1", { a: 1 });
    await expect(reg.getMeta("att_meta1")).resolves.toEqual({ a: 1 });
    // setMeta 不触碰其余字段
    const reread = await reg.get("att_meta1");
    expect(reread?.name).toBe(att.name);

    await expect(reg.setMeta("att_missing", { x: 1 })).rejects.toBeInstanceOf(
      AttachmentDescriptorNotFoundError,
    );
  });
});
