/**
 * agent-attachment-catalog · 四种帧 + control 载荷 schema 单测(任务 1.1;Req 1.4, 2.3, 4.2)。
 */
import { describe, expect, it } from "vitest";
import {
  AgentAttachmentCatalogFrameSchema,
  AttachmentCatalogRequestFrameSchema,
  AttachmentCatalogResultFrameSchema,
  AttachmentEventFrameSchema,
  AttachmentControlPayloadSchema,
  CatalogEntryDtoSchema,
} from "../../src/attachment/catalog.js";

const ATTACHMENT_FIXTURE = {
  id: "att_abc123",
  name: "report.pdf",
  mimeType: "application/pdf",
  size: 1024,
  origin: "tool-output" as const,
  sessionId: "sess-1",
  createdAt: new Date().toISOString(),
};

describe("CatalogEntryDtoSchema", () => {
  it("解析合法条目(全字段)", () => {
    const parsed = CatalogEntryDtoSchema.parse({
      id: "entry-1",
      name: "Report",
      description: "monthly report",
      mimeType: "application/pdf",
      sizeHint: 2048,
      version: "v1",
    });
    expect(parsed.id).toBe("entry-1");
  });

  it("解析合法条目(仅必填字段)", () => {
    const parsed = CatalogEntryDtoSchema.parse({ id: "entry-1", name: "Report" });
    expect(parsed.description).toBeUndefined();
  });

  it("拒绝格式非法的 id", () => {
    expect(
      CatalogEntryDtoSchema.safeParse({ id: "-bad", name: "x" }).success,
    ).toBe(false);
    expect(
      CatalogEntryDtoSchema.safeParse({ id: "has space", name: "x" }).success,
    ).toBe(false);
  });

  it("拒绝空 name", () => {
    expect(
      CatalogEntryDtoSchema.safeParse({ id: "entry-1", name: "" }).success,
    ).toBe(false);
  });
});

describe("AgentAttachmentCatalogFrameSchema", () => {
  it("解析合法声明帧", () => {
    const parsed = AgentAttachmentCatalogFrameSchema.parse({
      type: "agent_attachment_catalog",
      available: true,
    });
    expect(parsed.available).toBe(true);
  });

  it("拒绝 available:false(字面量恒 true)", () => {
    expect(
      AgentAttachmentCatalogFrameSchema.safeParse({
        type: "agent_attachment_catalog",
        available: false,
      }).success,
    ).toBe(false);
  });

  it("拒绝错误 type 字面量", () => {
    expect(
      AgentAttachmentCatalogFrameSchema.safeParse({
        type: "agent_routes",
        available: true,
      }).success,
    ).toBe(false);
  });
});

describe("AttachmentCatalogRequestFrameSchema", () => {
  it("解析合法 list 请求帧", () => {
    const parsed = AttachmentCatalogRequestFrameSchema.parse({
      type: "piweb_attachment_catalog_request",
      id: "req-1",
      op: "list",
      query: "report",
    });
    expect(parsed.op).toBe("list");
  });

  it("解析合法 materialize 请求帧", () => {
    const parsed = AttachmentCatalogRequestFrameSchema.parse({
      type: "piweb_attachment_catalog_request",
      id: "req-1",
      op: "materialize",
      entryId: "entry-1",
    });
    expect(parsed.op).toBe("materialize");
  });

  it("拒绝 list 帧缺 query", () => {
    expect(
      AttachmentCatalogRequestFrameSchema.safeParse({
        type: "piweb_attachment_catalog_request",
        id: "req-1",
        op: "list",
      }).success,
    ).toBe(false);
  });

  it("拒绝 materialize 帧缺 entryId", () => {
    expect(
      AttachmentCatalogRequestFrameSchema.safeParse({
        type: "piweb_attachment_catalog_request",
        id: "req-1",
        op: "materialize",
      }).success,
    ).toBe(false);
  });

  it("拒绝未知 op", () => {
    expect(
      AttachmentCatalogRequestFrameSchema.safeParse({
        type: "piweb_attachment_catalog_request",
        id: "req-1",
        op: "resolve",
        query: "x",
      }).success,
    ).toBe(false);
  });
});

describe("AttachmentCatalogResultFrameSchema", () => {
  it("解析成功 list 结果帧(entries)", () => {
    const parsed = AttachmentCatalogResultFrameSchema.parse({
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: true,
      entries: [{ id: "entry-1", name: "Report" }],
    });
    expect(parsed.entries).toHaveLength(1);
  });

  it("解析成功 materialize 结果帧(attachmentId)", () => {
    const parsed = AttachmentCatalogResultFrameSchema.parse({
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: true,
      attachmentId: "att_abc123",
    });
    expect(parsed.attachmentId).toBe("att_abc123");
  });

  it("解析失败结果帧(error)", () => {
    const parsed = AttachmentCatalogResultFrameSchema.parse({
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: false,
      error: { code: "ENTRY_NOT_FOUND", message: "no such entry" },
    });
    expect(parsed.error?.code).toBe("ENTRY_NOT_FOUND");
  });

  it("拒绝缺 id", () => {
    expect(
      AttachmentCatalogResultFrameSchema.safeParse({
        type: "piweb_attachment_catalog_result",
        ok: true,
      }).success,
    ).toBe(false);
  });
});

describe("AttachmentEventFrameSchema", () => {
  it("解析合法推送事件帧", () => {
    const parsed = AttachmentEventFrameSchema.parse({
      type: "piweb_attachment_event",
      event: "added",
      attachment: ATTACHMENT_FIXTURE,
    });
    expect(parsed.attachment.id).toBe("att_abc123");
  });

  it("拒绝畸形 attachment 描述符", () => {
    expect(
      AttachmentEventFrameSchema.safeParse({
        type: "piweb_attachment_event",
        event: "added",
        attachment: { id: "att_abc123" },
      }).success,
    ).toBe(false);
  });

  it("拒绝未知 event", () => {
    expect(
      AttachmentEventFrameSchema.safeParse({
        type: "piweb_attachment_event",
        event: "removed",
        attachment: ATTACHMENT_FIXTURE,
      }).success,
    ).toBe(false);
  });
});

describe("AttachmentControlPayloadSchema", () => {
  it("解析合法 control:attachment 载荷", () => {
    const parsed = AttachmentControlPayloadSchema.parse({
      control: "attachment",
      event: "added",
      attachment: ATTACHMENT_FIXTURE,
    });
    expect(parsed.control).toBe("attachment");
  });

  it("拒绝错误 control 判别值", () => {
    expect(
      AttachmentControlPayloadSchema.safeParse({
        control: "queue",
        event: "added",
        attachment: ATTACHMENT_FIXTURE,
      }).success,
    ).toBe(false);
  });
});
