/**
 * 表驱动:每种 AgentEvent 子类型 → 期望 protocol 帧(Req 4.x, 10.1, 10.3)。
 * 断言:产出帧种类/关键字段 + 每帧通过 SseFrameSchema 且携带 protocolVersion。
 */
import { describe, expect, it } from "vitest";
import {
  type AgentEvent,
  type AssistantMessage,
  PI_UI_TOOL_DETAILS_KEY,
  protocolVersion,
  SseFrameSchema,
} from "@blksails/pi-web-protocol";
import { translateEvent } from "../../src/session/translate/translate-event.js";
import {
  createTranslationContext,
  type TranslationContext,
} from "../../src/session/translate/translation-context.js";

const PARTIAL: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "anthropic",
  provider: "anthropic",
  model: "m",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
};

function messageUpdate(
  ame: Extract<AgentEvent, { type: "message_update" }>["assistantMessageEvent"],
): AgentEvent {
  return {
    type: "message_update",
    message: PARTIAL,
    assistantMessageEvent: ame,
  };
}

/** 校验每帧通过 protocol schema 且带 protocolVersion。 */
function expectValidFrames(
  frames: readonly unknown[],
): void {
  for (const f of frames) {
    const parsed = SseFrameSchema.parse(f);
    expect(parsed.protocolVersion).toBe(protocolVersion);
  }
}

type Chunk = Extract<
  import("@blksails/pi-web-protocol").SseFrame,
  { kind: "uiMessageChunk" }
>["chunk"];

/** 取第 i 个帧的 uiMessageChunk(断言其为 uiMessageChunk 帧)。 */
function chunkAt(
  frames: readonly import("@blksails/pi-web-protocol").SseFrame[],
  i = 0,
): Chunk {
  const f = frames[i];
  expect(f).toBeDefined();
  if (f === undefined || f.kind !== "uiMessageChunk") {
    throw new Error(`frame ${i} is not a uiMessageChunk`);
  }
  return f.chunk;
}

function chunkTypes(
  frames: readonly import("@blksails/pi-web-protocol").SseFrame[],
): string[] {
  return frames.map((f) => (f.kind === "uiMessageChunk" ? f.chunk.type : `control:${f.payload.control}`));
}

