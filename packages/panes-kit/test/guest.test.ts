import { describe, expect, it, vi } from "vitest";
import { PANE_PROTOCOL_VERSION, connectPaneGuest } from "../src/index.js";
import { FakeGuestWindow } from "./conformance/fake-guest-window.js";

describe("connectPaneGuest", () => {
  it("allows slow desktop host startup beyond the legacy 15s window", async () => {
    vi.useFakeTimers();
    try {
      const guestWindow = new FakeGuestWindow();
      const pending = connectPaneGuest({
        expectedPaneId: "search",
        window: guestWindow.asWindow(),
      });
      vi.advanceTimersByTime(15_001);

      const channel = new MessageChannel();
      guestWindow.postMessage({
        type: "pane:connected",
        protocol: PANE_PROTOCOL_VERSION,
        instance: { instanceId: "search-slow-start", paneId: "search", epoch: 1 },
        grants: {
          routes: [],
          surfaceCommands: [],
          surfaceKeys: [],
          events: { publish: [], subscribe: [] },
          attachments: "none",
          conversation: "none",
        },
        interactionMode: "standard",
      }, "*", [channel.port2]);

      await expect(pending).resolves.toMatchObject({ instanceId: "search-slow-start" });
      channel.port1.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives agent-backed surface commands a longer request budget", async () => {
    vi.useFakeTimers();
    try {
      const guestWindow = new FakeGuestWindow();
      const pending = connectPaneGuest({
        expectedPaneId: "video-studio",
        window: guestWindow.asWindow(),
      });
      const channel = new MessageChannel();
      guestWindow.postMessage({
        type: "pane:connected",
        protocol: PANE_PROTOCOL_VERSION,
        instance: { instanceId: "video-slow-command", paneId: "video-studio", epoch: 1 },
        grants: {
          routes: [],
          surfaceCommands: [{ domain: "video-studio", actions: ["intent"] }],
          surfaceKeys: [],
          events: { publish: [], subscribe: [] },
          attachments: "none",
          conversation: "none",
        },
        interactionMode: "standard",
      }, "*", [channel.port2]);
      const connection = await pending;
      const result = connection.surface.run("video-studio", "intent", { name: "video_storyboard_plan" })
        .then(() => undefined, (error: unknown) => error);
      let settled = false;
      void result.then(() => { settled = true; });
      vi.advanceTimersByTime(60_001);
      await Promise.resolve();
      expect(settled).toBe(false);
      vi.advanceTimersByTime(239_999);
      await expect(result).resolves.toMatchObject({ code: "REQUEST_TIMEOUT" });
      connection.close();
      channel.port1.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Host 漏掉首条 ready 时会重发并完成唯一握手", async () => {
    const guestWindow = new FakeGuestWindow();
    const channel = new MessageChannel();
    let readyCount = 0;
    const original = guestWindow.postMessage.bind(guestWindow);
    guestWindow.postMessage = (data, targetOrigin, transfer = []) => {
      if ((data as { type?: unknown })?.type === "pane:ready") {
        readyCount += 1;
        if (readyCount === 2) {
          original({
            type: "pane:connected",
            protocol: PANE_PROTOCOL_VERSION,
            instance: { instanceId: "materials-retry", paneId: "materials", epoch: 1 },
            grants: {
              routes: [],
              surfaceCommands: [],
              surfaceKeys: [],
              events: { publish: [], subscribe: [] },
              attachments: "none",
              conversation: "none",
            },
            interactionMode: "standard",
          }, "*", [channel.port2]);
        }
      }
      original(data, targetOrigin, transfer);
    };

    await expect(connectPaneGuest({
      expectedPaneId: "materials",
      window: guestWindow.asWindow(),
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ instanceId: "materials-retry" });
    expect(readyCount).toBe(2);
    channel.port1.close();
  });

  it("取消旧握手后，新握手独占下一条 MessagePort", async () => {
    const guestWindow = new FakeGuestWindow();
    const controller = new AbortController();
    const stale = connectPaneGuest({
      expectedPaneId: "materials",
      window: guestWindow.asWindow(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(stale).rejects.toMatchObject({ code: "HOST_UNAVAILABLE" });

    const current = connectPaneGuest({
      expectedPaneId: "materials",
      window: guestWindow.asWindow(),
    });
    const channel = new MessageChannel();
    guestWindow.postMessage({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: "materials-1", paneId: "materials", epoch: 1 },
      grants: {
        routes: [],
        surfaceCommands: [],
        surfaceKeys: [],
        events: { publish: [], subscribe: [] },
        attachments: "none",
        conversation: "none",
      },
      interactionMode: "standard",
    }, "*", [channel.port2]);

    await expect(current).resolves.toMatchObject({
      instanceId: "materials-1",
      paneId: "materials",
      epoch: 1,
    });
    channel.port1.close();
  });

  it("接收宿主主题初值及后续切换", async () => {
    const guestWindow = new FakeGuestWindow();
    const current = connectPaneGuest({
      expectedPaneId: "materials",
      window: guestWindow.asWindow(),
    });
    const channel = new MessageChannel();
    guestWindow.postMessage({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: "materials-theme", paneId: "materials", epoch: 1 },
      grants: {
        routes: [],
        surfaceCommands: [],
        surfaceKeys: [],
        events: { publish: [], subscribe: [] },
        attachments: "none",
        conversation: "none",
      },
      interactionMode: "standard",
      theme: { colorScheme: "light", tokens: { "--background": "0 0% 100%" } },
    }, "*", [channel.port2]);
    const connection = await current;
    expect(connection.theme?.colorScheme).toBe("light");
    const received: string[] = [];
    connection.onTheme((theme) => received.push(theme.colorScheme ?? ""));
    channel.port1.postMessage({
      type: "pane:theme",
      theme: { colorScheme: "dark", tokens: { "--background": "222 47% 11%" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual(["dark"]);
    expect(connection.theme?.colorScheme).toBe("dark");
    connection.close();
    channel.port1.close();
  });
});
