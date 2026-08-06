/**
 * command-routes 单测:各命令转发 ack + 校验 400 + 已停止 409 + 未知 ui-response
 * (Req 3.x,10.1)。
 */
import { describe, expect, it } from "vitest";
import type { Attachment, RpcResponse } from "@blksails/pi-web-protocol";
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
    await handler(post("/sessions/sess-1/models", { provider: "p", modelId: "m" }));
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

  it("clear_queue → PiSession.clearQueue, returns cleared queue body", async () => {
    const { handler, session } = setup();
    session.clearQueueResult = { steering: ["a", "b"], followUp: ["c"] };
    const res = await handler(post("/sessions/sess-1/clear_queue"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      steering: ["a", "b"],
      followUp: ["c"],
    });
    expect(session.calls.some((c) => c.method === "clearQueue")).toBe(true);
  });

  it("clear_queue → 409 when session stopped", async () => {
    const { handler, session } = setup();
    session.status = "stopped";
    const res = await handler(post("/sessions/sess-1/clear_queue"));
    expect(res.status).toBe(409);
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
    // head-only store 无 getReadStream → 不额外物化,客户端 images 原样转发。
    expect(options.images).toEqual([image]);
  });

  // ── attachment-mention-vision: native LLM images from store ──────────

  it("attachmentIds image → prompt.images materialised (native, no image_vision)", async () => {
    const { Readable } = await import("node:stream");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const b64 = Buffer.from(png).toString("base64");
    const store: AttachmentMetaSource = {
      head: async (id) =>
        id === "att_img"
          ? att({ id: "att_img", name: "shot.png", mimeType: "image/png" })
          : undefined,
      getReadStream: async (id) => {
        if (id !== "att_img") throw new Error("missing");
        return {
          stream: Readable.from([Buffer.from(png)]),
          meta: { mimeType: "image/png" },
        };
      },
    };
    const { handler, session } = setup({ attachmentStore: store });
    const res = await handler(
      post("/sessions/sess-1/messages", {
        message: "what is this",
        attachmentIds: ["att_img"],
      }),
    );
    expect(res.status).toBe(200);
    const prompt = session.calls.find((c) => c.method === "prompt");
    const text = prompt?.args[0] as string;
    const options = prompt?.args[1] as {
      images?: { type: string; data: string; mimeType: string }[];
    };
    // 文本引用仍在(给 tool 抄 id)
    expect(text).toContain(
      "[attachment id=att_img type=image/png name=shot.png]",
    );
    expect(text).not.toContain("data:");
    // native 多模态 images 已物化
    expect(options.images).toEqual([
      { type: "image", data: b64, mimeType: "image/png" },
    ]);
    // 不经 image_vision:prompt 参数里没有 tool 强制;只是 images 字段
    expect(JSON.stringify(prompt)).not.toMatch(/image_vision/);
  });

  it("@attachment mention in message → prompt.images materialised", async () => {
    const { Readable } = await import("node:stream");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const b64 = Buffer.from(png).toString("base64");
    const store: AttachmentMetaSource = {
      head: async (id) =>
        id === "att_m"
          ? att({ id: "att_m", name: "m.png", mimeType: "image/png" })
          : undefined,
      getReadStream: async () => ({
        stream: Readable.from([Buffer.from(png)]),
        meta: { mimeType: "image/png" },
      }),
    };
    // 注册 attachment completion provider,使 @attachment: 在提交期改写为标记
    // (与生产路径一致);物化同时从原文 token 与标记收集 id。
    const { handler, session } = setup({ attachmentStore: store });
    await handler(
      post("/sessions/sess-1/messages", {
        message: "describe @attachment:att_m please",
      }),
    );
    const prompt = session.calls.find((c) => c.method === "prompt");
    const options = prompt?.args[1] as {
      images?: { type: string; data: string; mimeType: string }[];
    };
    expect(options.images).toEqual([
      { type: "image", data: b64, mimeType: "image/png" },
    ]);
  });

  it("non-image attachmentIds → no materialised images, text ref remains", async () => {
    const { Readable } = await import("node:stream");
    const store: AttachmentMetaSource = {
      head: async (id) =>
        id === "att_pdf"
          ? att({
              id: "att_pdf",
              name: "doc.pdf",
              mimeType: "application/pdf",
            })
          : undefined,
      getReadStream: async () => ({
        stream: Readable.from([Buffer.from("%PDF")]),
        meta: { mimeType: "application/pdf" },
      }),
    };
    const { handler, session } = setup({ attachmentStore: store });
    await handler(
      post("/sessions/sess-1/messages", {
        message: "read this",
        attachmentIds: ["att_pdf"],
      }),
    );
    const prompt = session.calls.find((c) => c.method === "prompt");
    const text = prompt?.args[0] as string;
    const options = prompt?.args[1] as { images?: unknown[] } | undefined;
    expect(text).toContain(
      "[attachment id=att_pdf type=application/pdf name=doc.pdf]",
    );
    expect(options?.images).toBeUndefined();
  });

  it("client images + same attachment data → no duplicate images", async () => {
    const { Readable } = await import("node:stream");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const b64 = Buffer.from(png).toString("base64");
    const store: AttachmentMetaSource = {
      head: async (id) =>
        id === "att_a"
          ? att({ id: "att_a", name: "a.png", mimeType: "image/png" })
          : undefined,
      getReadStream: async () => ({
        stream: Readable.from([Buffer.from(png)]),
        meta: { mimeType: "image/png" },
      }),
    };
    const clientImage = {
      type: "image" as const,
      data: b64,
      mimeType: "image/png",
    };
    const { handler, session } = setup({ attachmentStore: store });
    await handler(
      post("/sessions/sess-1/messages", {
        message: "with both",
        attachmentIds: ["att_a"],
        images: [clientImage],
      }),
    );
    const prompt = session.calls.find((c) => c.method === "prompt");
    const options = prompt?.args[1] as { images?: unknown[] };
    expect(options.images).toEqual([clientImage]);
  });

  // ── RpcResponse success:false 传播(pi-clouds #23 遮蔽层)────────────────
  // 曾经这些端点无条件 ack 200,把 pi 的 preflight 拒绝(如模型不可用)吞成"命令已接受但
  // 沙箱毫无反应"的黑洞。现在按 success 分流,失败→502 且错误文本上浮。
  function failWith(error: string): (m: string) => RpcResponse {
    return (command) =>
      ({ type: "response", id: "1", command, success: false, error }) as RpcResponse;
  }

  it.each([
    ["messages", { message: "hi" }],
    ["steer", { message: "s" }],
    ["follow_up", { message: "f" }],
    ["models", { provider: "dashscope", modelId: "qwen" }],
    ["thinking", { level: "medium" }],
    ["abort", undefined],
  ] as const)("%s upstream success:false → 502 with error text", async (path, body) => {
    const { handler, session } = setup();
    session.setResponse(failWith("No API key found for the selected model"));
    const res = await handler(post(`/sessions/sess-1/${path}`, body));
    expect(res.status).toBe(502);
    const err = (await res.json()) as { error?: { message?: string } };
    expect(JSON.stringify(err)).toContain("No API key found for the selected model");
  });

  it("success:true 仍然 ack 200(零回归)", async () => {
    const { handler } = setup();
    const res = await handler(post("/sessions/sess-1/models", {
      provider: "dashscope",
      modelId: "qwen",
    }));
    expect(res.status).toBe(200);
  });

  // ── 模型切换路径变更(Req 3.7/3.8)────────────────────────────────────
  it("POST /sessions/:id/models switches the model (new path)", async () => {
    const { handler, session } = setup();
    const res = await handler(
      post("/sessions/sess-1/models", { provider: "p", modelId: "m" }),
    );
    expect(res.status).toBe(200);
    expect(session.calls.some((c) => c.method === "setModel")).toBe(true);
  });

  it("POST /sessions/:id/model (old path) is not silently 404 — tells caller it moved", async () => {
    const { handler, session } = setup();
    const res = await handler(
      post("/sessions/sess-1/model", { provider: "p", modelId: "m" }),
    );
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("ENDPOINT_MOVED");
    expect(body.error?.message).toContain("/sessions/:id/models");
    // 未转发到会话——旧路径不是"改写语义后转发",而是拒绝并指路。
    expect(session.calls.some((c) => c.method === "setModel")).toBe(false);
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
