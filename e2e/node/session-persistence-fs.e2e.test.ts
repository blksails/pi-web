/**
 * Node-e2e — session persistence + cold resume on the FILE (fs JSONL) backend.
 * Sets SESSION_STORE=fs + a temp root BEFORE importing the route singleton.
 */
import { afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-fs-"));
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
process.env.SESSION_STORE = "fs";
process.env.SESSION_STORE_ROOT = root;

const route = await import("@/app/api/sessions/[[...path]]/route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");
const { runSessionPersistenceSuite } = await import(
  "./_session-persistence-suite.js"
);

afterAll(async () => {
  await shutdownHandler();
});

runSessionPersistenceSuite(route, "fs");