describe("translateEvent — schema-valid frames per event", () => {
  it("agent_start → start chunk, opens message", () => {
    const r = translateEvent({ type: "agent_start" }, createTranslationContext());
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["start"]);
    expect(r.ctx.messageOpen).toBe(true);
  });

  it("turn_start → start-step", () => {
    const r = translateEvent({ type: "turn_start" }, createTranslationContext());
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["start-step"]);
  });

  it("text_start → text-start with allocated partId", () => {
    const r = translateEvent(
      messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }),
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(r.frames).toHaveLength(1);
    expect(chunkAt(r.frames)).toMatchObject({ type: "text-start" });
    expect(r.ctx.openTextPartId).toBeDefined();
  });

  it("text_delta → text-delta (auto-opens text part if none)", () => {
    const r = translateEvent(
      messageUpdate({
        type: "text_delta",
        contentIndex: 0,
        delta: "hi",
        partial: PARTIAL,
      }),
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    // auto text-start then text-delta
    expect(chunkTypes(r.frames)).toEqual(["text-start", "text-delta"]);
    const delta = chunkAt(r.frames, 1);
    expect(delta).toMatchObject({ type: "text-delta", delta: "hi" });
  });

  it("text_delta after text_start → only text-delta (no re-open)", () => {
    let ctx: TranslationContext = createTranslationContext();
    ctx = translateEvent(
      messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }),
      ctx,
    ).ctx;
    const r = translateEvent(
      messageUpdate({
        type: "text_delta",
        contentIndex: 0,
        delta: "x",
        partial: PARTIAL,
      }),
      ctx,
    );
    expect(r.frames).toHaveLength(1);
    expect(chunkAt(r.frames).type).toBe("text-delta");
  });

  it("text_end → text-end and closes part", () => {
    let ctx = createTranslationContext();
    const started = translateEvent(
      messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }),
      ctx,
    );
    ctx = started.ctx;
    const r = translateEvent(
      messageUpdate({
        type: "text_end",
        contentIndex: 0,
        content: "hi",
        partial: PARTIAL,
      }),
      ctx,
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames).type).toBe("text-end");
    expect(r.ctx.openTextPartId).toBeUndefined();
  });

  it("thinking_start|delta|end → reasoning-*", () => {
    let ctx = createTranslationContext();
    const s = translateEvent(
      messageUpdate({ type: "thinking_start", contentIndex: 0, partial: PARTIAL }),
      ctx,
    );
    ctx = s.ctx;
    expect(chunkAt(s.frames).type).toBe("reasoning-start");
    const d = translateEvent(
      messageUpdate({
        type: "thinking_delta",
        contentIndex: 0,
        delta: "t",
        partial: PARTIAL,
      }),
      ctx,
    );
    ctx = d.ctx;
    expect(chunkAt(d.frames).type).toBe("reasoning-delta");
    const e = translateEvent(
      messageUpdate({
        type: "thinking_end",
        contentIndex: 0,
        content: "t",
        partial: PARTIAL,
      }),
      ctx,
    );
    expect(chunkAt(e.frames).type).toBe("reasoning-end");
    expectValidFrames([...s.frames, ...d.frames, ...e.frames]);
  });

  it("tool_execution_start → tool-input-available with toolCallId/toolName/args", () => {
    const r = translateEvent(
      {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "bash",
        args: { command: "ls" },
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "tool-input-available",
      toolCallId: "t1",
      toolName: "bash",
      input: { command: "ls" },
    });
  });

  it("tool_execution_update → tool-output-available preliminary (累积 partialResult 喂同卡)", () => {
    const r = translateEvent(
      {
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "bash",
        args: {},
        partialResult: { lines: 3 },
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "tool-output-available",
      toolCallId: "t1",
      output: { lines: 3 },
      preliminary: true,
    });
  });

  it("tool_execution_update(details 携 UiSpec)→ data-pi-ui(server-driven UI 产帧通道)", () => {
    const spec = {
      kind: "builtin",
      component: "metric",
      props: { label: "活跃", value: "1,284" },
    };
    const r = translateEvent(
      {
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "show_dashboard",
        args: {},
        partialResult: { content: [], details: { [PI_UI_TOOL_DETAILS_KEY]: spec } },
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames)).toMatchObject({ type: "data-pi-ui", data: spec });
  });

  it("tool_execution_update(details 非法 UiSpec)→ 回退 tool-output-available preliminary", () => {
    const partial = { content: [], details: { [PI_UI_TOOL_DETAILS_KEY]: { component: "metric" } } };
    const r = translateEvent(
      {
        type: "tool_execution_update",
        toolCallId: "t1",
        toolName: "show_dashboard",
        args: {},
        // kind 缺失 → UiSpecSchema 校验失败 → 不应误判为 data-pi-ui。
        partialResult: partial,
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "tool-output-available",
      toolCallId: "t1",
      output: partial,
      preliminary: true,
    });
  });

  it("tool_execution_end → tool-output-available with result/isError", () => {
    const r = translateEvent(
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "bash",
        result: "done",
        isError: false,
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "tool-output-available",
      toolCallId: "t1",
      output: "done",
      isError: false,
    });
  });

  it("queue_update → data-pi-queue", () => {
    const r = translateEvent(
      { type: "queue_update", steering: ["a"], followUp: ["b"] },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "data-pi-queue",
      data: { steering: ["a"], followUp: ["b"] },
    });
  });

  it("compaction_start/end → data-pi-compaction", () => {
    const s = translateEvent(
      { type: "compaction_start", reason: "threshold" },
      createTranslationContext(),
    );
    expectValidFrames(s.frames);
    expect(chunkAt(s.frames)).toMatchObject(
      { type: "data-pi-compaction", data: { phase: "start", reason: "threshold" } },
    );
    const e = translateEvent(
      {
        type: "compaction_end",
        reason: "threshold",
        aborted: false,
        willRetry: false,
        result: {
          summary: "sum",
          firstKeptEntryId: "x",
          tokensBefore: 10,
        },
      },
      createTranslationContext(),
    );
    expectValidFrames(e.frames);
    expect(chunkAt(e.frames)).toMatchObject(
      { type: "data-pi-compaction", data: { phase: "end", summary: "sum" } },
    );
  });

  it("auto_retry_start/end → data-pi-auto-retry", () => {
    const s = translateEvent(
      {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 100,
        errorMessage: "boom",
      },
      createTranslationContext(),
    );
    expectValidFrames(s.frames);
    expect(chunkAt(s.frames)).toMatchObject(
      { type: "data-pi-auto-retry", data: { phase: "start", attempt: 1 } },
    );
    const e = translateEvent(
      { type: "auto_retry_end", success: true, attempt: 1 },
      createTranslationContext(),
    );
    expectValidFrames(e.frames);
    expect(chunkAt(e.frames)).toMatchObject(
      { type: "data-pi-auto-retry", data: { phase: "end", success: true } },
    );
  });

  it("extension_ui_request → control:extension-ui bypass frame", () => {
    const r = translateEvent(
      {
        type: "extension_ui_request",
        id: "u1",
        method: "confirm",
        title: "OK?",
        message: "proceed?",
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["control:extension-ui"]);
  });

  // spec ctx-ui-custom-bridge:ctx.ui.custom 经 runner 覆盖发帧 → 转译为 data-pi-custom-ui data part。
  it("extension_ui_request{method:custom} → data-pi-custom-ui chunk (not control bypass)", () => {
    const r = translateEvent(
      {
        type: "extension_ui_request",
        id: "u2",
        method: "custom",
        payload: { component: "demo-metric-card", props: { label: "x", value: 1 } },
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["data-pi-custom-ui"]);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "data-pi-custom-ui",
      data: { component: "demo-metric-card", props: { label: "x", value: 1 } },
    });
  });

  it("extension_ui_request{method:custom} with empty component → deterministic empty frames", () => {
    const r = translateEvent(
      {
        type: "extension_ui_request",
        id: "u3",
        method: "custom",
        payload: { component: "" },
      },
      createTranslationContext(),
    );
    expect(r.frames).toEqual([]);
  });

  it("turn_end → finish-step, agent_end → finish, close hanging parts", () => {
    // open a text part then turn_end should close it deterministically.
    let ctx = createTranslationContext();
    ctx = translateEvent(
      messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }),
      ctx,
    ).ctx;
    const te = translateEvent(
      { type: "turn_end", message: PARTIAL, toolResults: [] },
      ctx,
    );
    expectValidFrames(te.frames);
    expect(chunkTypes(te.frames)).toEqual(["finish-step"]);
    expect(te.ctx.openTextPartId).toBeUndefined();

    const ae = translateEvent(
      { type: "agent_end", messages: [], willRetry: false },
      createTranslationContext(),
    );
    expectValidFrames(ae.frames);
    expect(chunkTypes(ae.frames)).toEqual(["finish"]);
  });

  it("agent_end {willRetry:false, error w/ errorMessage} → error chunk w/ real errorText", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: false,
        messages: [
          { ...PARTIAL, stopReason: "error", errorMessage: "Connection error." },
        ],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["error"]);
    const c = chunkAt(r.frames);
    if (c.type !== "error") throw new Error("expected error chunk");
    expect(c.errorText).toBe("Connection error.");
  });

  it("agent_end {willRetry:false, aborted} → abort chunk", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: false,
        messages: [{ ...PARTIAL, stopReason: "aborted" }],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["abort"]);
  });

  it("agent_end {willRetry:true, error} → finish (no error chunk)", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: true,
        messages: [
          { ...PARTIAL, stopReason: "error", errorMessage: "Connection error." },
        ],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["finish"]);
  });

  it("message_update.error (reason=error) → error chunk with real errorText (not hardcoded)", () => {
    const r = translateEvent(
      messageUpdate({
        type: "error",
        reason: "error",
        error: { ...PARTIAL, stopReason: "error", errorMessage: "X" },
      }),
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["error"]);
    const c = chunkAt(r.frames);
    if (c.type !== "error") throw new Error("expected error chunk");
    expect(c.errorText).toBe("X");
  });

  it("message_update.error (reason=error) without errorMessage → fallback errorText", () => {
    const r = translateEvent(
      messageUpdate({ type: "error", reason: "error", error: PARTIAL }),
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["error"]);
    const c = chunkAt(r.frames);
    if (c.type !== "error") throw new Error("expected error chunk");
    expect(typeof c.errorText).toBe("string");
    expect(c.errorText.length).toBeGreaterThan(0);
  });

  it("message_update.error (reason=aborted) → abort chunk", () => {
    const r = translateEvent(
      messageUpdate({ type: "error", reason: "aborted", error: PARTIAL }),
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["abort"]);
  });

  it("full stream is start → start-step → text-start → text-delta → text-end → finish-step → finish", () => {
    let ctx = createTranslationContext();
    const all: import("@blksails/pi-web-protocol").SseFrame[] = [];
    const push = (e: AgentEvent): void => {
      const r = translateEvent(e, ctx);
      ctx = r.ctx;
      all.push(...r.frames);
    };
    push({ type: "agent_start" });
    push({ type: "turn_start" });
    push(
      messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }),
    );
    push(
      messageUpdate({
        type: "text_delta",
        contentIndex: 0,
        delta: "hi",
        partial: PARTIAL,
      }),
    );
    push(
      messageUpdate({
        type: "text_end",
        contentIndex: 0,
        content: "hi",
        partial: PARTIAL,
      }),
    );
    push({ type: "turn_end", message: PARTIAL, toolResults: [] });
    push({ type: "agent_end", messages: [], willRetry: false });
    expectValidFrames(all);
    expect(chunkTypes(all)).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
  });

  // 回退常量:须与源码 translate-event.ts 的 FALLBACK_ERROR_TEXT 字面量保持一致。
  // 源码未导出该常量,故此处以相同字面量断言;若源码改文案,本断言应随之同步。
  const FALLBACK_ERROR_TEXT = "对话失败,但运行时未提供具体错误信息。";

  it("agent_end {willRetry:false, error w/o errorMessage} → error chunk w/ fallback errorText (Req 2.2)", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: false,
        // stopReason:"error" 但无 errorMessage → 应回退到常量文案。
        messages: [{ ...PARTIAL, stopReason: "error" }],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["error"]);
    const c = chunkAt(r.frames);
    if (c.type !== "error") throw new Error("expected error chunk");
    expect(c.errorText).toBe(FALLBACK_ERROR_TEXT);
  });

  it("agent_end {willRetry:false, assistant stopReason:'stop'} → finish, no error chunk (Req 5.1)", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: false,
        messages: [{ ...PARTIAL, stopReason: "stop" }],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["finish"]);
    // 不得混入 error/abort 帧。
    expect(chunkTypes(r.frames)).not.toContain("error");
    expect(chunkTypes(r.frames)).not.toContain("abort");
  });

  it("agent_end last item is toolResult, prior assistant stopReason:'stop' → finish (Req 5.1, scan back to nearest assistant)", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: false,
        // 末项是 toolResult(非 assistant);更前的 assistant 为正常 stop → finish。
        messages: [
          { ...PARTIAL, stopReason: "stop" },
          // toolResult 末项:role 非 "assistant",应被向前查找逻辑跳过。
          { role: "toolResult", content: [], timestamp: 0 } as never,
        ],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["finish"]);
  });

  it("agent_end last item is toolResult, prior assistant stopReason:'error' → error (Req 5.1, skip non-assistant tail, hit error)", () => {
    const r = translateEvent(
      {
        type: "agent_end",
        willRetry: false,
        messages: [
          { ...PARTIAL, stopReason: "error", errorMessage: "Upstream failed." },
          // 跳过末项 toolResult,向前命中 assistant(error)。
          { role: "toolResult", content: [], timestamp: 0 } as never,
        ],
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["error"]);
    const c = chunkAt(r.frames);
    if (c.type !== "error") throw new Error("expected error chunk");
    expect(c.errorText).toBe("Upstream failed.");
  });

  it("mid-stream open text part then agent_end error → error chunk and no half-open part remains (Req 1.4)", () => {
    let ctx: TranslationContext = createTranslationContext();
    const all: import("@blksails/pi-web-protocol").SseFrame[] = [];
    const push = (e: AgentEvent): void => {
      const r = translateEvent(e, ctx);
      ctx = r.ctx;
      all.push(...r.frames);
    };
    // 开启一个 text part(start + delta),使其处于"半开"状态。
    push(messageUpdate({ type: "text_start", contentIndex: 0, partial: PARTIAL }));
    push(
      messageUpdate({
        type: "text_delta",
        contentIndex: 0,
        delta: "partial...",
        partial: PARTIAL,
      }),
    );
    expect(ctx.openTextPartId).toBeDefined(); // 前置:确有半开 part。
    // 中途终态错误收尾。
    push({
      type: "agent_end",
      willRetry: false,
      messages: [{ ...PARTIAL, stopReason: "error", errorMessage: "boom" }],
    });
    expectValidFrames(all);
    const types = chunkTypes(all);
    // 序列以 error 帧收束(Req 1.4:仍产出用户可见错误信号)。
    expect(types[types.length - 1]).toBe("error");
    expect(types).toEqual(["text-start", "text-delta", "error"]);
    const last = chunkAt(all, all.length - 1);
    if (last.type !== "error") throw new Error("expected trailing error chunk");
    expect(last.errorText).toBe("boom");
    // 关键:收尾后不残留半开 text part(Req 1.4 "不残留半开状态")。
    expect(ctx.openTextPartId).toBeUndefined();
  });

  it("auto_retry_start → data-pi-auto-retry (phase:start) feedback regression (Req 3.1)", () => {
    const r = translateEvent(
      {
        type: "auto_retry_start",
        attempt: 2,
        maxAttempts: 3,
        delayMs: 250,
        errorMessage: "transient",
      },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["data-pi-auto-retry"]);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "data-pi-auto-retry",
      data: { phase: "start", attempt: 2 },
    });
    // 重试反馈不得被误报为终态错误。
    expect(chunkTypes(r.frames)).not.toContain("error");
  });

  it("auto_retry_end → data-pi-auto-retry (phase:end) feedback regression (Req 3.1)", () => {
    const r = translateEvent(
      { type: "auto_retry_end", success: true, attempt: 2 },
      createTranslationContext(),
    );
    expectValidFrames(r.frames);
    expect(chunkTypes(r.frames)).toEqual(["data-pi-auto-retry"]);
    expect(chunkAt(r.frames)).toMatchObject({
      type: "data-pi-auto-retry",
      data: { phase: "end", success: true },
    });
    expect(chunkTypes(r.frames)).not.toContain("error");
  });

  it("unknown / non-translatable event → deterministic empty frames, no throw", () => {
    const r = translateEvent(
      { type: "message_start", message: PARTIAL },
      createTranslationContext(),
    );
    expect(r.frames).toEqual([]);
    // cast an unknown type through to assert no throw on the default branch.
    const weird = { type: "totally_unknown" } as unknown as AgentEvent;
    expect(() => translateEvent(weird, createTranslationContext())).not.toThrow();
    expect(translateEvent(weird, createTranslationContext()).frames).toEqual([]);
  });
});
