/**
 * AttachmentCompletionProvider 单元测试(spec attachment-mention-completion task 3.1)。
 *
 * 覆盖:
 * - complete:多附件 → kind/label/insertText/detail(类型·大小)(1.1/3.1/3.2/5.1)
 * - complete:空会话/列举抛错 → 空数组不抛(1.3)
 * - complete:带 query 按名过滤;空 query 全量(4.1/4.2)
 * - resolve:命中且同会话 → text === buildAttachmentRefs([att])(6.2)
 * - resolve:head 未命中 → null(6.3)
 * - resolve:跨会话 → null(7.2)
 */
import { describe, expect, it } from "vitest";
import type { Attachment } from "@pi-web/protocol";
import {
  createAttachmentProvider,
  ATTACHMENT_PROVIDER_ID,
  ATTACHMENT_KIND,
  type AttachmentLister,
} from "../../src/completion/index.js";
import type { CompletionCtx } from "../../src/completion/index.js";
import { buildAttachmentRefs } from "../../src/attachment-bridge/reference-injection.js";

function att(p: Partial<Attachment> & { id: string }): Attachment {
  return {
    id: p.id,
    name: p.name ?? p.id,
    mimeType: p.mimeType ?? "application/octet-stream",
    size: p.size ?? 0,
    origin: p.origin ?? "upload",
    sessionId: p.sessionId ?? "s1",
    createdAt: p.createdAt ?? "2024-01-01T00:00:00.000Z",
  };
}

/** 内存存根:listBySession 按 sessionId 过滤;head 全局查 id。可注入抛错。 */
function makeStore(
  all: readonly Attachment[],
  opts: { throwOnList?: boolean } = {},
): AttachmentLister {
  return {
    async listBySession(sessionId: string): Promise<readonly Attachment[]> {
      if (opts.throwOnList) throw new Error("boom");
      return all.filter((a) => a.sessionId === sessionId);
    },
    async head(id: string): Promise<Attachment | undefined> {
      return all.find((a) => a.id === id);
    },
  };
}

const CTX: CompletionCtx = { sessionId: "s1", cwd: "/tmp", userId: "u1" };

describe("AttachmentCompletionProvider", () => {
  it("声明 id/trigger/kind 与框架约定一致", () => {
    const p = createAttachmentProvider(makeStore([]));
    expect(p.id).toBe(ATTACHMENT_PROVIDER_ID);
    expect(p.id).toBe("attachment");
    expect(p.trigger).toBe("@");
    expect(p.kind).toBe(ATTACHMENT_KIND);
    expect(p.kind).toBe("attachment");
  });

  describe("complete", () => {
    it("多附件 → 每项 kind/label/insertText/detail(类型·大小)(1.1/3.1/3.2/5.1)", async () => {
      const store = makeStore([
        att({ id: "att_a", name: "diagram.png", mimeType: "image/png", size: 131072 }),
        att({ id: "att_b", name: "notes.txt", mimeType: "text/plain", size: 42 }),
      ]);
      const p = createAttachmentProvider(store);
      const items = await p.complete({ query: "", ctx: CTX });
      expect(items).toHaveLength(2);
      const a = items.find((i) => i.id === "att_a")!;
      expect(a.providerId).toBe(ATTACHMENT_PROVIDER_ID);
      expect(a.kind).toBe("attachment");
      expect(a.label).toBe("diagram.png");
      expect(a.insertText).toBe("@attachment:att_a");
      expect(a.detail).toContain("image/png");
      expect(a.detail).toContain("128 KB"); // 131072 字节人类可读
      const b = items.find((i) => i.id === "att_b")!;
      expect(b.detail).toContain("text/plain");
      expect(b.detail).toContain("42 B");
    });

    it("仅返回当前会话附件(7.1/7.3)", async () => {
      const store = makeStore([
        att({ id: "att_mine", name: "mine.png", sessionId: "s1" }),
        att({ id: "att_other", name: "other.png", sessionId: "s2" }),
      ]);
      const p = createAttachmentProvider(store);
      const items = await p.complete({ query: "", ctx: CTX });
      expect(items.map((i) => i.id)).toEqual(["att_mine"]);
    });

    it("空会话/空列表 → 返回空数组不抛错(1.3)", async () => {
      const p = createAttachmentProvider(makeStore([]));
      await expect(p.complete({ query: "", ctx: CTX })).resolves.toEqual([]);
    });

    it("列举抛错 → 返回空数组不抛错(降级)", async () => {
      const store = makeStore(
        [att({ id: "att_a", name: "x.png" })],
        { throwOnList: true },
      );
      const p = createAttachmentProvider(store);
      await expect(p.complete({ query: "", ctx: CTX })).resolves.toEqual([]);
    });

    it("带 query → 仅返回名称匹配项;空 query → 全量(4.1/4.2)", async () => {
      const store = makeStore([
        att({ id: "att_a", name: "diagram.png" }),
        att({ id: "att_b", name: "notes.txt" }),
        att({ id: "att_c", name: "diary.md" }),
      ]);
      const p = createAttachmentProvider(store);
      const all = await p.complete({ query: "", ctx: CTX });
      expect(all).toHaveLength(3);
      const filtered = await p.complete({ query: "dia", ctx: CTX });
      const ids = filtered.map((i) => i.id).sort();
      expect(ids).toEqual(["att_a", "att_c"]); // diagram + diary 命中子序列;notes 不命中
      expect(ids).not.toContain("att_b");
    });
  });

  describe("resolve", () => {
    it("命中且同会话 → text 等于 buildAttachmentRefs([att])(6.2)", async () => {
      const a = att({
        id: "att_a",
        name: "diagram.png",
        mimeType: "image/png",
        sessionId: "s1",
      });
      const p = createAttachmentProvider(makeStore([a]));
      const r = await p.resolve!(
        { kind: "attachment", id: "att_a", raw: "@attachment:att_a" },
        CTX,
      );
      expect(r).toEqual({ text: buildAttachmentRefs([a]) });
      expect(r?.text).toBe(
        "[attachment id=att_a type=image/png name=diagram.png]",
      );
    });

    it("head 返回 undefined → null(6.3)", async () => {
      const p = createAttachmentProvider(makeStore([]));
      const r = await p.resolve!(
        { kind: "attachment", id: "att_missing", raw: "@attachment:att_missing" },
        CTX,
      );
      expect(r).toBeNull();
    });

    it("附件属于其它会话 → null(7.2)", async () => {
      const a = att({ id: "att_x", name: "x.png", sessionId: "s2" });
      const p = createAttachmentProvider(makeStore([a]));
      const r = await p.resolve!(
        { kind: "attachment", id: "att_x", raw: "@attachment:att_x" },
        CTX,
      );
      expect(r).toBeNull();
    });
  });
});
