import { describe, expect, it } from "vitest";
import {
  AttachmentOriginSchema,
  AttachmentSchema,
  UploadAttachmentResponseSchema,
} from "../../src/attachment/attachment-dto.js";

/** 合法 Attachment 描述符负载,供多处单测复用。 */
const validAttachment = {
  id: "att_abc123",
  name: "diagram.png",
  mimeType: "image/png",
  size: 2048,
  origin: "upload" as const,
  sessionId: "s1",
  createdAt: "2026-06-21T10:00:00.000Z",
};

describe("AttachmentOriginSchema", () => {
  it("accepts upload and tool-output", () => {
    expect(AttachmentOriginSchema.parse("upload")).toBe("upload");
    expect(AttachmentOriginSchema.parse("tool-output")).toBe("tool-output");
  });
  it("rejects unknown origin", () => {
    expect(AttachmentOriginSchema.safeParse("download").success).toBe(false);
  });
});

describe("AttachmentSchema", () => {
  it("parses a full valid descriptor", () => {
    expect(AttachmentSchema.parse(validAttachment)).toEqual(validAttachment);
  });

  it("rejects when a required field is missing (field path)", () => {
    const { name, ...withoutName } = validAttachment;
    void name;
    const res = AttachmentSchema.safeParse(withoutName);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("name"))).toBe(true);
    }
  });

  it("rejects when sessionId is missing (field path)", () => {
    const { sessionId, ...withoutSession } = validAttachment;
    void sessionId;
    const res = AttachmentSchema.safeParse(withoutSession);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("sessionId"))).toBe(
        true,
      );
    }
  });

  it("rejects a negative size", () => {
    const res = AttachmentSchema.safeParse({ ...validAttachment, size: -1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("size"))).toBe(true);
    }
  });

  it("rejects a non-integer size", () => {
    expect(
      AttachmentSchema.safeParse({ ...validAttachment, size: 1.5 }).success,
    ).toBe(false);
  });

  it("accepts a zero size", () => {
    expect(AttachmentSchema.parse({ ...validAttachment, size: 0 }).size).toBe(0);
  });

  it("rejects a non-ISO createdAt string", () => {
    expect(
      AttachmentSchema.safeParse({
        ...validAttachment,
        createdAt: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown origin (field path)", () => {
    const res = AttachmentSchema.safeParse({
      ...validAttachment,
      origin: "download",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("origin"))).toBe(true);
    }
  });

  it("accepts a tool-output origin (reserved for downstream)", () => {
    expect(
      AttachmentSchema.parse({ ...validAttachment, origin: "tool-output" })
        .origin,
    ).toBe("tool-output");
  });
});

describe("UploadAttachmentResponseSchema", () => {
  it("parses { attachment, displayUrl }", () => {
    const r = UploadAttachmentResponseSchema.parse({
      attachment: validAttachment,
      displayUrl: "/attachments/att_abc123/raw?exp=1&sig=z",
    });
    expect(r.attachment.id).toBe("att_abc123");
    expect(r.displayUrl).toBe("/attachments/att_abc123/raw?exp=1&sig=z");
  });

  it("rejects when displayUrl is missing (field path)", () => {
    const res = UploadAttachmentResponseSchema.safeParse({
      attachment: validAttachment,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("displayUrl"))).toBe(
        true,
      );
    }
  });

  it("rejects when the nested attachment is invalid (field path)", () => {
    const res = UploadAttachmentResponseSchema.safeParse({
      attachment: { ...validAttachment, size: -5 },
      displayUrl: "/x",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("size"))).toBe(true);
    }
  });
});
