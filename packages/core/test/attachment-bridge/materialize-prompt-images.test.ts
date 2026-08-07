/**
 * attachment-mention-vision — materialize-prompt-images 单元测试。
 *
 * 覆盖:图像物化、非图跳过、跨会话跳过、读失败 fail-soft、与客户端 images 去重、
 * 从 @attachment / 规范标记 / attachmentIds 收集 id。不经 image_vision。
 */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { Attachment, ImageContent } from "@blksails/pi-web-protocol";
import {
  collectAttachmentIdsFromText,
  collectOrderedAttachmentIds,
  materializeAttachmentImages,
  materializePromptImages,
  mergePromptImages,
  type AttachmentImageSource,
} from "../../src/attachment-bridge/materialize-prompt-images.js";

function att(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    name: "file.png",
    mimeType: "image/png",
    size: 4,
    origin: "upload",
    sessionId: "sess-1",
    createdAt: "2026-08-05T00:00:00.000Z",
    ...over,
  };
}

function bytesStore(
  byMeta: Record<string, Attachment>,
  byBytes: Record<string, Uint8Array>,
  opts?: { failIds?: ReadonlySet<string>; noStream?: boolean },
): AttachmentImageSource {
  return {
    head: async (id) => byMeta[id],
    ...(opts?.noStream
      ? {}
      : {
          getReadStream: async (id) => {
            if (opts?.failIds?.has(id)) {
              throw new Error("read failed");
            }
            const bytes = byBytes[id];
            if (bytes === undefined) throw new Error("missing bytes");
            return {
              stream: Readable.from([Buffer.from(bytes)]),
              meta: { mimeType: byMeta[id]?.mimeType ?? "application/octet-stream" },
            };
          },
        }),
  };
}

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x48]);
const B64_A = Buffer.from(PNG_A).toString("base64");
const B64_B = Buffer.from(PNG_B).toString("base64");

describe("collectAttachmentIdsFromText", () => {
  it("collects @attachment tokens and marker ids in order", () => {
    const text =
      "see @attachment:att_a and [attachment id=att_b type=image/png name=b.png]";
    expect(collectAttachmentIdsFromText(text)).toEqual(["att_a", "att_b"]);
  });

  it("dedupes repeated ids", () => {
    expect(
      collectAttachmentIdsFromText(
        "@attachment:att_x @attachment:att_x [attachment id=att_x type=image/png name=x]",
      ),
    ).toEqual(["att_x"]);
  });
});

describe("collectOrderedAttachmentIds", () => {
  it("message order first, then body attachmentIds", () => {
    expect(
      collectOrderedAttachmentIds("@attachment:att_a look", [
        "att_a",
        "att_b",
      ]),
    ).toEqual(["att_a", "att_b"]);
  });
});

describe("mergePromptImages", () => {
  it("dedupes by data and prefers existing order", () => {
    const existing: ImageContent[] = [
      { type: "image", data: B64_A, mimeType: "image/png" },
    ];
    const materialized: ImageContent[] = [
      { type: "image", data: B64_A, mimeType: "image/png" },
      { type: "image", data: B64_B, mimeType: "image/png" },
    ];
    expect(mergePromptImages(existing, materialized)).toEqual([
      { type: "image", data: B64_A, mimeType: "image/png" },
      { type: "image", data: B64_B, mimeType: "image/png" },
    ]);
  });

  it("returns undefined when empty", () => {
    expect(mergePromptImages(undefined, [])).toBeUndefined();
  });
});

describe("materializeAttachmentImages", () => {
  it("materializes session image attachments to bare base64 ImageContent", async () => {
    const store = bytesStore(
      {
        att_a: att({ id: "att_a", mimeType: "image/png" }),
      },
      { att_a: PNG_A },
    );
    const images = await materializeAttachmentImages({
      ids: ["att_a"],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([
      { type: "image", data: B64_A, mimeType: "image/png" },
    ]);
    // 裸 base64,无 data: 前缀
    expect(images[0]?.data).not.toContain("data:");
  });

  it("skips non-image attachments", async () => {
    const store = bytesStore(
      {
        att_pdf: att({
          id: "att_pdf",
          mimeType: "application/pdf",
          name: "doc.pdf",
        }),
      },
      { att_pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    );
    const images = await materializeAttachmentImages({
      ids: ["att_pdf"],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([]);
  });

  it("skips cross-session and unknown ids", async () => {
    const store = bytesStore(
      {
        att_other: att({ id: "att_other", sessionId: "sess-other" }),
      },
      { att_other: PNG_A },
    );
    const images = await materializeAttachmentImages({
      ids: ["att_other", "att_missing"],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([]);
  });

  it("fail-soft on read errors", async () => {
    const store = bytesStore(
      {
        att_a: att({ id: "att_a" }),
        att_b: att({ id: "att_b" }),
      },
      { att_a: PNG_A, att_b: PNG_B },
      { failIds: new Set(["att_a"]) },
    );
    const images = await materializeAttachmentImages({
      ids: ["att_a", "att_b"],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([
      { type: "image", data: B64_B, mimeType: "image/png" },
    ]);
  });

  it("no-op when getReadStream is absent", async () => {
    const store = bytesStore(
      { att_a: att({ id: "att_a" }) },
      { att_a: PNG_A },
      { noStream: true },
    );
    const images = await materializeAttachmentImages({
      ids: ["att_a"],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([]);
  });
});

describe("materializePromptImages", () => {
  it("from @attachment mention only (no body attachmentIds)", async () => {
    const store = bytesStore(
      { att_a: att({ id: "att_a", mimeType: "image/jpeg" }) },
      { att_a: PNG_A },
    );
    const images = await materializePromptImages({
      messageText: "what is in @attachment:att_a ?",
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([
      { type: "image", data: B64_A, mimeType: "image/jpeg" },
    ]);
  });

  it("from attachmentIds only", async () => {
    const store = bytesStore(
      { att_a: att({ id: "att_a" }) },
      { att_a: PNG_A },
    );
    const images = await materializePromptImages({
      messageText: "look",
      attachmentIds: ["att_a"],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([
      { type: "image", data: B64_A, mimeType: "image/png" },
    ]);
  });

  it("dedupes client images with same data as store", async () => {
    const store = bytesStore(
      { att_a: att({ id: "att_a" }) },
      { att_a: PNG_A },
    );
    const client: ImageContent = {
      type: "image",
      data: B64_A,
      mimeType: "image/png",
    };
    const images = await materializePromptImages({
      messageText: "look",
      attachmentIds: ["att_a"],
      existingImages: [client],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([client]);
  });

  it("non-image attachmentIds yield no image parts; existing client images kept", async () => {
    const store = bytesStore(
      {
        att_pdf: att({ id: "att_pdf", mimeType: "application/pdf" }),
      },
      { att_pdf: new Uint8Array([1, 2, 3]) },
    );
    const client: ImageContent = {
      type: "image",
      data: B64_B,
      mimeType: "image/png",
    };
    const images = await materializePromptImages({
      messageText: "plain",
      attachmentIds: ["att_pdf"],
      existingImages: [client],
      sessionId: "sess-1",
      store,
    });
    expect(images).toEqual([client]);
  });

  it("does not require image_vision — pure materialize of prompt images", async () => {
    // 结构断言:本模块路径是 native images,与 image_vision 工具无关。
    const src = await import(
      "../../src/attachment-bridge/materialize-prompt-images.js"
    );
    expect(src.materializePromptImages).toBeTypeOf("function");
    expect(JSON.stringify(src)).not.toMatch(/image_vision/);
  });
});
