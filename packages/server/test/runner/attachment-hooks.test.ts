/**
 * 单元:attachment-hooks 的纯组合器(composeBeforeToolCall / composeAfterToolCall)。
 * 脱离真实 pi Agent 直接测 narrowing + 组合语义(block 优先 / 委托既有 / 剥离叠加 / 透传)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  composeBeforeToolCall,
  composeAfterToolCall,
  type PiBeforeToolCallContext,
  type PiAfterToolCallContext,
} from "../../src/runner/attachment-hooks.js";

const beforeCtx = (
  over: Partial<PiBeforeToolCallContext> = {},
): PiBeforeToolCallContext => ({
  toolCall: { name: "edit", id: "tc1" },
  args: { attachmentId: "att_1" },
  ...over,
});

const afterCtx = (
  over: Partial<PiAfterToolCallContext> = {},
): PiAfterToolCallContext => ({
  toolCall: { name: "edit", id: "tc1" },
  args: {},
  result: { content: [{ type: "text", text: "hi" }] },
  isError: false,
  ...over,
});

describe("composeBeforeToolCall", () => {
  it("闸门 block → 直接返回 block(不调既有 hook)", async () => {
    const prior = vi.fn(async () => undefined);
    const guard = vi.fn(async () => ({ block: true, reason: "越权" }));
    const hook = composeBeforeToolCall(guard, prior);
    const out = await hook(beforeCtx());
    expect(out).toEqual({ block: true, reason: "越权" });
    expect(prior).not.toHaveBeenCalled();
    // narrowing:闸门收到同形 guardEvent(toolName/toolCallId/input)。
    expect(guard).toHaveBeenCalledWith({
      toolName: "edit",
      toolCallId: "tc1",
      input: { attachmentId: "att_1" },
    });
  });

  it("闸门放行 → 委托既有 hook 结果", async () => {
    const prior = vi.fn(async () => ({ block: false }));
    const guard = vi.fn(async () => undefined);
    const hook = composeBeforeToolCall(guard, prior);
    const ctx = beforeCtx();
    const out = await hook(ctx);
    expect(prior).toHaveBeenCalledWith(ctx, undefined);
    expect(out).toEqual({ block: false });
  });

  it("无既有 hook + 放行 → undefined;args 非对象退化空对象", async () => {
    const guard = vi.fn(async () => undefined);
    const hook = composeBeforeToolCall(guard, undefined);
    const out = await hook(beforeCtx({ args: 42 }));
    expect(out).toBeUndefined();
    expect(guard).toHaveBeenCalledWith({ toolName: "edit", toolCallId: "tc1", input: {} });
  });
});

describe("composeAfterToolCall", () => {
  it("闸门剥离 → 整段替换 content,保留既有 hook 的 details/isError", async () => {
    const prior = vi.fn(async () => ({ details: { d: 1 }, isError: true }));
    const gate = vi.fn(async () => ({ content: [{ type: "text" as const, text: "[image ref]" }] }));
    const hook = composeAfterToolCall(gate, prior);
    const out = await hook(afterCtx());
    expect(out).toEqual({
      details: { d: 1 },
      isError: true,
      content: [{ type: "text", text: "[image ref]" }],
    });
  });

  it("闸门无改写 → 透传既有 hook 结果(可能 undefined)", async () => {
    const gate = vi.fn(async () => undefined);
    expect(await composeAfterToolCall(gate, undefined)(afterCtx())).toBeUndefined();
    const prior = vi.fn(async () => ({ details: { keep: true } }));
    expect(await composeAfterToolCall(gate, prior)(afterCtx())).toEqual({ details: { keep: true } });
  });

  it("既有 hook 改写 content → 以其为剥离输入(effectiveContent 取 prior.content)", async () => {
    const priorContent = [{ type: "text" as const, text: "rewritten" }];
    const prior = vi.fn(async () => ({ content: priorContent }));
    const gate = vi.fn(async () => undefined);
    await composeAfterToolCall(gate, prior)(afterCtx());
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "tc1", content: priorContent }),
    );
  });
});
