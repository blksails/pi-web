import { describe, it, expect, vi } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import type {
  ControlPayload,
  RpcExtensionUIRequest,
} from "@blksails/pi-web-protocol";

function makeExtReq(id: string): RpcExtensionUIRequest {
  return {
    type: "extension_ui_request",
    id,
    method: "confirm",
    title: "ok?",
    message: "proceed",
  };
}

function pushFrame(request: RpcExtensionUIRequest): ControlPayload {
  return { control: "extension-ui", request };
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

  it("starts with an empty ambient snapshot", () => {
    const store = new ControlStore();
    const a = store.getSnapshot().ambient;
    expect(a.notifications).toEqual([]);
    expect(a.statuses).toEqual({});
    expect(a.widgets).toEqual({});
    expect(a.title).toBeUndefined();
    expect(a.editorText).toBeUndefined();
  });

  describe("push-type routing → ambient", () => {
    it("notify appends a notification and normalizes notifyType, stacking multiple", () => {
      const store = new ControlStore();
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "n1",
          method: "notify",
          message: "hello",
          notifyType: "warning",
        }),
      );
      // notifyType 缺省归一为 "info"
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "n2",
          method: "notify",
          message: "world",
        }),
      );
      const list = store.getSnapshot().ambient.notifications;
      expect(list).toEqual([
        { id: "n1", message: "hello", notifyType: "warning" },
        { id: "n2", message: "world", notifyType: "info" },
      ]);
      // 推送类不进对话框队列
      expect(store.getSnapshot().extensionUiQueue).toEqual([]);
    });

    it("notify 按 id 幂等去重:同一 notify 帧应用两次只保留一条(防双流重复显示)", () => {
      const store = new ControlStore();
      const frame = pushFrame({
        type: "extension_ui_request",
        id: "dup-1",
        method: "notify",
        message: "代码检视:发现 2 个问题",
        notifyType: "warning",
      });
      // 同一帧(同 id)经 per-prompt 流 + 空闲控制流各应用一次。
      store.applyControlFrame(frame);
      store.applyControlFrame(frame);
      expect(store.getSnapshot().ambient.notifications).toEqual([
        { id: "dup-1", message: "代码检视:发现 2 个问题", notifyType: "warning" },
      ]);
    });

    it("setStatus sets / replaces a key and deletes on undefined statusText", () => {
      const store = new ControlStore();
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "s1",
          method: "setStatus",
          statusKey: "k",
          statusText: "running",
        }),
      );
      expect(store.getSnapshot().ambient.statuses).toEqual({ k: "running" });
      // 同键替换
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "s2",
          method: "setStatus",
          statusKey: "k",
          statusText: "done",
        }),
      );
      // 另一键并列
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "s3",
          method: "setStatus",
          statusKey: "k2",
          statusText: "idle",
        }),
      );
      expect(store.getSnapshot().ambient.statuses).toEqual({
        k: "done",
        k2: "idle",
      });
      // undefined 删键
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "s4",
          method: "setStatus",
          statusKey: "k",
          statusText: undefined,
        }),
      );
      expect(store.getSnapshot().ambient.statuses).toEqual({ k2: "idle" });
      expect(store.getSnapshot().extensionUiQueue).toEqual([]);
    });

    it("setWidget sets / replaces / deletes by key and normalizes placement", () => {
      const store = new ControlStore();
      // placement 缺省归一为 aboveEditor
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "w1",
          method: "setWidget",
          widgetKey: "w",
          widgetLines: ["a", "b"],
        }),
      );
      expect(store.getSnapshot().ambient.widgets).toEqual({
        w: { lines: ["a", "b"], placement: "aboveEditor" },
      });
      // 替换 + 显式 placement
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "w2",
          method: "setWidget",
          widgetKey: "w",
          widgetLines: ["c"],
          widgetPlacement: "belowEditor",
        }),
      );
      expect(store.getSnapshot().ambient.widgets).toEqual({
        w: { lines: ["c"], placement: "belowEditor" },
      });
      // undefined 删键
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "w3",
          method: "setWidget",
          widgetKey: "w",
          widgetLines: undefined,
        }),
      );
      expect(store.getSnapshot().ambient.widgets).toEqual({});
      expect(store.getSnapshot().extensionUiQueue).toEqual([]);
    });

    it("setTitle sets and replaces the title", () => {
      const store = new ControlStore();
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "t1",
          method: "setTitle",
          title: "First",
        }),
      );
      expect(store.getSnapshot().ambient.title).toBe("First");
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "t2",
          method: "setTitle",
          title: "Second",
        }),
      );
      expect(store.getSnapshot().ambient.title).toBe("Second");
      expect(store.getSnapshot().extensionUiQueue).toEqual([]);
    });

    it("set_editor_text writes text with a monotonically increasing seq", () => {
      const store = new ControlStore();
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "e1",
          method: "set_editor_text",
          text: "one",
        }),
      );
      const first = store.getSnapshot().ambient.editorText;
      expect(first?.text).toBe("one");
      expect(first?.seq).toBe(1);
      store.applyControlFrame(
        pushFrame({
          type: "extension_ui_request",
          id: "e2",
          method: "set_editor_text",
          text: "two",
        }),
      );
      const second = store.getSnapshot().ambient.editorText;
      expect(second?.text).toBe("two");
      expect(second?.seq).toBe(2);
      expect(store.getSnapshot().extensionUiQueue).toEqual([]);
    });
  });

  describe("interactive vs push isolation", () => {
    it("interactive methods stay in extensionUiQueue and never enter ambient", () => {
      const store = new ControlStore();
      const select: RpcExtensionUIRequest = {
        type: "extension_ui_request",
        id: "i1",
        method: "select",
        title: "pick",
        options: ["a", "b"],
      };
      const input: RpcExtensionUIRequest = {
        type: "extension_ui_request",
        id: "i2",
        method: "input",
        title: "name?",
      };
      const editor: RpcExtensionUIRequest = {
        type: "extension_ui_request",
        id: "i3",
        method: "editor",
        title: "edit",
      };
      store.applyControlFrame(pushFrame(makeExtReq("i0"))); // confirm
      store.applyControlFrame(pushFrame(select));
      store.applyControlFrame(pushFrame(input));
      store.applyControlFrame(pushFrame(editor));
      expect(
        store.getSnapshot().extensionUiQueue.map((r) => r.id),
      ).toEqual(["i0", "i1", "i2", "i3"]);
      const a = store.getSnapshot().ambient;
      expect(a.notifications).toEqual([]);
      expect(a.statuses).toEqual({});
      expect(a.widgets).toEqual({});
      expect(a.title).toBeUndefined();
      expect(a.editorText).toBeUndefined();
    });
  });

  describe("dismissNotification + soft cap", () => {
    it("removes the notification with the given id; no-op for unknown id", () => {
      const store = new ControlStore();
      const listener = vi.fn();
      store.subscribe(listener);
      for (const id of ["a", "b", "c"]) {
        store.applyControlFrame(
          pushFrame({
            type: "extension_ui_request",
            id,
            method: "notify",
            message: id,
          }),
        );
      }
      const before = store.getSnapshot();
      store.dismissNotification("b");
      expect(
        store.getSnapshot().ambient.notifications.map((n) => n.id),
      ).toEqual(["a", "c"]);
      // 无变更不换引用、不通知
      const calls = listener.mock.calls.length;
      store.dismissNotification("zzz");
      expect(store.getSnapshot()).toBe(store.getSnapshot());
      expect(listener.mock.calls.length).toBe(calls);
      expect(store.getSnapshot()).not.toBe(before);
    });

    it("enforces a soft cap of the most recent 100 notifications", () => {
      const store = new ControlStore();
      for (let i = 0; i < 130; i++) {
        store.applyControlFrame(
          pushFrame({
            type: "extension_ui_request",
            id: `n${i}`,
            method: "notify",
            message: `m${i}`,
          }),
        );
      }
      const list = store.getSnapshot().ambient.notifications;
      expect(list.length).toBe(100);
      // 保留最近 100 条:n30..n129
      expect(list[0]?.id).toBe("n30");
      expect(list[list.length - 1]?.id).toBe("n129");
    });
  });

  // ── session-status 生命周期切片(spec session-readiness-handshake, Task 3.1) ──
  describe("session-status lifecycle", () => {
    it("初始 lifecycle 为 initializing(失败安全默认)", () => {
      const store = new ControlStore();
      expect(store.getSnapshot().lifecycle).toEqual({
        state: "initializing",
        detail: undefined,
        code: undefined,
      });
    });

    it("应用 session-status{ready} 更新 lifecycle 切片", () => {
      const store = new ControlStore();
      store.applyControlFrame({ control: "session-status", state: "ready" });
      expect(store.getSnapshot().lifecycle.state).toBe("ready");
    });

    it("携带 detail/code 的 error 帧更新切片", () => {
      const store = new ControlStore();
      store.applyControlFrame({
        control: "session-status",
        state: "error",
        detail: "probe timed out",
        code: "probe-timeout",
      });
      const lc = store.getSnapshot().lifecycle;
      expect(lc.state).toBe("error");
      expect(lc.code).toBe("probe-timeout");
      expect(lc.detail).toBe("probe timed out");
    });

    it("相同态不换快照引用(防 useSyncExternalStore 抖动)", () => {
      const store = new ControlStore();
      store.applyControlFrame({ control: "session-status", state: "ready" });
      const s1 = store.getSnapshot();
      store.applyControlFrame({ control: "session-status", state: "ready" });
      expect(store.getSnapshot()).toBe(s1);
    });

    it("不影响其它切片(queue 引用稳定)", () => {
      const store = new ControlStore();
      const q0 = store.getSnapshot().queue;
      store.applyControlFrame({ control: "session-status", state: "ready" });
      expect(store.getSnapshot().queue).toBe(q0);
    });
  });
});
