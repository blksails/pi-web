/**
 * 单元:makeMaterializeCatalogEntryHandler(spec agent-attachment-catalog,任务 4.2;
 * Req 3.2, 3.4, 5.4)。
 *
 * 覆盖全部状态分支:200 / 404(会话不存在,复用既有引擎错误映射)/ 404(ENTRY_NOT_FOUND)/
 * 502(CATALOG_ERROR)/ 504(CATALOG_TIMEOUT,env 覆盖生效)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttachmentCatalogResultFrame } from "@blksails/pi-web-protocol";
import {
  makeMaterializeCatalogEntryHandler,
  ATTACHMENT_CATALOG_TIMEOUT_ENV,
} from "../../src/http/routes/attachment-catalog-routes.js";
import type { AuthContext } from "../../src/http/index.js";
import { AttachmentCatalogTimeoutError } from "../../src/session/session.errors.js";
import { attachmentStoreConfigFromEnv, type AttachmentStore } from "../../src/attachment/index.js";
import type { SessionStore } from "../../src/session/index.js";
import { asPiSession, MockSession } from "./helpers.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `att-catalog-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env[ATTACHMENT_CATALOG_TIMEOUT_ENV];
});

function makeStore(): AttachmentStore {
  return attachmentStoreConfigFromEnv({
    PI_WEB_ATTACHMENT_DIR: tmpDir,
    PI_WEB_ATTACHMENT_SECRET: "test-secret-stable",
  }).store;
}

class CatalogMockSession extends MockSession {
  readonly requestCalls: Array<{
    req: { op: "list"; query: string } | { op: "materialize"; entryId: string };
    timeoutMs: number | undefined;
  }> = [];
  requestResult: AttachmentCatalogResultFrame | Error = {
    type: "piweb_attachment_catalog_result",
    id: "req-1",
    ok: true,
    attachmentId: "att_placeholder",
  };

  requestCatalog(
    req: { op: "list"; query: string } | { op: "materialize"; entryId: string },
    timeoutMs?: number,
  ): Promise<AttachmentCatalogResultFrame> {
    this.requestCalls.push({ req, timeoutMs });
    if (this.requestResult instanceof Error) return Promise.reject(this.requestResult);
    return Promise.resolve(this.requestResult);
  }
}

function fakeSessionStore(session: CatalogMockSession | undefined): SessionStore {
  return {
    get: () => (session !== undefined ? asPiSession(session) : undefined),
    create: () => {},
    delete: () => false,
    list: () => [],
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function materializeCtx(sessionId: string, entryId: string) {
  return {
    req: new Request(`http://x/sessions/${sessionId}/attachment-catalog/${entryId}/materialize`, {
      method: "POST",
    }),
    sessionId,
    auth: { anonymous: true } as AuthContext,
    url: new URL(`http://x/sessions/${sessionId}/attachment-catalog/${entryId}/materialize`),
  };
}

describe("makeMaterializeCatalogEntryHandler — 200(Req 3.2)", () => {
  it("成功物化 → 200 { attachmentId, attachment, displayUrl }", async () => {
    const attStore = makeStore();
    const att = await attStore.put({
      bytes: new Uint8Array([1, 2, 3]),
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 3,
      sessionId: "sess-1",
      origin: "tool-output",
    });
    const session = new CatalogMockSession("sess-1");
    session.requestResult = {
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: true,
      attachmentId: att.id,
    };
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(session), attStore);
    const res = await handler(materializeCtx("sess-1", "entry-1"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["attachmentId"]).toBe(att.id);
    expect((body["attachment"] as Record<string, unknown>)["id"]).toBe(att.id);
    expect(typeof body["displayUrl"]).toBe("string");

    expect(session.requestCalls).toEqual([
      { req: { op: "materialize", entryId: "entry-1" }, timeoutMs: 20_000 },
    ]);
  });
});

describe("makeMaterializeCatalogEntryHandler — 404(Req 3.4)", () => {
  it("会话不存在 → 404(既有引擎错误映射)", async () => {
    const attStore = makeStore();
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(undefined), attStore);
    const res = await handler(materializeCtx("ghost-session", "entry-1"));
    expect(res.status).toBe(404);
  });

  it("条目不存在(结果帧 ok:false, error.code=ENTRY_NOT_FOUND)→ 404 ENTRY_NOT_FOUND", async () => {
    const attStore = makeStore();
    const session = new CatalogMockSession("sess-1");
    session.requestResult = {
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: false,
      error: { code: "ENTRY_NOT_FOUND", message: "no such entry" },
    };
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(session), attStore);
    const res = await handler(materializeCtx("sess-1", "ghost-entry"));
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("ENTRY_NOT_FOUND");
  });
});

describe("makeMaterializeCatalogEntryHandler — 502(Req 3.4)", () => {
  it("结果帧 ok:false 且非 ENTRY_NOT_FOUND → 502 CATALOG_ERROR(含 handler message)", async () => {
    const attStore = makeStore();
    const session = new CatalogMockSession("sess-1");
    session.requestResult = {
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: false,
      error: { code: "CATALOG_ERROR", message: "resolve boom" },
    };
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(session), attStore);
    const res = await handler(materializeCtx("sess-1", "entry-1"));
    expect(res.status).toBe(502);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["message"]).toBe("resolve boom");
  });

  it("materialize 结果帧缺 attachmentId(ok:true 但无 id)→ 502", async () => {
    const attStore = makeStore();
    const session = new CatalogMockSession("sess-1");
    session.requestResult = { type: "piweb_attachment_catalog_result", id: "req-1", ok: true };
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(session), attStore);
    const res = await handler(materializeCtx("sess-1", "entry-1"));
    expect(res.status).toBe(502);
  });
});

describe("makeMaterializeCatalogEntryHandler — 504(Req 3.4;env 覆盖)", () => {
  it("requestCatalog 超时(AttachmentCatalogTimeoutError)→ 504", async () => {
    const attStore = makeStore();
    const session = new CatalogMockSession("sess-1");
    session.requestResult = new AttachmentCatalogTimeoutError("materialize", 20_000);
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(session), attStore);
    const res = await handler(materializeCtx("sess-1", "entry-1"));
    expect(res.status).toBe(504);
    const body = await readJson(res);
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("CATALOG_TIMEOUT");
  });

  it("env PI_WEB_ATTACHMENT_CATALOG_TIMEOUT_MS 覆盖默认超时值,原样传入 requestCatalog", async () => {
    process.env[ATTACHMENT_CATALOG_TIMEOUT_ENV] = "5000";
    const attStore = makeStore();
    const att = await attStore.put({
      bytes: new Uint8Array([1]),
      name: "x.bin",
      mimeType: "application/octet-stream",
      size: 1,
      sessionId: "sess-1",
      origin: "tool-output",
    });
    const session = new CatalogMockSession("sess-1");
    session.requestResult = {
      type: "piweb_attachment_catalog_result",
      id: "req-1",
      ok: true,
      attachmentId: att.id,
    };
    const handler = makeMaterializeCatalogEntryHandler(fakeSessionStore(session), attStore);
    await handler(materializeCtx("sess-1", "entry-1"));
    expect(session.requestCalls[0]?.timeoutMs).toBe(5000);
  });
});
