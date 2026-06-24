/**
 * attachment-tool-bridge · prompt 文本引用注入 `buildAttachmentRefs` /
 * `injectAttachmentRefs` 单元测试(task 3.4;Req 8.1, 8.2, 8.3, 8.4, 9.1)。
 *
 * 断言(design.md §reference-injection / Testing Strategy/Unit 4):
 * - 多附件 → 每个附件一行稳定结构化标记 `[attachment id=att_… type=<mime> name=<name>]`,
 *   含每个 id/类型/文件名,顺序与入参一致(Req 8.1/8.2);
 * - 无附件 → 返回空串(不注入,Req 8.3);
 * - 仅文本:输出不含 `base64` / `data:` 子串(Req 8.4/9.1),不内联附件字节;
 * - `injectAttachmentRefs`:把标记拼到 user message 文本(标记 + 原文本)。
 *
 * 纯字符串构造:不落库、不查 store。
 */
import { describe, expect, it } from "vitest";
import type { Attachment } from "@blksails/pi-web-protocol";
import {
  buildAttachmentRefs,
  injectAttachmentRefs,
} from "../../src/attachment-bridge/index.js";

const att = (over: Partial<Attachment>): Attachment => ({
  id: "att_aaaaaaaaaaaa",
  name: "photo.png",
  mimeType: "image/png",
  size: 123,
  origin: "upload",
  sessionId: "sess-1",
  createdAt: "2026-06-21T00:00:00.000Z",
  ...over,
});

describe("buildAttachmentRefs — 多附件产稳定标记含 id/type/name(Req 8.1/8.2)", () => {
  it("每个附件一行稳定结构化标记,含其 id/type/name,顺序与入参一致", () => {
    const atts: Attachment[] = [
      att({ id: "att_in0001", mimeType: "image/png", name: "first.png" }),
      att({ id: "att_in0002", mimeType: "image/jpeg", name: "second.jpg" }),
      att({ id: "att_in0003", mimeType: "application/pdf", name: "doc.pdf" }),
    ];

    const refs = buildAttachmentRefs(atts);
    const lines = refs.split("\n");
    expect(lines).toEqual([
      "[attachment id=att_in0001 type=image/png name=first.png]",
      "[attachment id=att_in0002 type=image/jpeg name=second.jpg]",
      "[attachment id=att_in0003 type=application/pdf name=doc.pdf]",
    ]);

    // 每个 id/type/name 都出现在输出中。
    for (const a of atts) {
      expect(refs).toContain(`id=${a.id}`);
      expect(refs).toContain(`type=${a.mimeType}`);
      expect(refs).toContain(`name=${a.name}`);
    }
  });

  it("标记稳定:同一入参多次调用产出完全一致字符串", () => {
    const atts = [att({ id: "att_x1" }), att({ id: "att_x2" })];
    expect(buildAttachmentRefs(atts)).toBe(buildAttachmentRefs(atts));
  });
});

describe("buildAttachmentRefs — 无附件返回空串(Req 8.3)", () => {
  it("空数组 → 空串(不注入)", () => {
    expect(buildAttachmentRefs([])).toBe("");
  });
});

describe("buildAttachmentRefs — 仅文本,不内联字节(Req 8.4/9.1)", () => {
  it("输出不含 base64 / data: 子串", () => {
    const refs = buildAttachmentRefs([
      att({ id: "att_in0001", mimeType: "image/png", name: "x.png" }),
      att({ id: "att_in0002", mimeType: "image/jpeg", name: "y.jpg" }),
    ]);
    expect(refs.toLowerCase()).not.toContain("base64");
    expect(refs).not.toContain("data:");
  });
});

describe("injectAttachmentRefs — 拼到 user message 文本(Req 8.1)", () => {
  it("有附件:标记块 + 原文本(标记在前)", () => {
    const atts = [att({ id: "att_in0001", mimeType: "image/png", name: "x.png" })];
    const out = injectAttachmentRefs("帮我放大这张图", atts);
    const block = buildAttachmentRefs(atts);
    expect(out).toContain(block);
    expect(out).toContain("帮我放大这张图");
    // 标记在原文本之前。
    expect(out.indexOf(block)).toBeLessThan(out.indexOf("帮我放大这张图"));
  });

  it("无附件:原样返回原文本(不注入)", () => {
    expect(injectAttachmentRefs("hello", [])).toBe("hello");
  });

  it("注入路径仅文本:输出不含 base64 / data:", () => {
    const out = injectAttachmentRefs("text", [
      att({ id: "att_in0001", mimeType: "image/png", name: "x.png" }),
    ]);
    expect(out.toLowerCase()).not.toContain("base64");
    expect(out).not.toContain("data:");
  });
});
