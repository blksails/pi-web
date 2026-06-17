/**
 * command-routes 单测:各命令转发 ack + 校验 400 + 已停止 409 + 未知 ui-response
 * (Req 3.x,10.1)。
 */
import { describe, expect, it } from "vitest";
import type { RpcResponse } from "@pi-web/protocol";
import {
  SessionStoppedError,
  UnknownExtensionUIError,
} from "../../src/session/index.js";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

function setup(): {
  handler: (req: Request) => Promise<Response>;
  session: MockSession;
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new MockSession("sess-1");
  store.create(asPiSession(session));
  const handler = createPiWebHandler({ manager, store });
  return { handler, session };
}

function post(path: string, body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("command routes", () => {
  it("messages → prompt forwarded, ack", async () => {
    const { handler, session } = setup();
    const res = await handler(
      post("/sessions/sess-1/messages", { message: "hi" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({
      ok: true,
      protocolVersion: expect.any(String),
    });
    expect(session.calls.some((c) => c.method === "prompt")).toBe(true);
  });

  it("steer / follow_up / model / thinking forward to their methods", async () => {
    const { handler, session } = setup();
    await handler(post("/sessions/sess-1/steer", { message: "s" }));
    await handler(post("/sessions/sess-1/follow_up", { message: "f" }));
    await handler(post("/sessions/sess-1/model", { provider: "p", modelId: "m" }));
    await handler(post("/sessions/sess-1/thinking", { level: "medium" }));
    const methods = session.calls.map((c) => c.method);
    expect(methods).toContain("steer");
    expect(methods).toContain("followUp");
    expect(methods).toContain("setModel");
    expect(methods).toContain("setThinkingLevel");
  });

  it("abort forwards with no body", async () => {
    const { handler, session } = setup();
    const res = await handler(post("/sessions/sess-1/abort"));
    expect(res.status).toBe(200);
    expect(session.calls.some((c) => c.method === "abort")).toBe(true);
  });

  it("400 on validation failure, not forwarded", async () => {
    const { handler, session } = setup();
    const res = await handler(post("/sessions/sess-1/messages", { message: 5 }));
    expect(res.status).toBe(400);
    expect(session.calls.some((c) => c.method === "prompt")).toBe(false);
  });

  it("stopped session → 409", async () => {
    const { handler, session } = setup();
    session.throwOn.set("prompt", new SessionStoppedError("sess-1"));
    const res = await handler(
      post("/sessions/sess-1/messages", { message: "hi" }),
    );
    expect(res.status).toBe(409);
  });

  it("unknown ui-response id → 409", async () => {
    const { handler, session } = setup();
    session.throwOn.set("respondExtensionUI", new UnknownExtensionUIError("ui-x"));
    const res = await handler(
      post("/sessions/sess-1/ui-response", {
        type: "extension_ui_response",
        id: "ui-x",
        confirmed: true,
      }),
    );
    expect(res.status).toBe(409);
  });

  it("ui-response forwards to respondExtensionUI", async () => {
    const { handler, session } = setup();
    const res = await handler(
      post("/sessions/sess-1/ui-response", {
        type: "extension_ui_response",
        id: "ui-1",
        confirmed: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(session.calls.some((c) => c.method === "respondExtensionUI")).toBe(
      true,
    );
  });

  it("missing session → 404", async () => {
    const { handler } = setup();
    const res = await handler(post("/sessions/missing/messages", { message: "x" }));
    expect(res.status).toBe(404);
  });

  it("fork forwards entryId and returns the fork contract payload (200)", async () => {
    const { handler, session } = setup();
    session.setResponse(
      () =>
        ({
          type: "response",
          command: "fork",
          success: true,
          data: { text: "branched", cancelled: false },
        }) as unknown as RpcResponse,
    );
    const res = await handler(post("/sessions/sess-1/fork", { entryId: "e-9" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text?: string; cancelled?: boolean };
    expect(body.text).toBe("branched");
    expect(body.cancelled).toBe(false);
    const fork = session.calls.find((c) => c.method === "fork");
    expect(fork?.args[0]).toBe("e-9");
  });

  it("fork → 400 on validation failure, not forwarded", async () => {
    const { handler, session } = setup();
    const res = await handler(post("/sessions/sess-1/fork", { entryId: 5 }));
    expect(res.status).toBe(400);
    expect(session.calls.some((c) => c.method === "fork")).toBe(false);
  });

  it("fork on stopped session → 409 (error-map)", async () => {
    const { handler, session } = setup();
    session.throwOn.set("fork", new SessionStoppedError("sess-1"));
    const res = await handler(post("/sessions/sess-1/fork", { entryId: "e" }));
    expect(res.status).toBe(409);
  });

  it("fork upstream failure → 502", async () => {
    const { handler, session } = setup();
    session.setResponse(
      () =>
        ({
          type: "response",
          command: "fork",
          success: false,
          error: "boom",
        }) as unknown as RpcResponse,
    );
    const res = await handler(post("/sessions/sess-1/fork", { entryId: "e" }));
    expect(res.status).toBe(502);
  });

  it("fork on missing session → 404", async () => {
    const { handler } = setup();
    const res = await handler(post("/sessions/missing/fork", { entryId: "e" }));
    expect(res.status).toBe(404);
  });
});
