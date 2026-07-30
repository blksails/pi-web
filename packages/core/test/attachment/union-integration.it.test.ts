/**
 * attachment · 双本地后端 union 全链集成测试(attachment-backend-pluggable spec,任务 7.1;
 * Req 3.2, 3.3, 4.1, 4.2, 7.1, 7.2)。
 *
 * 不依赖 S3,组合两个真实 `LocalFsBlobBackend` + `LocalFsAttachmentRegistry`,经门面
 * `AttachmentStore` 驱动 union 的完整读写路径:
 * - 落库 → 描述符含绑定 → 读/签发/删除仅作用选中后端;
 * - 预置无绑定对象(直接写字节到某后端,不经门面)→ 读探测命中该后端;
 * - 模拟描述符写失败 → union 对全部后端执行幂等删(回滚闭环)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUrlSigner } from "../../src/attachment/url-signer.js";
import { LocalFsBlobBackend } from "../../src/attachment/local-fs-backend.js";
import { LocalFsAttachmentRegistry } from "../../src/attachment/attachment-registry.js";
import { AttachmentStore } from "../../src/attachment/attachment-store.js";
import { UnionBlobStore } from "../../src/attachment/union-blob-store.js";

const SECRET = "union-integration-secret";

let dirA: string;
let dirB: string;
let regDir: string;

beforeEach(async () => {
  dirA = await mkdtemp(join(tmpdir(), "unionit-a-"));
  dirB = await mkdtemp(join(tmpdir(), "unionit-b-"));
  regDir = await mkdtemp(join(tmpdir(), "unionit-reg-"));
});
afterEach(async () => {
  await rm(dirA, { recursive: true, force: true });
  await rm(dirB, { recursive: true, force: true });
  await rm(regDir, { recursive: true, force: true });
});

function basePut(overrides: Record<string, unknown> = {}) {
  return {
    bytes: new Uint8Array([11, 22, 33]),
    name: "u.bin",
    mimeType: "application/octet-stream",
    size: 3,
    sessionId: "sess-union",
    origin: "upload" as const,
    ...overrides,
  };
}

function makeUnionStore(): {
  store: AttachmentStore;
  registry: LocalFsAttachmentRegistry;
  a: LocalFsBlobBackend;
  b: LocalFsBlobBackend;
  union: UnionBlobStore;
} {
  const signer = createUrlSigner(SECRET);
  const a = new LocalFsBlobBackend(dirA, signer);
  const b = new LocalFsBlobBackend(dirB, signer);
  const registry = new LocalFsAttachmentRegistry(regDir);
  const union = new UnionBlobStore({
    backends: [
      { name: "a", store: a },
      { name: "b", store: b },
    ],
    writePolicy: () => "a",
    resolveBackendName: (key) => registry.get(key).then((d) => d?.backend),
  });
  const store = new AttachmentStore({ blob: union, registry, signer, backend: a });
  return { store, registry, a, b, union };
}

describe("union 全链 — 落库→描述符含绑定→读/签发/删除仅作用选中后端(Req 3.2/3.3/4.1)", () => {
  it("put 选中 a,读/presign/delete 全部只碰 a,不碰 b", async () => {
    const { store } = makeUnionStore();
    const att = await store.put(basePut());
    expect(att.backend).toBe("a");

    await expect(stat(join(dirA, att.id))).resolves.toBeDefined();
    await expect(stat(join(dirB, att.id))).rejects.toMatchObject({ code: "ENOENT" });

    const { stream, meta } = await store.getReadStream(att.id);
    expect(meta.size).toBe(3);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([11, 22, 33]);

    const url = await store.presignUrl(att.id);
    expect(url).toContain(`/attachments/${att.id}/raw`);

    await store.delete(att.id);
    await expect(stat(join(dirA, att.id))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("union 全链 — 预置无绑定对象,读探测命中次后端(Req 4.2)", () => {
  it("直接写字节到 b(绕过门面,无描述符)→ union 读路径按声明顺序探测命中 b", async () => {
    const { union, b } = makeUnionStore();
    // 直接写 b,不经门面/registry(模拟迁移期存量对象:字节存在但无描述符绑定)。
    await b.put("att_legacy", new Uint8Array([99]), { mimeType: "image/png", size: 1 });

    const meta = await union.head("att_legacy");
    expect(meta.size).toBe(1);
    const { stream } = await union.getReadStream("att_legacy");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([99]);
  });
});

describe("union 全链 — 描述符写失败回滚(Req 3.2/7.1/7.2)", () => {
  it("registry.save 抛错 → 门面 put 抛错,union 对全部后端执行幂等删(回滚闭环)", async () => {
    const { store, registry, a, b } = makeUnionStore();
    registry.save = async () => {
      throw new Error("descriptor disk full");
    };

    await expect(store.put(basePut())).rejects.toThrow("descriptor disk full");

    // union 的 delete 无绑定分支(此刻描述符未写入,resolveBackendName 查不到)对全部后端幂等删:
    // 字节已写入选中后端 a(writePolicy 恒选 a),回滚后 a 不应残留;b 从未写入,幂等不抛。
    const aFiles = await import("node:fs/promises").then((fs) => fs.readdir(dirA));
    expect(aFiles.filter((f) => f.startsWith("att_"))).toHaveLength(0);
    void b;
  });
});
