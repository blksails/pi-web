import { describe, it, expect, vi } from "vitest";
import type { Attachment } from "@blksails/pi-web-protocol";
import type {
  AttachmentToolContext,
  AttachmentToolHandle,
} from "@blksails/pi-web-agent-kit";
import { rebuildGalleryFromAttachments } from "../../../src/aigc/canvas/hydrate.js";

function att(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    id: over.id,
    name: over.name ?? `${over.id}.png`,
    mimeType: over.mimeType ?? "image/png",
    size: over.size ?? 10,
    origin: over.origin ?? "tool-output",
    sessionId: over.sessionId ?? "s1",
    createdAt: over.createdAt ?? "2026-07-02T10:00:00.000Z",
  };
}

interface FakeCtxConfig {
  available?: boolean;
  descriptors: Attachment[];
  meta?: Record<string, Record<string, unknown>>;
  urlSpy?: ReturnType<typeof vi.fn>;
  listThrows?: boolean;
}

function fakeAttachments(cfg: FakeCtxConfig): AttachmentToolContext {
  const urlSpy = cfg.urlSpy ?? vi.fn(async () => "signed-url");
  return {
    available: cfg.available ?? true,
    async resolve(id: string): Promise<AttachmentToolHandle> {
      const meta = cfg.descriptors.find((d) => d.id === id) ?? att({ id });
      return {
        meta,
        async bytes() {
          return new Uint8Array();
        },
        async localPath() {
          return "/tmp/x";
        },
        url: (): Promise<string> => urlSpy(id),
      };
    },
    async putOutput() {
      throw new Error("not used");
    },
    async listBySession() {
      if (cfg.listThrows) throw new Error("enumeration failed");
      return cfg.descriptors;
    },
    async getMeta(id: string) {
      return cfg.meta?.[id];
    },
    async setMeta() {
      /* not used */
    },
  };
}

describe("rebuildGalleryFromAttachments", () => {
  it("filter image mime、附加血缘、无 meta 为根、newest-first、签名 URL 被调", async () => {
    const urlSpy = vi.fn(async () => "signed-url");
    const ctx = fakeAttachments({
      urlSpy,
      descriptors: [
        att({ id: "att_old", createdAt: "2026-07-02T09:00:00.000Z" }),
        att({ id: "att_new", createdAt: "2026-07-02T11:00:00.000Z" }),
        att({ id: "att_txt", mimeType: "text/plain", createdAt: "2026-07-02T12:00:00.000Z" }),
      ],
      meta: { att_new: { derivedFrom: "att_old", genParams: { prompt: "p" } } },
    });

    const state = await rebuildGalleryFromAttachments(ctx);

    // 非图片被过滤。
    expect(state.assets.map((a) => a.attachmentId)).toEqual(["att_new", "att_old"]);
    // newest-first。
    expect(state.assets[0]?.attachmentId).toBe("att_new");
    // 血缘附加。
    expect(state.assets[0]?.derivedFrom).toBe("att_old");
    expect(state.assets[0]?.genParams).toEqual({ prompt: "p" });
    // 根节点无 derivedFrom。
    expect(state.assets[1]?.derivedFrom).toBeUndefined();
    // 签名 URL 生成被调(每张图一次)。
    expect(urlSpy).toHaveBeenCalledTimes(2);
    expect(state.assets[0]?.displayUrl).toBe("signed-url");
  });

  it("available=false → 空画廊(不调枚举)", async () => {
    const ctx = fakeAttachments({ available: false, descriptors: [att({ id: "att_1" })] });
    const state = await rebuildGalleryFromAttachments(ctx);
    expect(state.assets).toEqual([]);
  });

  it("枚举失败 → 抛出(交由上游 hydrate 兜底)", async () => {
    const ctx = fakeAttachments({ descriptors: [], listThrows: true });
    await expect(rebuildGalleryFromAttachments(ctx)).rejects.toThrow();
  });
});
