import { describe, it, expect, vi } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import type {
  ControlPayload,
  RpcExtensionUIRequest,
} from "@pi-web/protocol";

function makeExtReq(id: string): RpcExtensionUIRequest {
  return {
    type: "extension_ui_request",
    id,
    method: "confirm",
    title: "ok?",
    message: "proceed",
  };
}

describe("ControlStore", () => {
  it("starts with an empty immutable snapshot", () => {
    const store = new ControlStore();
    const s1 = store.getSnapshot();
    const s2 = store.getSnapshot();
    expect(s1).toBe(s2); // 引用稳定
    expect(s1.queue).toEqual({ steering: [], followUp: [] });
    expect(s1.stats).toBeUndefined();
    expect(s1.error).toBeNull();
    expect(s1.extensionUiQueue).toEqual([]);
  });

  it("routes queue control frame", () => {
    const store = new ControlStore();
    const payload: ControlPayload = {
      control: "queue",
      steering: ["s1"],
      followUp: ["f1"],
    };
    store.applyControlFrame(payload);
    expect(store.getSnapshot().queue).toEqual({
      steering: ["s1"],
      followUp: ["f1"],
    });
  });

  it("routes stats control frame", () => {
    const store = new ControlStore();
    store.applyControlFrame({
      control: "stats",
      stats: { tokensUsed: 10 },
    } as ControlPayload);
    expect(store.getSnapshot().stats).toEqual({ tokensUsed: 10 });
  });

  it("routes error control frame", () => {
    const store = new ControlStore();
    store.applyControlFrame({
      control: "error",
      message: "boom",
      code: "E_X",
    });
    expect(store.getSnapshot().error).toEqual({ message: "boom", code: "E_X" });
  });

  it("enqueues extension-ui control frames FIFO without dropping", () => {
    const store = new ControlStore();
    store.applyControlFrame({
      control: "extension-ui",
      request: makeExtReq("a"),
    });
    store.applyControlFrame({
      control: "extension-ui",
      request: makeExtReq("b"),
    });
    const q = store.getSnapshot().extensionUiQueue;
    expect(q.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("dequeues by id and notifies subscribers", () => {
    const store = new ControlStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.enqueueExtensionUi(makeExtReq("a"));
    store.enqueueExtensionUi(makeExtReq("b"));
    expect(listener).toHaveBeenCalledTimes(2);

    store.dequeueExtensionUi("a");
    expect(store.getSnapshot().extensionUiQueue.map((r) => r.id)).toEqual([
      "b",
    ]);
    expect(listener).toHaveBeenCalledTimes(3);

    // 不存在的 id 不变更、不通知
    store.dequeueExtensionUi("zzz");
    expect(listener).toHaveBeenCalledTimes(3);
    unsub();
  });
});
