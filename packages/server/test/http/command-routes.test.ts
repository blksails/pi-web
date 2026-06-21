/**
 * command-routes 单测:各命令转发 ack + 校验 400 + 已停止 409 + 未知 ui-response
 * (Req 3.x,10.1)。
 */
import { describe, expect, it } from "vitest";
import type { Attachment, RpcResponse } from "@pi-web/protocol";
import {
  SessionStoppedError,
  UnknownExtensionUIError,
} from "../../src/session/index.js";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import type { AttachmentMetaSource } from "../../src/http/routes/command-routes.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { asPiSession, MockSession } from "./helpers.js";

function setup(over?: {
  attachmentStore?: AttachmentMetaSource;
}): {
  handler: (req: Request) => Promise<Response>;
  session: MockSession;
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const session = new MockSession("sess-1");
  store.create(asPiSession(session));
  const handler = createPiWebHandler({
    manager,
    store,
    ...(over?.attachmentStore !== undefined
      ? { attachmentStore: over.attachmentStore }
      : {}),
  });
  return { handler, session };
}

/** 极简附件元数据源:按 id 返回固定描述符,未知 id 返回 undefined。 */
function metaStore(by: Record<string, Attachment>): AttachmentMetaSource {
  return {
    head: (id: string): Promise<Attachment | undefined> =>
      Promise.resolve(by[id]),
  };
}

function att(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    name: "file.png",
    mimeType: "image/png",
    size: 10,
    origin: "upload",
    sessionId: "sess-1",
    createdAt: "2026-06-22T00:00:00.000Z",
    ...over,
  };
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

  // ── task 5.2: prompt 文本引用注入(reference-injection 接线;Req 8.1, 9.1) ──

  it("messages with attachmentIds → prompt text carries structured refs (8.1)", async () => {
    const store = metaStore({
      att_a: att({ id: "att_a", name: "a.png", mimeType: "image/png" }),
      att_b: att({ id: "att_b", name: "b.pdf", mimeType: "application/pdf" }),
    });
    const { handler, session } = setup({ attachmentStore: store });
    const res = await handler(
      post("/sessions/sess-1/messages", {
        message: "look at these",
        attachmentIds: ["att_a", "att_b"],
      }),
    );
    expect(res.status).toBe(200);
    const prompt = session.calls.find((c) => c.method === "prompt");
    expect(prompt).toBeDefined();
    const text = prompt?.args[0] as string;
    // 结构化标记含 id / type / name,且原文本保留。
    expect(text).toContain("[attachment id=att_a type=image/png name=a.png]");
    expect(text).toContain(
      "[attachment id=att_b type=application/pdf name=b.pdf]",
    );
    expect(text).toContain("look at these");
    // 仅文本,不内联 base64(9.1)。
    expect(text).not.toContain("data:");
    expect(text).not.toContain("base64");
  });

  it("messages without attachmentIds → message text unchanged (8.3)", async () => {
    const store = metaStore({
      att_a: att({ id: "att_a" }),
    });
    const { handler, session } = setup({ attachmentStore: store });
    await handler(post("/sessions/sess-1/messages", { message: "plain" }));
    const prompt = session.calls.find((c) => c.method === "prompt");
    expect(prompt?.args[0]).toBe("plain");
  });

  it("images/vision base64 still forwarded alongside attachment refs (9.1)", async () => {
    const store = metaStore({
      att_a: att({ id: "att_a", name: "a.png", mimeType: "image/png" }),
    });
    const { handler, session } = setup({ attachmentStore: store });
    const image = {
      type: "image" as const,
      data: "AAAA",
      mimeType: "image/png",
    };
    await handler(
      post("/sessions/sess-1/messages", {
        message: "with both",
        attachmentIds: ["att_a"],
        images: [image],
      }),
    );
    const prompt = session.calls.find((c) => c.method === "prompt");
    const text = prompt?.args[0] as string;
    const options = prompt?.args[1] as { images?: unknown[] };
    // 引用注入到文本…
    expect(text).toContain("[attachment id=att_a type=image/png name=a.png]");
    // …而 images/vision base64 路径维持现状(仍传 images,不被引用注入替代)。
    expect(options.images).toEqual([image]);
  });

  it("unknown attachmentId is skipped (no marker, original kept)", async () => {
    const store = metaStore({}); // head 永远 undefined
    const { handler, session } = setup({ attachmentStore: store });
    await handler(
      post("/sessions/sess-1/messages", {
        message: "ghost ref",
        attachmentIds: ["att_missing"],
      }),
    );
    const prompt = session.calls.find((c) => c.method === "prompt");
    expect(prompt?.args[0]).toBe("ghost ref");
  });
});
