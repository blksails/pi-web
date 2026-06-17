/**
 * query-routes 单测:state/stats/messages/commands 返回响应 DTO 形状(Req 4.x,10.1)。
 */
import { describe, expect, it } from "vitest";
import type { RpcResponse } from "@pi-web/protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

function setup(configure: (s: MockSession) => void): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new MockSession("sess-1");
  configure(session);
  store.create(asPiSession(session));
  return createPiWebHandler({ manager, store });
}

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

describe("query routes", () => {
  it("GET state → { state }", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_state",
            success: true,
            data: { foo: "bar" },
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/state"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: unknown };
    expect(body.state).toEqual({ foo: "bar" });
  });

  it("GET stats → { stats }", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_session_stats",
            success: true,
            data: { cost: 0.5 },
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/stats"));
    const body = (await res.json()) as { stats: unknown };
    expect(body.stats).toEqual({ cost: 0.5 });
  });

  it("GET messages → { messages }", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_messages",
            success: true,
            data: { messages: [{ role: "user" }] },
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/messages"));
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(1);
  });

  it("GET commands → { commands }", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_commands",
            success: true,
            data: { commands: [{ name: "help" }] },
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/commands"));
    const body = (await res.json()) as { commands: unknown[] };
    expect(body.commands).toHaveLength(1);
  });

  it("missing session → 404", async () => {
    const handler = setup(() => undefined);
    const res = await handler(get("/sessions/missing/state"));
    expect(res.status).toBe(404);
  });
});
