// @vitest-environment node
/**
 * Integration: attachment spawn-env passthrough in `lib/app/pi-handler.ts`
 * (task 5.2; Req 7.3, 7.4).
 *
 * Proves the main-process handler, when constructing the child spawn spec for a
 * session channel, threads BOTH the attachment storage-dir convention
 * `PI_WEB_ATTACHMENT_DIR` AND the signing secret `PI_WEB_ATTACHMENT_SECRET`
 * into the spawn env, and that their values equal the main-process attachment
 * store config (the same `attachmentStoreConfigFromEnv()` source the main store
 * is built from). This reserves the seam for a future runner child to share the
 * same local backend and keeps the HMAC secret consistent across main/child
 * (otherwise a child-produced tool-output `/raw` signed URL would 401 in main).
 *
 * The assertion is deliberately robust against accidental inheritance: the two
 * env vars are REMOVED from `process.env` after the singleton (and its store
 * config) is built, BEFORE the session-creation that drives the spawn. The stub
 * spawn spec spreads `...process.env`, so if the handler did NOT explicitly
 * inject the two vars from the captured main-process config, they would be
 * absent — making this a true RED before the implementation lands.
 *
 * Boundary: this slice ONLY downstreams the convention + secret via spawn env.
 * It does NOT instantiate a store in the child — asserted by the absence of any
 * store-construction flag/arg in the spawn args.
 *
 * The spawn spec is captured by mocking `PiRpcProcess` (whose constructor
 * receives the assembled `SpawnSpec`). A real session is created through the
 * stub-agent path, which drives `createChannel` → `new PiRpcProcess(spec)`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

// Pin env BEFORE importing the handler (config + store read env at first use).
const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-spawnenv-test-"));
const EXPECTED_SECRET = "spawn-env-stable-secret-fedcba9876543210";
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = EXPECTED_SECRET;
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

// Capture every SpawnSpec the handler hands to PiRpcProcess, while keeping all
// other @pi-web/server exports real (the handler relies on them).
type CapturedSpec = { env?: Record<string, string>; args: string[] };
const capturedSpecs: CapturedSpec[] = [];
vi.mock("@pi-web/server", async () => {
  const actual =
    await vi.importActual<typeof import("@pi-web/server")>("@pi-web/server");
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
const { attachmentStoreConfigFromEnv } = await import("@pi-web/server");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

// Expected values = the SAME source the main-process store is built from,
// captured while the env vars are still present.
let expectedDir: string;
let expectedSecret: string;

afterAll(async () => {
  await shutdownHandler();
  rmSync(ATTACH_DIR, { recursive: true, force: true });
});

describe("pi-handler downstreams attachment dir + secret via spawn env (task 5.2, Req 7.3/7.4)", () => {
  beforeAll(async () => {
    // Build the singleton (resolves the store config) while env is present.
    const handler = getHandler();
    const cfg = attachmentStoreConfigFromEnv();
    expectedDir = cfg.dir;
    expectedSecret = cfg.secret;

    // Remove the env vars so the stub spec's `...process.env` cannot leak them.
    // Only EXPLICIT injection from the captured main-process config can satisfy
    // the assertions now.
    delete process.env.PI_WEB_ATTACHMENT_DIR;
    delete process.env.PI_WEB_ATTACHMENT_SECRET;

    // Creating a session drives createChannel → new PiRpcProcess(spec).
    const res = await handler(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
  }, 15000);

  it("spawn env contains BOTH PI_WEB_ATTACHMENT_DIR and PI_WEB_ATTACHMENT_SECRET", () => {
    expect(capturedSpecs.length).toBeGreaterThan(0);
    const spec = capturedSpecs[capturedSpecs.length - 1]!;
    expect(spec.env).toBeDefined();
    expect(spec.env).toHaveProperty("PI_WEB_ATTACHMENT_DIR");
    expect(spec.env).toHaveProperty("PI_WEB_ATTACHMENT_SECRET");
  });

  it("spawn env values equal the main-process attachment config (dir + secret)", () => {
    const spec = capturedSpecs[capturedSpecs.length - 1]!;
    expect(spec.env?.PI_WEB_ATTACHMENT_DIR).toBe(expectedDir);
    expect(spec.env?.PI_WEB_ATTACHMENT_SECRET).toBe(expectedSecret);
  });

  it("child side instantiates NO store: spawn args carry no attachment store wiring (boundary)", () => {
    // This slice ONLY passes env down. No child-side store-construction flag or
    // arg is emitted; the two passthrough vars live in env, not args.
    const spec = capturedSpecs[capturedSpecs.length - 1]!;
    const argsJoined = spec.args.join(" ");
    expect(argsJoined).not.toMatch(/attachment-store|AttachmentStore|--attachment/i);
  });
});
