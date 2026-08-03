/**
 * create-session 单测:建会话成功/缺 source 400/停机 503(Req 2.1,2.2,2.5,10.1)。
 */
import { describe, expect, it } from "vitest";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { MockChannel } from "../session/mock-channel.js";
import { makeResolved } from "./helpers.js";
import type { ResolvedSource } from "../../src/agent-source/index.js";

function deps() {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const resolver = {
    resolve: (): Promise<ResolvedSource> => Promise.resolve(makeResolved()),
  };
  const createChannel = (): SessionChannel => new MockChannel();
  return { store, manager, resolver, createChannel };
}

describe("POST /sessions", () => {
  it("creates a session and returns { sessionId } (201)", async () => {
    const { store, manager, resolver, createChannel } = deps();
    const handler = createPiWebHandler({ manager, store, resolver, createChannel });
    const res = await handler(
      new Request("http://x/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "./agent" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string };
    expect(typeof body.sessionId).toBe("string");
    expect(store.get(body.sessionId)).toBeDefined();
  });

  it("400 when source is missing", async () => {
    const { store, manager, resolver, createChannel } = deps();
    const handler = createPiWebHandler({ manager, store, resolver, createChannel });
    const res = await handler(
      new Request("http://x/sessions", {
        method: "POST",
        body: JSON.stringify({ cwd: "/tmp" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { fields?: string[] } };
    expect(body.error.fields).toContain("source");
  });

  it("503 when manager is shutting down", async () => {
    const { store, manager, resolver, createChannel } = deps();
    await manager.shutdown();
    const handler = createPiWebHandler({ manager, store, resolver, createChannel });
    const res = await handler(
      new Request("http://x/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "./agent" }),
      }),
    );
    expect(res.status).toBe(503);
  });
});
