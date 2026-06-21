// @vitest-environment node
/**
 * Integration (verification-only): the storage env that `attachment-store`
 * downstreams via the runner-child spawn spec (task 5.2) is, in the child, a
 * fully sufficient input to `createChildAttachmentStore` (task 1.1) — i.e. the
 * runner child process is, in-process, handed `PI_WEB_ATTACHMENT_DIR` +
 * `PI_WEB_ATTACHMENT_SECRET`, and a child store built from THAT exact env
 * points at the SAME backend directory and shares the SAME signing secret as
 * the main process (task 1.2; Req 3.2).
 *
 * This closes the seam between two already-landed pieces:
 *   - task 5.2: `lib/app/pi-handler.ts` injects DIR+SECRET into the child spawn
 *     env (asserted in `attachment-spawn-env.test.ts`).
 *   - task 1.1: `createChildAttachmentStore(env)` reads DIR+SECRET from a
 *     `ProcessEnv` and instantiates the upstream `AttachmentStore` facade.
 *
 * task 1.2 proves they compose: feed the ACTUAL captured child spawn env into
 * `createChildAttachmentStore` and assert the resulting (child) store is
 * backend-identical to the main-process store —
 *   1. same dir: the child store's `localPath(id)` of a freshly-put attachment
 *      lives under the main-process attachment dir, and a same-dir main store
 *      reads back identical bytes by id (no main-process callback);
 *   2. consistent secret: the child store's `presignUrl()` `/raw` signature
 *      `verifyUrl()`s TRUE in the main store, and the main store's signature
 *      verifies in the child store (bidirectional cross-process check).
 *
 * Robustness against accidental inheritance (mirrors the 5.2 test): the two env
 * vars are DELETED from `process.env` after the main singleton/store config is
 * built, BEFORE the session-creation that drives the spawn. The captured child
 * env therefore can only contain the two vars if `pi-handler` EXPLICITLY
 * injected them from the captured main-process config — i.e. the same explicit
 * passthrough is the one that reaches the runner child in isolated/e2e builds
 * (where `process.env` does NOT carry the dev-default attachment vars). The
 * captured spawn env is the runner-child path's env; building a child store
 * from it is exactly what the in-child `createChildAttachmentStore(process.env)`
 * does at runtime.
 *
 * Boundary: assertion-only. This file introduces NO edit to the spawn-env
 * construction in `lib/app/pi-handler.ts` (the DIR+SECRET passthrough is owned
 * and downstreamed by attachment-store / task 5.2). It only OBSERVES the
 * captured child spawn env and composes it with the task-1.1 factory.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

// Pin env BEFORE importing the handler (config + store read env at first use).
const ATTACH_DIR = mkdtempSync(path.join(os.tmpdir(), "pi-web-childstore-test-"));
const EXPECTED_SECRET = "child-store-from-spawn-env-secret-0123456789abcdef";
process.env.PI_WEB_ATTACHMENT_DIR = ATTACH_DIR;
process.env.PI_WEB_ATTACHMENT_SECRET = EXPECTED_SECRET;
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

// Capture every SpawnSpec the handler hands to PiRpcProcess (the runner-child
// spawn), while keeping all other @pi-web/server exports real (the handler and
// the child-store factory both rely on them).
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
const {
  attachmentStoreConfigFromEnv,
  createChildAttachmentStore,
  ATTACHMENT_DIR_ENV,
  ATTACHMENT_SECRET_ENV,
} = await import("@pi-web/server");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const PUT = {
  bytes: new Uint8Array([1, 2, 3, 4, 5]),
  name: "child-from-spawn.bin",
  mimeType: "application/octet-stream",
  size: 5,
  sessionId: "sess-child-from-spawn",
  origin: "tool-output" as const,
};

// Expected values = the SAME source the main-process store is built from,
// captured while the env vars are still present.
let expectedDir: string;
let expectedSecret: string;
// The exact env handed to the runner child (captured from the spawn spec).
let childEnv: NodeJS.ProcessEnv;

afterAll(async () => {
  await shutdownHandler();
  rmSync(ATTACH_DIR, { recursive: true, force: true });
});

describe("runner-child spawn env composes with createChildAttachmentStore → backend-identical store (task 1.2, Req 3.2)", () => {
  beforeAll(async () => {
    // Build the singleton (resolves the store config) while env is present.
    const handler = getHandler();
    const cfg = attachmentStoreConfigFromEnv();
    expectedDir = cfg.dir;
    expectedSecret = cfg.secret;

    // Remove the env vars so the child spec's `...process.env` cannot leak them.
    // Only EXPLICIT injection from the captured main-process config can satisfy
    // the assertions now — i.e. the same passthrough that reaches the runner
    // child in isolated/e2e builds (no dev-default attachment vars in env).
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

    expect(capturedSpecs.length).toBeGreaterThan(0);
    const spec = capturedSpecs[capturedSpecs.length - 1]!;
    expect(spec.env).toBeDefined();
    // The runner child's in-process env — exactly what
    // `createChildAttachmentStore(process.env)` would read in the child.
    childEnv = spec.env as NodeJS.ProcessEnv;
  }, 15000);

  it("the runner child spawn env carries DIR + SECRET equal to the main attachment config", () => {
    // Precondition for task 1.1's factory: both storage vars are present in the
    // child env, and equal the main-process config (not leaked from process.env,
    // which was deleted above).
    expect(childEnv[ATTACHMENT_DIR_ENV]).toBe(expectedDir);
    expect(childEnv[ATTACHMENT_SECRET_ENV]).toBe(expectedSecret);
  });

  it("createChildAttachmentStore(childEnv) is available (the child path receives a usable store)", () => {
    // Env reached the child → factory yields a usable upstream facade (NOT the
    // env-missing `undefined` degraded path).
    const child = createChildAttachmentStore(childEnv);
    expect(child).toBeDefined();
  });

  it("child store points at the SAME dir as main: put → localPath under main dir, read-back consistent by id", async () => {
    const child = createChildAttachmentStore(childEnv)!;

    // Child put lands on the shared backend dir.
    const att = await child.put(PUT);
    expect(att.origin).toBe("tool-output");
    expect(att.id).toMatch(/^att_/);

    // localPath resolves under the MAIN-process attachment dir (same backend).
    await expect(child.localPath(att.id)).resolves.toBe(
      path.join(expectedDir, att.id),
    );

    // A main-process store (built from the same captured DIR+SECRET) reads the
    // child's bytes back by id — proves same backend, no main-process callback.
    const { store: main } = attachmentStoreConfigFromEnv(childEnv);
    const head = await main.head(att.id);
    expect(head?.id).toBe(att.id);
    const { stream, meta } = await main.getReadStream(att.id);
    expect(meta.size).toBe(5);
    expect([...(await readAll(stream))]).toEqual([1, 2, 3, 4, 5]);
  });

  it("consistent secret: child presignUrl verifies in main, and main presignUrl verifies in child (bidirectional)", async () => {
    const child = createChildAttachmentStore(childEnv)!;
    const { store: main } = attachmentStoreConfigFromEnv(childEnv);

    // child → main: a child-minted /raw signature verifies in the main process.
    const att = await child.put(PUT);
    const childUrl = await child.presignUrl(att.id);
    const cp = new URL(childUrl, "http://x").searchParams;
    expect(main.verifyUrl(att.id, Number(cp.get("exp")), cp.get("sig")!)).toBe(
      true,
    );

    // main → child: a main-minted signature verifies in the child store too,
    // confirming the shared secret is symmetric across the process boundary.
    const mainUrl = await main.presignUrl(att.id);
    const mp = new URL(mainUrl, "http://x").searchParams;
    expect(child.verifyUrl(att.id, Number(mp.get("exp")), mp.get("sig")!)).toBe(
      true,
    );
  });

  it("a mismatched-secret main process REJECTS the child's signature (the secret is load-bearing, not incidental)", async () => {
    const child = createChildAttachmentStore(childEnv)!;
    const att = await child.put(PUT);
    const childUrl = await child.presignUrl(att.id);
    const cp = new URL(childUrl, "http://x").searchParams;

    // Same dir, DIFFERENT secret → signature must fail. This proves the secret
    // passthrough (not merely the dir) is what makes the cross-process check
    // pass above; if pi-handler dropped SECRET, this would be the live behavior.
    const { store: wrong } = attachmentStoreConfigFromEnv({
      [ATTACHMENT_DIR_ENV]: expectedDir,
      [ATTACHMENT_SECRET_ENV]: "a-different-secret-than-the-child",
    });
    expect(
      wrong.verifyUrl(att.id, Number(cp.get("exp")), cp.get("sig")!),
    ).toBe(false);
  });
});
