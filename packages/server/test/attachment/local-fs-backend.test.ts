/**
 * attachment-store · LocalFsBlobBackend 本地文件系统后端集成测试
 * (Req 1.2, 1.3, 1.4, 1.6, 1.7, 2.6;design.md §BlobStore/LocalFsBlobBackend、Physical Data Model、Testing Strategy Unit 3)。
 *
 * 用临时目录(os.tmpdir + mkdtemp)落盘,测试后清理。断言:
 * - put 后**新建后端实例**(同 root 目录)get/head 往返一致 mime/size
 *   → 证明字节真落盘、持久化、进程重启(新实例)可读(Req 1.2/1.3/1.4);
 * - getReadStream/head 读不存在 key → 抛可识别的 BlobNotFoundError(Req 1.5,引用 2.1 错误);
 * - getReadStream 的 meta 即导出的 BlobMeta(mime/size,Req 1.6);
 * - 盘上路径解析(diskPath)返回 `<root>/<key>` 绝对路径,供门面 localPath 复用(Req 1.7);
 * - 盘上布局为 `<root>/<key>` 平铺、key=id(Req 2.6,冻结为跨 spec 契约);
 * - presignUrl 委托 UrlSigner 产 `/attachments/:key/raw?exp&sig` 形态(与 S3 presign 同形);
 * - body 支持 Uint8Array 与可读流两种入参(流式落盘);delete 幂等。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { BlobNotFoundError, type BlobMeta } from "../../src/attachment/blob-store.js";
import { LocalFsBlobBackend } from "../../src/attachment/local-fs-backend.js";
import { createUrlSigner } from "../../src/attachment/url-signer.js";

const SECRET = "test-secret-stable-source-0123456789";

/** 读流读尽为 Buffer。 */
async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe("LocalFsBlobBackend(Req 1.2/1.3/1.4/1.6/1.7/2.6)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "attstore-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function makeBackend() {
    return new LocalFsBlobBackend(root, createUrlSigner(SECRET));
  }

  it("put → 新建后端实例(同 root)get/head 往返一致 mime/size(证持久化、进程重启可读)", async () => {
    const writer = makeBackend();
    const bytes = Buffer.from("hello attachment bytes");
    const meta: BlobMeta = { mimeType: "text/plain", size: bytes.length };
    await writer.put("att_persist", bytes, meta);

    // 模拟进程重启:对同一 root 新建一个独立后端实例。
    const reader = makeBackend();

    await expect(reader.head("att_persist")).resolves.toEqual(meta);
    const { stream, meta: streamMeta } = await reader.getReadStream("att_persist");
    expect(streamMeta).toEqual(meta);
    expect((await drain(stream)).equals(bytes)).toBe(true);
  });

  it("getReadStream 的 meta 形态即导出的 BlobMeta(mime/size,Req 1.6)", async () => {
    const backend = makeBackend();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await backend.put("att_meta", bytes, { mimeType: "image/png", size: bytes.length });
    const { meta } = await backend.getReadStream("att_meta");
    expect(meta.mimeType).toBe("image/png");
    expect(meta.size).toBe(bytes.length);
  });

  it("body 支持可读流入参(流式落盘),往返字节一致", async () => {
    const backend = makeBackend();
    const bytes = Buffer.from("streamed-body-content");
    await backend.put("att_stream", Readable.from(bytes), {
      mimeType: "application/octet-stream",
      size: bytes.length,
    });
    const { stream } = await backend.getReadStream("att_stream");
    expect((await drain(stream)).equals(bytes)).toBe(true);
  });

  it("读不存在 key:getReadStream/head 抛可识别的 BlobNotFoundError(Req 1.5)", async () => {
    const backend = makeBackend();
    await expect(backend.getReadStream("att_missing")).rejects.toBeInstanceOf(BlobNotFoundError);
    await expect(backend.head("att_missing")).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it("盘上路径解析返回 `<root>/<key>` 绝对路径(Req 1.7 复用契约)", async () => {
    const backend = makeBackend();
    const p = backend.diskPath("att_id123");
    expect(isAbsolute(p)).toBe(true);
    expect(p).toBe(join(root, "att_id123"));
  });

  it("盘上布局为 `<root>/<key>` 平铺、key=id;meta 旁路 `<root>/<key>.meta.json`(Req 2.6)", async () => {
    const backend = makeBackend();
    const bytes = Buffer.from("layout-check");
    await backend.put("att_layout", bytes, { mimeType: "text/plain", size: bytes.length });
    // 字节文件就在 <root>/<key>。
    expect((await readFile(join(root, "att_layout"))).equals(bytes)).toBe(true);
    // meta 旁路文件。
    const sidecar = JSON.parse(await readFile(join(root, "att_layout.meta.json"), "utf8"));
    expect(sidecar).toEqual({ mimeType: "text/plain", size: bytes.length });
  });

  it("presignUrl 委托 UrlSigner 产 `/attachments/:key/raw?exp&sig` 形态(与 S3 presign 同形)", async () => {
    const backend = makeBackend();
    const url = await backend.presignUrl("att_url", { expiresInMs: 60_000 });
    expect(url).toContain("/attachments/att_url/raw");
    expect(url).toMatch(/[?&]exp=\d+/);
    expect(url).toMatch(/[?&]sig=[0-9a-f]+/);
    // 签名对该 url 的 exp/sig 应能被同 secret 的 signer 校验通过。
    const u = new URL(url, "http://x");
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig") ?? "";
    expect(createUrlSigner(SECRET).verify("att_url", exp, sig)).toBe(true);
  });

  it("presignUrl 默认 TTL 为长窗口(历史回放不过期;方案 C)", async () => {
    const backend = makeBackend();
    // 不传 expiresInMs → 落到 DEFAULT_URL_TTL_MS(默认 10 年)。
    const url = await backend.presignUrl("att_longttl");
    const exp = Number(new URL(url, "http://x").searchParams.get("exp"));
    // exp 应远大于 now + 1 年,确认不是旧的 5 分钟短窗口。
    const oneYearMs = 365 * 24 * 60 * 60_000;
    expect(exp).toBeGreaterThan(Date.now() + oneYearMs);
  });

  it("delete 移除字节与 meta 旁路;不存在为幂等(不抛)", async () => {
    const backend = makeBackend();
    await backend.put("att_del", Buffer.from("x"), { mimeType: "text/plain", size: 1 });
    await backend.delete("att_del");
    await expect(stat(join(root, "att_del"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, "att_del.meta.json"))).rejects.toMatchObject({ code: "ENOENT" });
    // 再次删除(已不存在)幂等不抛。
    await expect(backend.delete("att_del")).resolves.toBeUndefined();
    await expect(backend.delete("att_never")).resolves.toBeUndefined();
  });
});
