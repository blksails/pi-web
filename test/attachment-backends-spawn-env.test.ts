// @vitest-environment node
/**
 * Integration: multi-backend topology spawn-env passthrough in
 * `lib/app/pi-handler.ts` (attachment-backend-pluggable spec, task 6.2; Req 6.1).
 *
 * Proves that when `PI_WEB_ATTACHMENT_BACKENDS` is configured, the main-process
 * handler downstreams BOTH the topology raw text AND every referenced credential
 * env var into the child spawn env (on top of the existing DIR/SECRET/URL_BASE
 * passthrough), so a future runner child can rebuild the same union backend.
 *
 * Mirrors `test/attachment-spawn-env.test.ts`'s capture technique (spy on
 * `PiRpcProcess`) but pins a two-backend (local-fs + s3) topology BEFORE
 * importing the handler, and removes the env vars after the singleton is built
 * so only explicit injection from the captured passthroughEnv can satisfy the
 * assertions (same anti-inheritance discipline as the existing spawn-env test).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-backends-spawnenv-test-"));
const SECRET = "backends-spawn-env-stable-secret-0123456789";
const TOPOLOGY = JSON.stringify({
  backends: [
    { kind: "local-fs", name: "local" },
    {
      kind: "s3",
      name: "cold",
      bucket: "pi-attach-test",
      accessKeyEnv: "PI_TEST_S3_AK",
      secretKeyEnv: "PI_TEST_S3_SK",
    },
  ],
  write: "local",
});

process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = SECRET;
process.env.PI_WEB_ATTACHMENT_BACKENDS = TOPOLOGY;
process.env.PI_TEST_S3_AK = "test-access-key-value";
process.env.PI_TEST_S3_SK = "test-secret-key-value";
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

type CapturedSpec = { env?: Record<string, string>; args: string[] };
const capturedSpecs: CapturedSpec[] = [];
vi.mock("@blksails/pi-web-server", async () => {
  const actual =
    await vi.importActual<typeof import("@blksails/pi-web-server")>("@blksails/pi-web-server");
  const RealPiRpcProcess = actual.PiRpcProcess as unknown as new (
    spec: CapturedSpec,
  ) => object;
  class SpyPiRpcProcess extends RealPiRpcProcess {
    constructor(spec: CapturedSpec) {
      capturedSpecs.push(spec);
      super(spec);
    }
  }
  return { ...actual, PiRpcProcess: SpyPiRpcProcess };
});

const { getHandler, shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
  rmSync(ATTACH_DIR, { recursive: true, force: true });
});

describe("pi-handler downstreams PI_WEB_ATTACHMENT_BACKENDS + referenced credentials (attachment-backend-pluggable, Req 6.1)", () => {
  beforeAll(async () => {
    const handler = getHandler();

    // Remove the topology + credential env vars so the stub spec's
    // `...process.env` cannot leak them; only explicit passthroughEnv injection
    // from the captured main-process config can satisfy the assertions now.
    delete process.env.PI_WEB_ATTACHMENT_BACKENDS;
    delete process.env.PI_TEST_S3_AK;
    delete process.env.PI_TEST_S3_SK;
    delete process.env.PI_WEB_ATTACHMENT_DIR;
    delete process.env.PI_WEB_ATTACHMENT_SECRET;

    const res = await handler(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
  }, 15000);

  it("spawn env contains the topology raw text AND both referenced credential vars", () => {
    expect(capturedSpecs.length).toBeGreaterThan(0);
    const spec = capturedSpecs[capturedSpecs.length - 1]!;
    expect(spec.env?.PI_WEB_ATTACHMENT_BACKENDS).toBe(TOPOLOGY);
    expect(spec.env?.PI_TEST_S3_AK).toBe("test-access-key-value");
    expect(spec.env?.PI_TEST_S3_SK).toBe("test-secret-key-value");
  });

  it("spawn env still contains DIR/SECRET/URL_BASE (existing passthrough unchanged)", () => {
    const spec = capturedSpecs[capturedSpecs.length - 1]!;
    expect(spec.env).toHaveProperty("PI_WEB_ATTACHMENT_DIR");
    expect(spec.env).toHaveProperty("PI_WEB_ATTACHMENT_SECRET");
    expect(spec.env?.PI_WEB_ATTACHMENT_URL_BASE).toBe("/api");
  });
});
