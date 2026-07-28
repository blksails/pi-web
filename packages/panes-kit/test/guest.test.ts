import { describe, expect, it } from "vitest";
import { PANE_PROTOCOL_VERSION, connectPaneGuest } from "../src/index.js";
import { FakeGuestWindow } from "./conformance/fake-guest-window.js";

describe("connectPaneGuest", () => {
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
      grants: { routes: [], surfaceCommands: [], surfaceKeys: [], attachments: "none", conversation: "none" },
      interactionMode: "standard",
    }, "*", [channel.port2]);

    await expect(current).resolves.toMatchObject({
      instanceId: "materials-1",
      paneId: "materials",
      epoch: 1,
    });
    channel.port1.close();
  });
});
