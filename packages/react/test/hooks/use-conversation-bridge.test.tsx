/**
 * 单元:useConversationBridge(surface-runtime-facade, Task 2.2 —— 对话桥应用面唯一门面)。
 *  - opChannel 三态探测:{conversation}→prompt / {surface+domain,hasCommand}→command / {}→unavailable
 *  - conversation 优先、别名 onSubmitPrompt 兜底(6.2)
 *  - submitOp 三分道:prompt(renderSurfaceOp 文本)/ command(fallback→surface.run 透传)/ unavailable
 *  - bringToConversation 严格门槛:alias-only→unavailable;conversation 在场→attachmentIds 透传
 *  - onTurnEnd:初值不触发 / 变化触发 / 退订后不触发 / Set 去重 / 无信号永不触发,全程不抛(1.4)
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type {
  ConversationAccess,
  WebExtSurfaceAccess,
  SurfaceOp,
} from "@blksails/pi-web-kit";
import type { SurfaceCommandResult } from "@blksails/pi-web-protocol";
import {
  useConversationBridge,
  DEFAULT_BRING_TEXT,
  type UseConversationBridgeOptions,
} from "../../src/hooks/use-conversation-bridge.js";

/** 造一个可断言的 ConversationAccess mock。 */
function makeConversation() {
  const submitUserMessage =
    vi.fn<ConversationAccess["submitUserMessage"]>();
  const conversation: ConversationAccess = { submitUserMessage };
  return { conversation, submitUserMessage };
}

/** 造一个可断言的 WebExtSurfaceAccess mock(hasCommand / run 结果可配)。 */
function makeSurface(opts: {
  hasCommand: boolean;
  result?: SurfaceCommandResult;
}) {
  const run =
    vi.fn<WebExtSurfaceAccess["run"]>(async () =>
      opts.result ?? { domain: "canvas", action: "noop", ok: true },
    );
  const hasCommand = vi.fn<WebExtSurfaceAccess["hasCommand"]>(
    () => opts.hasCommand,
  );
  const surface: WebExtSurfaceAccess = {
    run,
    getState: () => undefined,
    subscribe: () => () => undefined,
    hasCommand,
  };
  return { surface, run, hasCommand };
}

/** 一个含 title/tool/多参的 SurfaceOp 样例(prompt 渲染断言用)。 */
const SAMPLE_OP: SurfaceOp = {
  title: "🎨 生成图像",
  tool: "image_generation",
  params: [
    ["prompt", "一只猫"],
    ["size", "1024x1024"],
    ["empty", ""],
  ],
  fallback: { action: "generate", args: { prompt: "一只猫" } },
};

describe("useConversationBridge — opChannel 三态(2.1–2.3)", () => {
  it("{conversation} → prompt", () => {
    const { conversation } = makeConversation();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation }),
    );
    expect(result.current.opChannel).toBe("prompt");
  });

  it("{surface+domain, 探针 hasCommand(surface:canvas)=true} → command", () => {
    const { surface, hasCommand } = makeSurface({ hasCommand: true });
    const { result } = renderHook(() =>
      useConversationBridge({ surface, domain: "canvas" }),
    );
    expect(result.current.opChannel).toBe("command");
    // 探针以 surfaceStateKey(domain) 形态查询
    expect(hasCommand).toHaveBeenCalledWith("surface:canvas");
  });

  it("{surface+domain, hasCommand=false} → unavailable", () => {
    const { surface } = makeSurface({ hasCommand: false });
    const { result } = renderHook(() =>
      useConversationBridge({ surface, domain: "canvas" }),
    );
    expect(result.current.opChannel).toBe("unavailable");
  });

  it("{}(全缺注入)→ unavailable", () => {
    const { result } = renderHook(() => useConversationBridge({}));
    expect(result.current.opChannel).toBe("unavailable");
  });
});

describe("useConversationBridge — conversation 优先 / 别名兜底(6.2)", () => {
  it("conversation 与 onSubmitPrompt 并存 → opChannel prompt 且 submitOp 走 conversation", async () => {
    const { conversation, submitUserMessage } = makeConversation();
    const onSubmitPrompt = vi.fn<(text: string) => void>();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation, onSubmitPrompt }),
    );
    expect(result.current.opChannel).toBe("prompt");

    let res: Awaited<ReturnType<typeof result.current.submitOp>> | undefined;
    await act(async () => {
      res = await result.current.submitOp(SAMPLE_OP);
    });
    expect(res).toEqual({ ok: true, channel: "prompt" });
    // conversation 优先:别名一次都不调
    expect(submitUserMessage).toHaveBeenCalledTimes(1);
    expect(onSubmitPrompt).not.toHaveBeenCalled();
  });

  it("仅别名 onSubmitPrompt → prompt 态且 submitOp 走别名口", async () => {
    const onSubmitPrompt = vi.fn<(text: string) => void>();
    const { result } = renderHook(() =>
      useConversationBridge({ onSubmitPrompt }),
    );
    expect(result.current.opChannel).toBe("prompt");
    await act(async () => {
      await result.current.submitOp(SAMPLE_OP);
    });
    expect(onSubmitPrompt).toHaveBeenCalledTimes(1);
  });
});

