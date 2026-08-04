/**
 * stream-route 单测:SSE 头、帧推送、断开 unsubscribe、不存在 404、已结束 409
 * (Req 5.1,5.3,5.5,5.6,5.7,10.1)。
 */
import { describe, expect, it } from "vitest";
import { makeUiMessageChunkFrame, protocolVersion } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession, readStream } from "./helpers.js";

function setup(): {
  handler: (req: Request) => Promise<Response>;
  session: MockSession;
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new MockSession("sess-1");
  store.create(asPiSession(session));
  const handler = createPiWebHandler({ manager, store, sse: { heartbeatMs: 0 } });
  return { handler, session };
}

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

describe("GET /sessions/:id/stream", () => {
  it("sets SSE headers including X-Accel-Buffering", async () => {
    const { handler } = setup();
    const res = await handler(get("/sessions/sess-1/stream"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("X-Pi-Protocol-Version")).toBe(protocolVersion);
    await res.body?.cancel();
  });

  it("subscribes and pushes encoded frames", async () => {
    const { handler, session } = setup();
    const res = await handler(get("/sessions/sess-1/stream"));
    const reader = res.body!.getReader();
    // ReadableStream.start runs eagerly → subscribe already wired up.
    expect(session.subscriberCount()).toBe(1);
    session.emitFrame(
      makeUiMessageChunkFrame({ type: "text-delta", id: "t", delta: "x" }),
    );
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: uiMessageChunk");
    expect(text).toContain("text-delta");
    expect(text).toContain("id: 0");
    await reader.cancel();
  });

  it("client disconnect (cancel) triggers unsubscribe", async () => {
    const { handler, session } = setup();
    const res = await handler(get("/sessions/sess-1/stream"));
    // force the stream to start by reading once
    const reader = res.body!.getReader();
    // emit a frame so subscribe is active and there is data
    session.emitFrame(makeUiMessageChunkFrame({ type: "text-delta", id: "t", delta: "x" }));
    await reader.read();
    expect(session.subscriberCount()).toBe(1);
    await reader.cancel();
    expect(session.subscriberCount()).toBe(0);
  });

  it("session end writes a control end frame and closes", async () => {
    const { handler, session } = setup();
    const res = await handler(get("/sessions/sess-1/stream"));
    const reader = res.body!.getReader();
    session.emitEnd("stopped");
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (value !== undefined) text += decoder.decode(value, { stream: true });
      if (done) break;
    }
    expect(text).toContain("event: control");
    expect(text).toContain("session ended");
  });

  it("404 for unknown session", async () => {
    const { handler } = setup();
    const res = await handler(get("/sessions/missing/stream"));
    expect(res.status).toBe(404);
  });

  it("409 when session already ended", async () => {
    const { handler, session } = setup();
    session.status = "stopped";
    const res = await handler(get("/sessions/sess-1/stream"));
    expect(res.status).toBe(409);
  });
});
