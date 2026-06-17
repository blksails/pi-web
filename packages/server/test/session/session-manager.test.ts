/**
 * SessionManager:创建 + 去注册接线 + SIGTERM 优雅停机(Req 1.1, 1.5, 7.5, 8.x, 9.3, 9.4)。
 */
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { MissingInputError } from "../../src/session/session.errors.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function manager(): { mgr: SessionManager; store: InMemorySessionStore } {
  const store = new InMemorySessionStore(true);
  let n = 0;
  const mgr = new SessionManager({
    store,
    idleMs: 0,
    idFactory: () => `s${++n}`,
  });
  return { mgr, store };
}

describe("SessionManager create + deregister", () => {
  it("creates a session retrievable from the store by sessionId (Req 1.1, 9.3)", () => {
    const { mgr, store } = manager();
    const { sessionId } = mgr.createSession({
      resolved: makeResolved(),
      channel: new MockChannel(),
    });
    expect(sessionId).toBe("s1");
    expect(store.get("s1")).toBeDefined();
  });

  it("deregisters via onClosed after explicit stop (Req 7.5, 9.4)", async () => {
    const { mgr, store } = manager();
    const { sessionId, session } = mgr.createSession({
      resolved: makeResolved(),
      channel: new MockChannel(),
    });
    await session.stop();
    expect(store.get(sessionId)).toBeUndefined();
  });

  it("deregisters when the child crashes (Req 7.5)", () => {
    const { mgr, store } = manager();
    const ch = new MockChannel();
    const { sessionId } = mgr.createSession({ resolved: makeResolved(), channel: ch });
    ch.emitExit({ code: 137, signal: "SIGKILL" });
    expect(store.get(sessionId)).toBeUndefined();
  });

  it("rejects missing inputs with MissingInputError (Req 1.5)", () => {
    const { mgr } = manager();
    expect(() =>
      mgr.createSession({
        resolved: undefined as never,
        channel: new MockChannel(),
      }),
    ).toThrow(MissingInputError);
    expect(() =>
      mgr.createSession({
        resolved: makeResolved(),
        channel: undefined as never,
      }),
    ).toThrow(MissingInputError);
  });
});

describe("SessionManager graceful shutdown (Req 8.x)", () => {
  it("stops all sessions, empties the store, and stops accepting new ones", async () => {
    const { mgr, store } = manager();
    mgr.createSession({ resolved: makeResolved(), channel: new MockChannel() });
    mgr.createSession({ resolved: makeResolved(), channel: new MockChannel() });
    expect(store.list()).toHaveLength(2);
    await mgr.shutdown();
    expect(store.list()).toHaveLength(0);
    expect(mgr.isAccepting()).toBe(false);
    expect(() =>
      mgr.createSession({ resolved: makeResolved(), channel: new MockChannel() }),
    ).toThrow();
  });

  it("isolates a single session stop failure and continues (Req 8.4)", async () => {
    const { mgr, store } = manager();
    const okCh = new MockChannel();
    const badCh = new MockChannel();
    const { session: ok } = mgr.createSession({
      resolved: makeResolved(),
      channel: okCh,
    });
    const { session: bad } = mgr.createSession({
      resolved: makeResolved(),
      channel: badCh,
    });
    // make the bad session throw during stop
    vi.spyOn(bad, "stop").mockRejectedValueOnce(new Error("stop failed"));
    await expect(mgr.shutdown()).resolves.toBeUndefined();
    // the good session was still stopped and deregistered
    expect(ok.status).toBe("stopped");
    expect(store.get(ok.id)).toBeUndefined();
  });
});