describe("useConversationBridge — submitOp prompt 态渲染语义(3.4 / 2.4)", () => {
  it("提交文本含 title 行 + fence + `tool: ` 行 + 参数行(空值参数省略)", async () => {
    const { conversation, submitUserMessage } = makeConversation();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation }),
    );
    await act(async () => {
      await result.current.submitOp(SAMPLE_OP);
    });
    const [text, opts] = submitUserMessage.mock.calls[0]!;
    // 标题行、默认 fence、工具行、参数行俱在链路上生效(renderSurfaceOp 语义)
    expect(text).toContain("🎨 生成图像");
    expect(text).toContain("```surface-op");
    expect(text).toContain("tool: image_generation");
    expect(text).toContain("prompt: 一只猫");
    expect(text).toContain("size: 1024x1024");
    // 空值参数行省略(3.2)
    expect(text).not.toContain("empty:");
    // 纯文本提交,不携带 attachmentIds
    expect(opts).toBeUndefined();
  });
});

describe("useConversationBridge — submitOp command 态降级(2.5 / 2.6)", () => {
  it("有 fallback → surface.run(domain, action, args) 被调且结果透传", async () => {
    const commandResult: SurfaceCommandResult = {
      domain: "canvas",
      action: "generate",
      ok: true,
      data: { jobId: "j1" },
    };
    const { surface, run } = makeSurface({
      hasCommand: true,
      result: commandResult,
    });
    const { result } = renderHook(() =>
      useConversationBridge({ surface, domain: "canvas" }),
    );
    let res: Awaited<ReturnType<typeof result.current.submitOp>> | undefined;
    await act(async () => {
      res = await result.current.submitOp(SAMPLE_OP);
    });
    expect(run).toHaveBeenCalledWith("canvas", "generate", {
      prompt: "一只猫",
    });
    expect(res).toEqual({
      ok: true,
      channel: "command",
      result: commandResult,
    });
  });

  it("无 fallback → {ok:false, code:'no_fallback'},且不调 run", async () => {
    const { surface, run } = makeSurface({ hasCommand: true });
    const { result } = renderHook(() =>
      useConversationBridge({ surface, domain: "canvas" }),
    );
    const opNoFallback: SurfaceOp = {
      title: "t",
      tool: "x",
      params: [],
    };
    let res: Awaited<ReturnType<typeof result.current.submitOp>> | undefined;
    await act(async () => {
      res = await result.current.submitOp(opNoFallback);
    });
    expect(res).toMatchObject({ ok: false, error: { code: "no_fallback" } });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("useConversationBridge — submitOp unavailable 态(2.7 / 1.4)", () => {
  it("无任何通道 → {ok:false, code:'unavailable'} 且不抛异常", async () => {
    const { result } = renderHook(() => useConversationBridge({}));
    let res: Awaited<ReturnType<typeof result.current.submitOp>> | undefined;
    await act(async () => {
      // 不抛:直接 await,异常会让 act 拒绝
      res = await result.current.submitOp(SAMPLE_OP);
    });
    expect(res).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});

describe("useConversationBridge — bringToConversation 严格门槛(4.1 / 4.3)", () => {
  it("alias-only(onSubmitPrompt 在、conversation 缺,含非空 refs)→ ok:false/unavailable", () => {
    const onSubmitPrompt = vi.fn<(text: string) => void>();
    const { result } = renderHook(() =>
      useConversationBridge({ onSubmitPrompt }),
    );
    const res = result.current.bringToConversation(["att_1", "att_2"]);
    expect(res).toMatchObject({ ok: false, error: { code: "unavailable" } });
    // refs 不能静默经别名丢弃
    expect(onSubmitPrompt).not.toHaveBeenCalled();
  });

  it("conversation 在场 → submitUserMessage(text, {attachmentIds: refs}) 透传", () => {
    const { conversation, submitUserMessage } = makeConversation();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation }),
    );
    const refs = ["att_1", "att_2"];
    const res = result.current.bringToConversation(refs, "看这些");
    expect(res).toEqual({ ok: true, channel: "prompt" });
    expect(submitUserMessage).toHaveBeenCalledWith("看这些", {
      attachmentIds: refs,
    });
  });
});

describe("useConversationBridge — DEFAULT_BRING_TEXT 默认文本(4.2)", () => {
  it("无 summary → 文本 = 基串 + 数量", () => {
    const { conversation, submitUserMessage } = makeConversation();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation }),
    );
    result.current.bringToConversation(["a", "b", "c"]);
    expect(submitUserMessage).toHaveBeenCalledWith(
      `${DEFAULT_BRING_TEXT}(共 3 项制品)`,
      { attachmentIds: ["a", "b", "c"] },
    );
  });

  it("空串 summary 视同未提供 → 用默认文本", () => {
    const { conversation, submitUserMessage } = makeConversation();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation }),
    );
    result.current.bringToConversation(["a"], "");
    expect(submitUserMessage).toHaveBeenCalledWith(
      `${DEFAULT_BRING_TEXT}(共 1 项制品)`,
      { attachmentIds: ["a"] },
    );
  });

  it("有 summary → 文本 = summary", () => {
    const { conversation, submitUserMessage } = makeConversation();
    const { result } = renderHook(() =>
      useConversationBridge({ conversation }),
    );
    result.current.bringToConversation(["a"], "自定义摘要");
    expect(submitUserMessage).toHaveBeenCalledWith("自定义摘要", {
      attachmentIds: ["a"],
    });
  });
});

