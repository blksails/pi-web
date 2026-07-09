/**
 * Node-e2e — session persistence + cold resume on the SQLITE backend.
 * Sets SESSION_STORE=sqlite + a temp db path BEFORE importing the route singleton.
 */
import { afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-sqlite-"));
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
process.env.SESSION_STORE = "sqlite";
process.env.SESSION_STORE_PATH = path.join(dir, "sessions.db");

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");
const { runSessionPersistenceSuite } = await import(
  "./_session-persistence-suite.js"
);

afterAll(async () => {
  await shutdownHandler();
});

runSessionPersistenceSuite(route, "sqlite");
