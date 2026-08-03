/**
 * 装配:create-handler 注册 catalog provider(注入会话访问器)+ 挂物化路由
 * (spec agent-attachment-catalog,任务 4.3;Req 2.1, 3.2)。
 *
 * 用完整 `createPiWebHandler` 断言 provider 与路由**可达**(经真实 HTTP 请求往返),而非
 * 直接调内部工厂——这正是本任务要验证的接线点。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttachmentCatalogResultFrame } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { attachmentStoreConfigFromEnv, type AttachmentStore } from "../../src/attachment/index.js";
import { asPiSession, MockSession } from "./helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `att-catalog-assembly-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeAttachmentStore(): AttachmentStore {
  return attachmentStoreConfigFromEnv({
    PI_WEB_ATTACHMENT_DIR: tmpDir,
    PI_WEB_ATTACHMENT_SECRET: "test-secret-stable",
  }).store;
}

class CatalogMockSession extends MockSession {
  attachmentCatalogAvailable = true;
  listResult: AttachmentCatalogResultFrame = {
    type: "piweb_attachment_catalog_result",
    id: "req-1",
    ok: true,
    entries: [{ id: "entry-1", name: "Report" }],
  };
  materializeResult: AttachmentCatalogResultFrame = {
    type: "piweb_attachment_catalog_result",
    id: "req-1",
    ok: true,
    attachmentId: "att_placeholder",
  };

  requestCatalog(
    req: { op: "list"; query: string } | { op: "materialize"; entryId: string },
  ): Promise<AttachmentCatalogResultFrame> {
    return Promise.resolve(req.op === "list" ? this.listResult : this.materializeResult);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

describe("create-handler 装配 — catalog provider + 物化路由可达(Req 2.1/3.2)", () => {
  it("附件门面具备 presignUrl:completion 端点含 catalog 分组;materialize 端点可达并 200", async () => {
    const attachmentStore = makeAttachmentStore();
    const att = await attachmentStore.put({
      bytes: new Uint8Array([1]),
      name: "x.bin",
      mimeType: "application/octet-stream",
      size: 1,
      sessionId: "sess-1",
      origin: "tool-output",
    });

    const sessionStore = new InMemorySessionStore(true);
    const manager = new SessionManager({ store: sessionStore, idleMs: 0 });
    const session = new CatalogMockSession("sess-1");
    session.materializeResult = {
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: true,
      attachmentId: att.id,
    };
    sessionStore.create(asPiSession(session));

    const handler = createPiWebHandler({
      manager,
      store: sessionStore,
      attachmentStore,
    });

    // completion 端点可达,candidates 含 kind:"catalog"(provider 注册生效)。
    const completionRes = await handler(
      new Request("http://x/sessions/sess-1/completion?trigger=@&q="),
    );
    expect(completionRes.status).toBe(200);
    const completionBody = await readJson(completionRes);
    const items = completionBody["items"] as Array<{ kind: string }>;
    expect(items.some((i) => i.kind === "catalog")).toBe(true);

    // 物化端点可达并 200。
    const materializeRes = await handler(
      new Request("http://x/sessions/sess-1/attachment-catalog/entry-1/materialize", {
        method: "POST",
      }),
    );
    expect(materializeRes.status).toBe(200);
    const materializeBody = await readJson(materializeRes);
    expect(materializeBody["attachmentId"]).toBe(att.id);
  });

  it("未注入附件门面:completion 端点不含 catalog 分组;物化端点 404(未挂载)", async () => {
    const sessionStore = new InMemorySessionStore(true);
    const manager = new SessionManager({ store: sessionStore, idleMs: 0 });
    const session = new CatalogMockSession("sess-1");
    sessionStore.create(asPiSession(session));

    const handler = createPiWebHandler({ manager, store: sessionStore });

    const completionRes = await handler(
      new Request("http://x/sessions/sess-1/completion?trigger=@&q="),
    );
    const completionBody = await readJson(completionRes);
    const items = completionBody["items"] as Array<{ kind: string }>;
    expect(items.some((i) => i.kind === "catalog")).toBe(false);

    const materializeRes = await handler(
      new Request("http://x/sessions/sess-1/attachment-catalog/entry-1/materialize", {
        method: "POST",
      }),
    );
    expect(materializeRes.status).toBe(404);
  });

  it("附件门面无 presignUrl(head-only):catalog provider/路由均不挂载", async () => {
    const attachmentStore = makeAttachmentStore();
    const sessionStore = new InMemorySessionStore(true);
    const manager = new SessionManager({ store: sessionStore, idleMs: 0 });
    const session = new CatalogMockSession("sess-1");
    sessionStore.create(asPiSession(session));

    const handler = createPiWebHandler({
      manager,
      store: sessionStore,
      // head-only 门面:无 listBySession/presignUrl(messages handler 窄契约)。
      attachmentStore: { head: (id) => attachmentStore.head(id) },
    });

    const materializeRes = await handler(
      new Request("http://x/sessions/sess-1/attachment-catalog/entry-1/materialize", {
        method: "POST",
      }),
    );
    expect(materializeRes.status).toBe(404);
  });
});
