/**
 * 集成:POST /sessions/:id/attachments 上传端点 handler(attachment-store task 3.1)。
 *
 * 覆盖(Req 3.1/3.2/3.3/3.4):
 *  - 带文件 multipart → 200 + 描述符 origin=upload + sessionId + displayUrl;字节落库可经签名 URL 读回。
 *  - 无有效文件部分 → 400(NO_FILE)。
 *  - 超大小上限 → 413(客户端错误,不全量入内存)。
 *  - 经完整 createPiWebHandler 装配:会话不存在 → 404;越权 → 403;未鉴权 → 401(复用 Router 既有门控)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import type { AuthContext } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  attachmentStoreConfigFromEnv,
  type AttachmentStore,
} from "../../src/attachment/index.js";
import { makeUploadAttachmentHandler } from "../../src/http/routes/attachment-routes.js";
import { asPiSession, MockSession } from "./helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `attach-upload-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeStore(): AttachmentStore {
  return attachmentStoreConfigFromEnv({
    PI_WEB_ATTACHMENT_DIR: tmpDir,
    PI_WEB_ATTACHMENT_SECRET: "test-secret-stable",
  }).store;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function uploadRequest(
  sessionId: string,
  body: FormData | string,
  init: RequestInit = {},
): Request {
  return new Request(`http://x/sessions/${sessionId}/attachments`, {
    method: "POST",
    body,
    ...init,
  });
}

// ─── 直接调用 handler(隔离;会话门控由 Router 提供,此处直接给 ctx.sessionId) ──────

describe("makeUploadAttachmentHandler (isolated)", () => {
  it("带文件 → 200 + 描述符 origin=upload + sessionId + 可读回字节", async () => {
    const store = makeStore();
    const handler = makeUploadAttachmentHandler(store);

    const fd = new FormData();
    const bytes = new TextEncoder().encode("hello attachment");
    fd.append("file", new Blob([bytes], { type: "text/plain" }), "note.txt");

    const res = await handler({
      req: uploadRequest("sess-1", fd),
      sessionId: "sess-1",
      auth: { anonymous: true } as AuthContext,
      url: new URL("http://x/sessions/sess-1/attachments"),
    });

    expect(res.status).toBe(200);
    const body = await readJson(res);
    const attachment = body["attachment"] as Record<string, unknown>;
    expect(attachment).toBeDefined();
    expect(String(attachment["id"]).startsWith("att_")).toBe(true);
    expect(attachment["origin"]).toBe("upload");
    expect(attachment["sessionId"]).toBe("sess-1");
    expect(attachment["name"]).toBe("note.txt");
    expect(attachment["mimeType"]).toBe("text/plain");
    expect(attachment["size"]).toBe(bytes.byteLength);
    expect(typeof body["displayUrl"]).toBe("string");
    expect(String(body["displayUrl"])).toContain(String(attachment["id"]));

    // 描述符已落库:可经门面 head 取回 origin=upload + sessionId。
    const persisted = await store.head(String(attachment["id"]));
    expect(persisted?.origin).toBe("upload");
    expect(persisted?.sessionId).toBe("sess-1");

    // 字节已落盘:经 getReadStream 读回一致内容。
    const { stream } = await store.getReadStream(String(attachment["id"]));
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello attachment");
  });

  it("无文件部分 → 400 NO_FILE,不落空对象", async () => {
    const store = makeStore();
    const handler = makeUploadAttachmentHandler(store);

    const fd = new FormData();
    fd.append("notafile", "just text");

    const res = await handler({
      req: uploadRequest("sess-1", fd),
      sessionId: "sess-1",
      auth: { anonymous: true } as AuthContext,
      url: new URL("http://x/sessions/sess-1/attachments"),
    });

    expect(res.status).toBe(400);
    const body = await readJson(res);
    const err = body["error"] as Record<string, unknown>;
    expect(err?.["code"]).toBe("NO_FILE");
    // 未落库任何描述符。
    expect(await store.listBySession("sess-1")).toHaveLength(0);
  });

  it("Content-Length 超上限 → 413,提前拒绝(不读 body)", async () => {
    const store = makeStore();
    const handler = makeUploadAttachmentHandler(store, { maxBytes: 16 });

    const res = await handler({
      req: uploadRequest("sess-1", "x", {
        headers: { "Content-Length": "9999" },
      }),
      sessionId: "sess-1",
      auth: { anonymous: true } as AuthContext,
      url: new URL("http://x/sessions/sess-1/attachments"),
    });

    expect(res.status).toBe(413);
    expect(await store.listBySession("sess-1")).toHaveLength(0);
  });

  it("文件实际超上限 → 413(Content-Length 缺失时按文件大小拒绝)", async () => {
    const store = makeStore();
    const handler = makeUploadAttachmentHandler(store, { maxBytes: 4 });

    const fd = new FormData();
    fd.append(
      "file",
      new Blob([new TextEncoder().encode("way too big")], { type: "text/plain" }),
      "big.txt",
    );

    const res = await handler({
      req: uploadRequest("sess-1", fd),
      sessionId: "sess-1",
      auth: { anonymous: true } as AuthContext,
      url: new URL("http://x/sessions/sess-1/attachments"),
    });

    expect(res.status).toBe(413);
    expect(await store.listBySession("sess-1")).toHaveLength(0);
  });
});

// ─── resolveWriteBackend 注入(agent-attachment-profile spec,Req 3.1) ────────────

describe("makeUploadAttachmentHandler — resolveWriteBackend 注入", () => {
  async function makeTopologyStore(): Promise<{ store: AttachmentStore; dirB: string }> {
    const dirB = join(tmpDir, "secondary");
    await fs.mkdir(dirB, { recursive: true });
    const topology = JSON.stringify({
      backends: [
        { kind: "local-fs", name: "primary", dir: tmpDir },
        { kind: "local-fs", name: "secondary", dir: dirB },
      ],
      write: "primary",
    });
    const { store } = attachmentStoreConfigFromEnv({
      PI_WEB_ATTACHMENT_DIR: tmpDir,
      PI_WEB_ATTACHMENT_SECRET: "test-secret-stable",
      PI_WEB_ATTACHMENT_BACKENDS: topology,
    });
    return { store, dirB };
  }

  it("注入生效:resolver 返回的后端名写进 PutInput.writeBackend,描述符固化该名", async () => {
    const { store } = await makeTopologyStore();
    const handler = makeUploadAttachmentHandler(store, {
      resolveWriteBackend: (sessionId) => (sessionId === "sess-profile" ? "secondary" : undefined),
    });

    const fd = new FormData();
    fd.append("file", new Blob([new TextEncoder().encode("hi")], { type: "text/plain" }), "a.txt");
    const res = await handler({
      req: uploadRequest("sess-profile", fd),
      sessionId: "sess-profile",
      auth: { anonymous: true } as AuthContext,
      url: new URL("http://x/sessions/sess-profile/attachments"),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const attachment = body["attachment"] as Record<string, unknown>;
    expect(attachment["backend"]).toBe("secondary");
  });

  it("回落两态:resolver 返回 undefined → 走宿主默认写路由(不注入 resolver 同样回落)", async () => {
    const { store } = await makeTopologyStore();
    const handlerWithResolverUndefined = makeUploadAttachmentHandler(store, {
      resolveWriteBackend: () => undefined,
    });
    const handlerWithoutResolver = makeUploadAttachmentHandler(store);

    for (const handler of [handlerWithResolverUndefined, handlerWithoutResolver]) {
      const fd = new FormData();
      fd.append("file", new Blob([new TextEncoder().encode("hi")], { type: "text/plain" }), "a.txt");
      const res = await handler({
        req: uploadRequest("sess-default", fd),
        sessionId: "sess-default",
        auth: { anonymous: true } as AuthContext,
        url: new URL("http://x/sessions/sess-default/attachments"),
      });
      expect(res.status).toBe(200);
      const body = await readJson(res);
      const attachment = body["attachment"] as Record<string, unknown>;
      expect(attachment["backend"]).toBe("primary");
    }
  });
});

// ─── 完整 handler 装配(复用 Router :id 会话解析 + 鉴权门控) ──────────────────

function makeAssembledHandler(opts: {
  store: AttachmentStore;
  sessionId?: string;
  auth?: AuthContext;
  authorizeSession?: (a: { sessionId: string }) => boolean;
}) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  if (opts.sessionId !== undefined) {
    store.create(asPiSession(new MockSession(opts.sessionId)));
  }
  return createPiWebHandler({
    manager,
    store,
    routes: [
      {
        method: "POST",
        path: "/sessions/:id/attachments",
        handler: makeUploadAttachmentHandler(opts.store),
      },
    ],
    authResolver: () => opts.auth ?? { anonymous: true },
    ...(opts.authorizeSession !== undefined
      ? { authorizeSession: (a) => opts.authorizeSession!({ sessionId: a.sessionId }) }
      : {}),
  });
}

describe("POST /sessions/:id/attachments (full assembly gating)", () => {
  it("会话存在 + 带文件 → 200 origin=upload", async () => {
    const attachStore = makeStore();
    const handler = makeAssembledHandler({ store: attachStore, sessionId: "sess-1" });

    const fd = new FormData();
    fd.append(
      "file",
      new Blob([new TextEncoder().encode("hi")], { type: "text/plain" }),
      "a.txt",
    );
    const res = await handler(uploadRequest("sess-1", fd));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const attachment = body["attachment"] as Record<string, unknown>;
    expect(attachment["origin"]).toBe("upload");
    expect(attachment["sessionId"]).toBe("sess-1");
  });

  it("会话不存在 → 404(Router 门控,handler 未被命中)", async () => {
    const attachStore = makeStore();
    const handler = makeAssembledHandler({ store: attachStore /* 无 session */ });

    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([1])]), "a.bin");
    const res = await handler(uploadRequest("nope", fd));
    expect(res.status).toBe(404);
    // 未落库。
    expect(await attachStore.listBySession("nope")).toHaveLength(0);
  });

  it("越权 → 403(authorizeSession 拒绝)", async () => {
    const attachStore = makeStore();
    const handler = makeAssembledHandler({
      store: attachStore,
      sessionId: "sess-1",
      authorizeSession: () => false,
    });

    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([1])]), "a.bin");
    const res = await handler(uploadRequest("sess-1", fd));
    expect(res.status).toBe(403);
    expect(await attachStore.listBySession("sess-1")).toHaveLength(0);
  });

  it("未鉴权 → 401(authResolver 拒绝)", async () => {
    const attachStore = makeStore();
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    store.create(asPiSession(new MockSession("sess-1")));
    const handler = createPiWebHandler({
      manager,
      store,
      routes: [
        {
          method: "POST",
          path: "/sessions/:id/attachments",
          handler: makeUploadAttachmentHandler(attachStore),
        },
      ],
      authResolver: () => ({ reject: 401 }),
    });

    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([1])]), "a.bin");
    const res = await handler(uploadRequest("sess-1", fd));
    expect(res.status).toBe(401);
  });
});
