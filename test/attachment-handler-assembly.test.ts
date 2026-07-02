// @vitest-environment node
/**
 * Integration: attachment store assembly in `lib/app/pi-handler.ts` (task 5.1; Req 7.1).
 *
 * Proves the app handler instantiates the attachment store (via
 * `attachmentStoreConfigFromEnv`) and injects `createAttachmentRoutes(store)`
 * into `createPiWebHandler({ routes })`, so both endpoints are reachable under
 * `/api/**` through the singleton handler:
 *   - POST /api/sessions/:id/attachments  (multipart) → 200, store puts to disk
 *   - GET  /api/attachments/:id/raw?exp&sig → 200, returns the stored bytes
 *
 * Runs with the stub agent (offline + deterministic) to create a real session,
 * since the upload endpoint reuses the Router `:id` session gating. A dedicated
 * temp attachment dir + a stable secret are pinned via env BEFORE importing the
 * handler (config reads env at first use); the same handler then verifies the
 * signed distribution URL it just minted (single store instance, both paths).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

// Pin env BEFORE importing the handler (config + store read env at first use).
const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-attach-test-"));
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = "test-stable-secret-abcdef0123456789";
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

const { getHandler, shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
  rmSync(ATTACH_DIR, { recursive: true, force: true });
});

describe("pi-handler assembles attachment store + routes (task 5.1, Req 7.1)", () => {
  let sessionId: string;
  const handler = () => getHandler();

  beforeAll(async () => {
    const res = await handler()(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
    const body = (await res.json()) as { sessionId: string };
    sessionId = body.sessionId;
    expect(typeof sessionId).toBe("string");
  }, 15000);

  it("upload endpoint accepts multipart, stores to disk, returns descriptor + displayUrl (200)", async () => {
    const fileBytes = new TextEncoder().encode("hello-attachment-bytes");
    const form = new FormData();
    form.append(
      "file",
      new Blob([fileBytes], { type: "text/plain" }),
      "greeting.txt",
    );

    const res = await handler()(
      req(`/api/sessions/${sessionId}/attachments`, {
        method: "POST",
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attachment: { id: string; origin: string; sessionId: string };
      displayUrl: string;
    };
    expect(body.attachment.id).toMatch(/^att_/);
    expect(body.attachment.origin).toBe("upload");
    expect(body.attachment.sessionId).toBe(sessionId);
    // displayUrl is the signed distribution path, already prefixed with /api
    // (pi-handler assembles the store with urlBasePath:"/api"; frontend uses it as-is).
    expect(body.displayUrl).toMatch(
      /^\/api\/attachments\/.+\/raw\?exp=\d+&sig=[a-f0-9]+$/,
    );
  }, 15000);

  it("distribution endpoint returns stored bytes for a valid signed URL (200)", async () => {
    // Upload first, then fetch the minted signed URL through the SAME handler.
    const fileBytes = new TextEncoder().encode("round-trip-payload-xyz");
    const form = new FormData();
    form.append(
      "file",
      new Blob([fileBytes], { type: "application/octet-stream" }),
      "payload.bin",
    );
    const upRes = await handler()(
      req(`/api/sessions/${sessionId}/attachments`, {
        method: "POST",
        body: form,
      }),
    );
    expect(upRes.status).toBe(200);
    const { displayUrl } = (await upRes.json()) as { displayUrl: string };

    // displayUrl already carries the /api prefix (urlBasePath:"/api"); use it as-is.
    const rawRes = await handler()(
      req(displayUrl, { method: "GET" }),
    );
    expect(rawRes.status).toBe(200);
    const out = new Uint8Array(await rawRes.arrayBuffer());
    expect(new TextDecoder().decode(out)).toBe("round-trip-payload-xyz");
  }, 15000);

  it("distribution endpoint rejects an unsigned request (401, signature-gated)", async () => {
    // No exp/sig → 401 regardless of id existence (proves the raw route is the
    // attachment handler, not a generic miss / 404 from the session router).
    const res = await handler()(
      req(`/api/attachments/att_does_not_matter/raw`, { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });
});
