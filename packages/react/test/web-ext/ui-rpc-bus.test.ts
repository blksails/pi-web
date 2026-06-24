import { describe, expect, it, vi } from "vitest";
import { createUiRpcBus } from "../../src/web-ext/ui-rpc-bus.js";
import type { UiRpcResponse } from "@blksails/pi-web-protocol";

/** 受控下行:测试手动 push 响应。 */
function makeHarness(opts: { send?: () => Promise<void> } = {}) {
  let emit: ((r: UiRpcResponse) => void) | undefined;
  let ids = 0;
  const sent: { correlationId: string }[] = [];
  const bus = createUiRpcBus({
    send: opts.send ?? (async (req) => { sent.push({ correlationId: req.correlationId }); }),
    subscribeResponse: (cb) => {
      emit = cb;
      return () => { emit = undefined; };
    },
    timeoutMs: 1000,
    genId: () => `c${++ids}`,
  });
  return {
    bus,
    sent,
    push: (r: UiRpcResponse) => emit?.(r),
    hasSubscriber: () => emit !== undefined,
  };
}

describe("createUiRpcBus", () => {
  it("按 correlationId 配对响应", async () => {
    const h = makeHarness();
    const p = h.bus.request({ point: "slash", action: "list", payload: { q: "/" } });
    expect(h.sent[0]?.correlationId).toBe("c1");
    h.push({ correlationId: "c1", ok: true, result: ["a", "b"] });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.result).toEqual(["a", "b"]);
  });

  it("无关 correlationId 不影响挂起请求", async () => {
    const h = makeHarness();
    const p = h.bus.request({ point: "mention", action: "resolve", payload: {} as never });
    h.push({ correlationId: "other", ok: true });
    h.push({ correlationId: "c1", ok: true, result: "ok" });
    expect((await p).result).toBe("ok");
  });

  it("超时以 TIMEOUT 结算(不抛)", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      const p = h.bus.request({ point: "autocomplete", action: "complete", payload: {} as never });
      vi.advanceTimersByTime(1001);
      const r = await p;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error?.code).toBe("TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("send 失败以 SEND_FAILED 结算", async () => {
    const h = makeHarness({ send: async () => { throw new Error("net down"); } });
    const r = await h.bus.request({ point: "slash", action: "list", payload: {} as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error?.code).toBe("SEND_FAILED");
  });

  it("AbortSignal 取消以 ABORTED 结算", async () => {
    const h = makeHarness();
    const ac = new AbortController();
    const p = h.bus.request({ point: "inlineComplete", action: "complete", payload: {} as never, signal: ac.signal });
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error?.code).toBe("ABORTED");
  });

  it("dispose 取消订阅并结算挂起请求", async () => {
    const h = makeHarness();
    const p = h.bus.request({ point: "slash", action: "list", payload: {} as never });
    h.bus.dispose();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error?.code).toBe("DISPOSED");
    expect(h.hasSubscriber()).toBe(false);
  });
});
