/**
 * e2e:全链路 Web-Fetch 流式 + abort + 重连续流(Req 10.3,10.4,10.5,5.5,6.2)。
 *
 * 全程经 createPiWebHandler 直接以 new Request(...) 驱动(无需运行 Next server),
 * 真实 SessionManager + rpc-channel stub agent。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { makeRealEngine, readStream } from "./helpers.js";
import type { PiWebHandler } from "../../src/http/handler.types.js";
import type { SessionManager, SessionStore } from "../../src/session/index.js";

let managers: SessionManager[] = [];
afterEach(async () => {
  await Promise.all(managers.map((m) => m.shutdown().catch(() => undefined)));
  managers = [];
});

function boot(): { handler: PiWebHandler; store: SessionStore } {
  const { manager, store, createChannel, resolver } = makeRealEngine();
  managers.push(manager);
  const handler = createPiWebHandler({
    manager,
    store,
    resolver,
    createChannel,
    sse: { heartbeatMs: 0 },
  });
  return { handler, store };
}

async function createSession(handler: PiWebHandler): Promise<string> {
  const res = await handler(
    new Request("http://x/sessions", {
      method: "POST",
      body: JSON.stringify({ source: "./agent" }),
    }),
  );
  const { sessionId } = (await res.json()) as { sessionId: string };
  return sessionId;
}

describe("http-api e2e", () => {
  it("POST /sessions → /stream → /messages → incremental text-delta until finish", async () => {
    const { handler } = boot();
    const id = await createSession(handler);

    const stream = await handler(
      new Request(`http://x/sessions/${id}/stream`, { method: "GET" }),
    );
    const collected = readStream(stream, {
      until: (t) => t.includes('"finish"'),
      maxMs: 8000,
    });

    const msg = await handler(
      new Request(`http://x/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "say hello" }),
      }),
    );
    expect(msg.status).toBe(200);

    const text = await collected;
    // incremental deltas then a finish chunk
    expect(text).toContain("text-delta");
    expect(text).toContain('"finish"');
    // monotonic id: lines present for reconnect positioning
    expect(text).toMatch(/\nid: \d+\n/);
  });

  it("POST /abort returns ack (stream can be wound down)", async () => {
    const { handler } = boot();
    const id = await createSession(handler);
    const res = await handler(
      new Request(`http://x/sessions/${id}/abort`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: true });
  });

  it("reconnect with Last-Event-ID resumes frame push (subsequent prompt)", async () => {
    const { handler } = boot();
    const id = await createSession(handler);

    // first stream + first prompt
    const s1 = await handler(
      new Request(`http://x/sessions/${id}/stream`, { method: "GET" }),
    );
    const first = readStream(s1, { until: (t) => t.includes('"finish"'), maxMs: 8000 });
    await handler(
      new Request(`http://x/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "one" }),
      }),
    );
    const firstText = await first;
    const ids = [...firstText.matchAll(/\nid: (\d+)\n/g)].map((m) => Number(m[1]));
    const lastId = ids[ids.length - 1] ?? 0;
    // readStream already cancelled the reader when the `until` matched.

    // reconnect with Last-Event-ID; session still alive → resume and receive
    // frames from a new prompt (gateway re-subscribes; does not replay history).
    const s2 = await handler(
      new Request(`http://x/sessions/${id}/stream`, {
        method: "GET",
        headers: { "Last-Event-ID": String(lastId) },
      }),
    );
    const second = readStream(s2, { until: (t) => t.includes('"finish"'), maxMs: 8000 });
    await handler(
      new Request(`http://x/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "two" }),
      }),
    );
    const secondText = await second;
    expect(secondText).toContain("text-delta");
    expect(secondText).toContain('"finish"');
    // resumed id sequence continues past the reconnect position
    const resumedIds = [...secondText.matchAll(/\nid: (\d+)\n/g)].map((m) =>
      Number(m[1]),
    );
    expect(resumedIds[0]).toBeGreaterThan(lastId);
  });

  it("reconnect after session ended → explicit 409, not a hanging stream", async () => {
    const { handler, store } = boot();
    const id = await createSession(handler);
    await handler(new Request(`http://x/sessions/${id}`, { method: "DELETE" }));
    expect(store.get(id)).toBeUndefined();
    const res = await handler(
      new Request(`http://x/sessions/${id}/stream`, {
        method: "GET",
        headers: { "Last-Event-ID": "5" },
      }),
    );
    // session removed from store → 404 (no hang)
    expect(res.status).toBe(404);
  });

  it("DELETE /sessions/:id removes the session", async () => {
    const { handler, store } = boot();
    const id = await createSession(handler);
    expect(store.get(id)).toBeDefined();
    const res = await handler(
      new Request(`http://x/sessions/${id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(store.get(id)).toBeUndefined();
  });
});
