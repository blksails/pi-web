/**
 * query-routes 单测:state/stats/messages/commands 返回响应 DTO 形状(Req 4.x,10.1)。
 */
import { describe, expect, it } from "vitest";
import type { RpcResponse } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionStoppedError } from "../../src/session/index.js";
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

  it("GET models → { models }", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_available_models",
            success: true,
            data: { models: [{ id: "m1" }, { id: "m2" }] },
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/models"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[] };
    expect(body.models).toHaveLength(2);
  });

  it("GET models 按 PI_WEB_HIDE_PROVIDERS 剔除指定 provider 的模型", async () => {
    const prev = process.env["PI_WEB_HIDE_PROVIDERS"];
    process.env["PI_WEB_HIDE_PROVIDERS"] = "openrouter";
    try {
      const handler = setup((s) =>
        s.setResponse(
          () =>
            ({
              type: "response",
              command: "get_available_models",
              success: true,
              data: {
                models: [
                  { id: "a", provider: "openrouter" },
                  { id: "b", provider: "dashscope" },
                  { id: "c", provider: "openrouter" },
                ],
              },
            }) as unknown as RpcResponse,
        ),
      );
      const res = await handler(get("/sessions/sess-1/models"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        models: Array<{ id: string; provider: string }>;
      };
      expect(body.models.map((m) => m.id)).toEqual(["b"]);
      expect(body.models.some((m) => m.provider === "openrouter")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env["PI_WEB_HIDE_PROVIDERS"];
      else process.env["PI_WEB_HIDE_PROVIDERS"] = prev;
    }
  });

  it("GET fork-messages → { messages }", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_fork_messages",
            success: true,
            data: { messages: [{ entryId: "e1", text: "t1" }] },
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/fork-messages"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: { entryId: string; text: string }[];
    };
    expect(body.messages).toEqual([{ entryId: "e1", text: "t1" }]);
  });

  it("GET models upstream failure → 502", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_available_models",
            success: false,
            error: "boom",
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/models"));
    expect(res.status).toBe(502);
  });

  it("GET models on stopped session → 409 (error-map)", async () => {
    const handler = setup((s) =>
      s.throwOn.set("getAvailableModels", new SessionStoppedError("sess-1")),
    );
    const res = await handler(get("/sessions/sess-1/models"));
    expect(res.status).toBe(409);
  });

  it("GET fork-messages upstream failure → 502", async () => {
    const handler = setup((s) =>
      s.setResponse(
        () =>
          ({
            type: "response",
            command: "get_fork_messages",
            success: false,
            error: "boom",
          }) as unknown as RpcResponse,
      ),
    );
    const res = await handler(get("/sessions/sess-1/fork-messages"));
    expect(res.status).toBe(502);
  });

  it("GET fork-messages on stopped session → 409 (error-map)", async () => {
    const handler = setup((s) =>
      s.throwOn.set("getForkMessages", new SessionStoppedError("sess-1")),
    );
    const res = await handler(get("/sessions/sess-1/fork-messages"));
    expect(res.status).toBe(409);
  });

  it("missing session → 404 (models / fork-messages)", async () => {
    const handler = setup(() => undefined);
    expect((await handler(get("/sessions/missing/models"))).status).toBe(404);
    expect(
      (await handler(get("/sessions/missing/fork-messages"))).status,
    ).toBe(404);
  });

  it("missing session → 404", async () => {
    const handler = setup(() => undefined);
    const res = await handler(get("/sessions/missing/state"));
    expect(res.status).toBe(404);
  });
});