describe("useConversationBridge — onTurnEnd 轮末订阅(5.1–5.3)", () => {
  it("初值(首渲染)不触发;syncSignal 变化触发", () => {
    const cb = vi.fn();
    const { result, rerender } = renderHook(
      (props: UseConversationBridgeOptions) => useConversationBridge(props),
      { initialProps: { syncSignal: 0 } as UseConversationBridgeOptions },
    );
    act(() => {
      result.current.onTurnEnd(cb);
    });
    // 首渲染 effect 已跑(记录初值),未触发
    expect(cb).not.toHaveBeenCalled();
    // 同值 rerender:Object.is 守卫 + dep 未变,不触发
    rerender({ syncSignal: 0 });
    expect(cb).not.toHaveBeenCalled();
    // 值变化:触发一次
    rerender({ syncSignal: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("退订后不再触发", () => {
    const cb = vi.fn();
    let off: (() => void) | undefined;
    const { result, rerender } = renderHook(
      (props: UseConversationBridgeOptions) => useConversationBridge(props),
      { initialProps: { syncSignal: 0 } as UseConversationBridgeOptions },
    );
    act(() => {
      off = result.current.onTurnEnd(cb);
    });
    rerender({ syncSignal: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => off!());
    rerender({ syncSignal: 2 });
    expect(cb).toHaveBeenCalledTimes(1); // 退订后不增
  });

  it("同一回调注册两次:Set 去重(触发一次)+ 一次退订全清", () => {
    const cb = vi.fn();
    const { result, rerender } = renderHook(
      (props: UseConversationBridgeOptions) => useConversationBridge(props),
      { initialProps: { syncSignal: 0 } as UseConversationBridgeOptions },
    );
    let off1: (() => void) | undefined;
    act(() => {
      off1 = result.current.onTurnEnd(cb);
      result.current.onTurnEnd(cb);
    });
    rerender({ syncSignal: 1 });
    // Set 去重:同一回调只触发一次
    expect(cb).toHaveBeenCalledTimes(1);
    // 一次退订即删除唯一条目
    act(() => off1!());
    rerender({ syncSignal: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("无 syncSignal:注册成功、永不触发、不抛", () => {
    const cb = vi.fn();
    const { result, rerender } = renderHook(
      (props: UseConversationBridgeOptions) => useConversationBridge(props),
      { initialProps: {} as UseConversationBridgeOptions },
    );
    let off: (() => void) | undefined;
    expect(() => {
      act(() => {
        off = result.current.onTurnEnd(cb);
      });
    }).not.toThrow();
    // 无信号,任意 rerender 都不触发
    rerender({});
    expect(cb).not.toHaveBeenCalled();
    expect(typeof off).toBe("function");
  });
});

describe("useConversationBridge — 全缺 opts 降级门面不抛(1.4)", () => {
  it("空 opts 下四能力可安全调用,不抛异常", async () => {
    const { result } = renderHook(() => useConversationBridge({}));
    expect(result.current.opChannel).toBe("unavailable");
    // submitOp / bringToConversation / onTurnEnd 全部不抛
    let submit: Awaited<ReturnType<typeof result.current.submitOp>> | undefined;
    await act(async () => {
      submit = await result.current.submitOp(SAMPLE_OP);
    });
    expect(submit).toMatchObject({ ok: false });
    const bring = result.current.bringToConversation(["a"]);
    expect(bring).toMatchObject({ ok: false });
    expect(() => {
      const off = result.current.onTurnEnd(() => undefined);
      off();
    }).not.toThrow();
  });
});
