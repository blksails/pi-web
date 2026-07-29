/**
 * attachment-tool-bridge · `afterToolCall` base64 剥离闸门 `makeAfterToolCall`
 * 单元测试(task 3.2;Req 6.1, 6.2, 6.3, 6.4, 9.1, 9.3 + 2.2 调用级回收)。
 *
 * 闸门:在工具结果回到模型对话历史前,集中守一条出口边界:
 * - 结果 `content` 含内联 `ImageContent`(裸 base64)且**未**标记需复看 →
 *   把 image 项替换为指向其公开 id 的文本引用,保留原 text 项(6.1);
 * - `details[KEEP_INLINE_FLAG] === true`(显式标记需复看)→ 原样保留 image(6.2);
 * - `content` 不含 image → 返回 `undefined` 原样透传(6.4);
 * - 无论哪条分支,末尾都触发该次调用的临时文件回收 `tracker.cleanupForCall(toolCallId)`(2.2)。
 *
 * 用一个 spy `TempFileTracker` 断言 `cleanupForCall` 被调且传对 `toolCallId`;
 * 纯函数闸门,不依赖真实 store / 文件系统。
 */
import { describe, expect, it, vi } from "vitest";
import type { TempFileTracker } from "../../src/attachment-bridge/index.js";
import {
  KEEP_INLINE_FLAG,
  makeAfterToolCall,
} from "../../src/attachment-bridge/index.js";

/** 构造一个 spy tracker:记录 cleanupForCall/cleanupForSession 的调用参数。 */
function spyTracker(): TempFileTracker & {
  cleanupForCall: ReturnType<typeof vi.fn>;
  cleanupForSession: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
} {
  return {
    track: vi.fn(),
    cleanupForCall: vi.fn(async () => {}),
    cleanupForSession: vi.fn(async () => {}),
  };
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("makeAfterToolCall — base64 剥离闸门(Req 6.1-6.4/9.1/9.3/2.2)", () => {
  it("默认含 base64 图像 → 剥离为文本引用并保留 text 部分(Req 6.1/9.3)", async () => {
    const tracker = spyTracker();
    const gate = makeAfterToolCall(tracker);

    const result = await gate({
      toolCallId: "tc-strip",
      content: [
        { type: "text", text: "edited the image" },
        { type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
      ],
      details: { outputAttachmentId: "att_out_1" },
    });

    expect(result).toBeDefined();
    const content = result?.content;
    expect(Array.isArray(content)).toBe(true);
    // text 部分保留。
    const textItems = content!.filter((c) => c.type === "text");
    expect(textItems.some((c) => c.text === "edited the image")).toBe(true);
    // image 部分被剥离:结果不含任何 image,且不含裸 base64。
    expect(content!.some((c) => c.type === "image")).toBe(false);
    const joined = JSON.stringify(content);
    expect(joined.includes(TINY_PNG_BASE64)).toBe(false);
    // 文本引用指向公开 id。
    expect(joined.includes("att_out_1")).toBe(true);
  });

  it("标记需复看(details.keepInlineImages=true)→ 保留图像不剥离(Req 6.2)", async () => {
    const tracker = spyTracker();
    const gate = makeAfterToolCall(tracker);

    const result = await gate({
      toolCallId: "tc-keep",
      content: [
        { type: "text", text: "see this" },
        { type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
      ],
      details: { [KEEP_INLINE_FLAG]: true },
    });

    // 标记复看 → 原样保留(可返回 undefined 透传或原样 content,均须仍含 image base64)。
    const content = result?.content ?? [
      { type: "text" as const, text: "see this" },
      { type: "image" as const, data: TINY_PNG_BASE64, mimeType: "image/png" },
    ];
    const image = content.find((c) => c.type === "image");
    expect(image).toBeDefined();
    expect(image && image.type === "image" && image.data).toBe(TINY_PNG_BASE64);
  });

  it("无内联图像 → 原样透传(返回 undefined,不改写)(Req 6.4)", async () => {
    const tracker = spyTracker();
    const gate = makeAfterToolCall(tracker);

    const result = await gate({
      toolCallId: "tc-passthrough",
      content: [{ type: "text", text: "no images here" }],
      details: { ok: true },
    });

    expect(result).toBeUndefined();
  });

  it("触发该次调用的临时文件回收 cleanupForCall(传对 toolCallId)(Req 2.2)", async () => {
    const tracker = spyTracker();
    const gate = makeAfterToolCall(tracker);

    await gate({
      toolCallId: "tc-recycle",
      content: [
        { type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
      ],
      details: {},
    });

    expect(tracker.cleanupForCall).toHaveBeenCalledTimes(1);
    expect(tracker.cleanupForCall).toHaveBeenCalledWith("tc-recycle");
  });

  it("无图像透传分支也触发调用级回收(Req 2.2)", async () => {
    const tracker = spyTracker();
    const gate = makeAfterToolCall(tracker);

    await gate({
      toolCallId: "tc-passthrough-recycle",
      content: [{ type: "text", text: "x" }],
      details: {},
    });

    expect(tracker.cleanupForCall).toHaveBeenCalledWith("tc-passthrough-recycle");
  });
});
