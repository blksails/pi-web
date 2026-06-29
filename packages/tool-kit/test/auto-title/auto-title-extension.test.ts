import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type {
  AgentEndEvent,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createAutoTitleHandler,
  type AutoTitleDeps,
} from "../../src/auto-title/auto-title-extension.js";
import {
  DEFAULT_AUTO_TITLE_CONFIG,
  type AutoTitleConfig,
} from "../../src/auto-title/auto-title-config.js";

/** 假模型(仅作 resolveModel 非空哨兵)。 */
const FAKE_MODEL = { id: "fake" } as unknown as Model<never>;

/** 构造一条 user 消息事件。 */
function endEvent(...userTexts: string[]): AgentEndEvent {
  return {
    type: "agent_end",
    messages: userTexts.map((t) => ({
      role: "user",
      content: t,
      timestamp: 0,
    })),
  } as AgentEndEvent;
}

/** assistant 文本应答。 */
function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "mock",
    model: "mock",
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: "end_turn",
    timestamp: 0,
  } as unknown as AssistantMessage;
}

/** 带 setTitle spy 的最小 ctx。 */
function makeCtx(): { ctx: ExtensionContext; setTitle: ReturnType<typeof vi.fn> } {
  const setTitle = vi.fn();
  const ctx = {
    ui: { setTitle },
    model: FAKE_MODEL,
    modelRegistry: { find: () => undefined },
  } as unknown as ExtensionContext;
  return { ctx, setTitle };
}

/** 组装 deps,convert 为恒等占位,complete/resolveModel 可覆盖。 */
function makeDeps(
  overrides: Partial<Omit<AutoTitleDeps, "config">> & {
    config?: Partial<AutoTitleConfig>;
  } = {},
): AutoTitleDeps {
  const { config: configOverride, ...rest } = overrides;
  return {
    config: { ...DEFAULT_AUTO_TITLE_CONFIG, ...configOverride },
    complete: vi.fn(async () => assistant("LLM Title")),
    convert: () => [] as Context["messages"],
    resolveModel: () => FAKE_MODEL,
    ...rest,
  };
}

describe("createAutoTitleHandler", () => {
  it("once:首轮成功设置标题并置位,后续 agent_end 不再设置", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => assistant("LLM Title"));
    const handler = createAutoTitleHandler(makeDeps({ complete, config: { mode: "once" } }));

    await handler(endEvent("hello"), ctx);
    await handler(endEvent("hello", "again"), ctx);

    expect(setTitle).toHaveBeenCalledTimes(1);
    expect(setTitle).toHaveBeenCalledWith("LLM Title");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("once:首轮失败(LLM 抛错且无 user 文本可兜底)不置位,补内容后下一轮成功", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => {
      throw new Error("model down");
    });
    const handler = createAutoTitleHandler(makeDeps({ complete, config: { mode: "once" } }));

    // 首轮:无 user 文本 + LLM 抛错 → 既无 LLM 标题也无启发式 → 不设置、不置位。
    await handler(endEvent(), ctx);
    expect(setTitle).not.toHaveBeenCalled();

    // 第二轮:仍 LLM 抛错,但有 user 文本 → 启发式兜底成功(Req 2.2 / 3.2)。
    await handler(endEvent("real question"), ctx);
    expect(setTitle).toHaveBeenCalledTimes(1);
    expect(setTitle).toHaveBeenCalledWith("real question");
  });

  it("refresh:每轮都重新设置标题", async () => {
    const { ctx, setTitle } = makeCtx();
    const titles = ["First", "Second"];
    let i = 0;
    const complete = vi.fn(async () => assistant(titles[i++]!));
    const handler = createAutoTitleHandler(makeDeps({ complete, config: { mode: "refresh" } }));

    await handler(endEvent("a"), ctx);
    await handler(endEvent("a", "b"), ctx);

    expect(setTitle).toHaveBeenCalledTimes(2);
    expect(setTitle).toHaveBeenNthCalledWith(1, "First");
    expect(setTitle).toHaveBeenNthCalledWith(2, "Second");
  });

  it("llm 失败 → 用启发式文本设置(首条 user 消息)", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => {
      throw new Error("timeout");
    });
    const handler = createAutoTitleHandler(makeDeps({ complete }));

    await handler(endEvent("写一个二分查找"), ctx);
    expect(setTitle).toHaveBeenCalledWith("写一个二分查找");
  });

  it("strategy=heuristic:不调用模型,直接启发式", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => assistant("should not be used"));
    const handler = createAutoTitleHandler(
      makeDeps({ complete, config: { strategy: "heuristic" } }),
    );

    await handler(endEvent("heuristic only"), ctx);
    expect(complete).not.toHaveBeenCalled();
    expect(setTitle).toHaveBeenCalledWith("heuristic only");
  });

  it("无可总结内容(空消息 + LLM 空结果)→ 跳过,不设空标题", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => assistant("   ")); // 空白 → sanitize 后空
    const handler = createAutoTitleHandler(makeDeps({ complete }));

    await handler(endEvent(), ctx);
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("无可用模型(resolveModel→undefined)且 llm 策略 → 走启发式", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => assistant("nope"));
    const handler = createAutoTitleHandler(
      makeDeps({ complete, resolveModel: () => undefined }),
    );

    await handler(endEvent("fallback title"), ctx);
    expect(complete).not.toHaveBeenCalled();
    expect(setTitle).toHaveBeenCalledWith("fallback title");
  });

  it("setTitle 抛错被吞,不向外抛(Req 7.1)", async () => {
    const setTitle = vi.fn(() => {
      throw new Error("ui boom");
    });
    const ctx = {
      ui: { setTitle },
      model: FAKE_MODEL,
      modelRegistry: { find: () => undefined },
    } as unknown as ExtensionContext;
    const handler = createAutoTitleHandler(makeDeps({}));

    await expect(handler(endEvent("x"), ctx)).resolves.toBeUndefined();
  });

  it("标题超长按 maxLen 截断", async () => {
    const { ctx, setTitle } = makeCtx();
    const complete = vi.fn(async () => assistant("a".repeat(100)));
    const handler = createAutoTitleHandler(makeDeps({ complete, config: { maxLen: 8 } }));

    await handler(endEvent("x"), ctx);
    const arg = setTitle.mock.calls[0]![0] as string;
    expect(Array.from(arg).length).toBe(8);
  });
});
