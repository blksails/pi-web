import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { createInboundFrameRouter } from "../../src/runner/frame-channel/index.js";
import { wireCredentialRefreshBridge } from "../../src/runner/credential-refresh-wiring.js";

function harness(): {
  feed(frame: unknown): void;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
} {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  stdin.setEncoding = () => {};
  const env: NodeJS.ProcessEnv = { PI_WEB_DESKTOP_CREDENTIAL: "old" };
  const channel = createInboundFrameRouter({
    sessionId: "s1",
    stdin,
    stdout: { write: () => true },
    stderr: { write: () => true },
  });
  const wiring = wireCredentialRefreshBridge(channel, { env });
  return {
    env,
    feed(frame) {
      stdin.emit("data", JSON.stringify(frame) + "\n");
    },
    cleanup() {
      wiring.cleanup();
      channel.cleanup();
    },
  };
}

describe("credential refresh bridge", () => {
  it("replaces runner credential without restarting session", () => {
    const h = harness();
    h.feed({ type: "piweb_credential_refresh", credential: "new" });
    expect(h.env.PI_WEB_DESKTOP_CREDENTIAL).toBe("new");
    h.cleanup();
  });

  it("null clears runner credential", () => {
    const h = harness();
    h.feed({ type: "piweb_credential_refresh", credential: null });
    expect(h.env.PI_WEB_DESKTOP_CREDENTIAL).toBeUndefined();
    h.cleanup();
  });

  it("invalid frame leaves credential unchanged", () => {
    const h = harness();
    h.feed({ type: "piweb_credential_refresh", credential: "" });
    expect(h.env.PI_WEB_DESKTOP_CREDENTIAL).toBe("old");
    h.cleanup();
  });
});
