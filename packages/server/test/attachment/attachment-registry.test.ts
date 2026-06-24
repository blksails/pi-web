/**
 * attachment-store · AttachmentRegistry 描述符注册表集成测试
 * (Req 2.1, 2.2, 2.5, 2.7;design.md §AttachmentRegistry、Physical Data Model、Testing Strategy Unit 5)。
 *
 * 用临时目录(os.tmpdir + mkdtemp)落盘描述符旁路文件,测试后清理。断言:
 * - save 后可按 id 取回完整描述符(不含字节字段,Req 2.1/2.2);
 * - listBySession 仅返回该会话的附件,不返回其他会话的(Req 2.7);
 * - 重复 id 幂等:同一 id 再次 save 不产生第二条描述符(单一身份,Req 2.5);
 * - 描述符跨**新建实例**(同 root)可读 → 证明真持久化、进程重启可读(design Physical Data Model);
 * - get 不存在 id 返回 undefined。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment } from "@blksails/protocol";
import { AttachmentRegistry } from "../../src/attachment/attachment-registry.js";

function makeAttachment(over: Partial<Attachment> = {}): Attachment {
  return {
    id: "att_abc123",
    name: "photo.png",
    mimeType: "image/png",
    size: 1234,
    origin: "upload",
    sessionId: "sess-1",
    createdAt: "2026-06-21T00:00:00.000Z",
    ...over,
  };
}

describe("AttachmentRegistry(Req 2.1/2.2/2.5/2.7)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "attreg-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function makeRegistry() {
    return new AttachmentRegistry(root);
  }

  it("save 后可按 id 取回完整描述符(不含字节,Req 2.1/2.2)", async () => {
    const reg = makeRegistry();
    const att = makeAttachment();
    await reg.save(att);

    const got = await reg.get(att.id);
    expect(got).toEqual(att);
    // 描述符不含任何字节字段(类型本身排除;此处守边界)。
    expect(got).not.toHaveProperty("bytes");
    expect(got).not.toHaveProperty("dataUrl");
  });

  it("描述符跨新建实例(同 root)可读 → 真持久化、进程重启可读", async () => {
    const writer = makeRegistry();
    const att = makeAttachment({ id: "att_persist", sessionId: "sess-x" });
    await writer.save(att);

    // 模拟进程重启:对同一 root 新建独立实例。
    const reader = makeRegistry();
    await expect(reader.get("att_persist")).resolves.toEqual(att);
  });

  it("listBySession 仅返回该会话的附件(Req 2.7)", async () => {
    const reg = makeRegistry();
    await reg.save(makeAttachment({ id: "att_a", sessionId: "sess-A" }));
    await reg.save(makeAttachment({ id: "att_b", sessionId: "sess-A" }));
    await reg.save(makeAttachment({ id: "att_c", sessionId: "sess-B" }));

    const listA = await reg.listBySession("sess-A");
    expect(listA.map((a) => a.id).sort()).toEqual(["att_a", "att_b"]);
    expect(listA.every((a) => a.sessionId === "sess-A")).toBe(true);

    const listB = await reg.listBySession("sess-B");
    expect(listB.map((a) => a.id)).toEqual(["att_c"]);

    // 不存在的会话返回空数组。
    await expect(reg.listBySession("sess-none")).resolves.toEqual([]);
  });

  it("重复 id 幂等:同一 id 再次 save 不产生第二条(单一身份,Req 2.5)", async () => {
    const reg = makeRegistry();
    const att = makeAttachment({ id: "att_dup", sessionId: "sess-D" });
    await reg.save(att);
    // 同一 id 再次 save(即便其它字段变化),仍只一条描述符。
    await reg.save({ ...att, name: "renamed.png" });

    const listD = await reg.listBySession("sess-D");
    expect(listD).toHaveLength(1);
    expect(listD[0]!.id).toBe("att_dup");

    // 盘上只有一份该 id 的描述符旁路文件(单一身份)。
    const entries = await readdir(root);
    const dupDescriptors = entries.filter((f) => f.startsWith("att_dup."));
    expect(dupDescriptors).toHaveLength(1);
  });

  it("get 不存在 id 返回 undefined", async () => {
    const reg = makeRegistry();
    await expect(reg.get("att_missing")).resolves.toBeUndefined();
  });
});
