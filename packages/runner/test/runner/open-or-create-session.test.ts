import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openOrCreateSession } from "../../src/runner/open-or-create-session.js";

const SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";
const originalSessionDir = process.env[SESSION_DIR_ENV];

afterEach(() => {
  if (originalSessionDir === undefined) delete process.env[SESSION_DIR_ENV];
  else process.env[SESSION_DIR_ENV] = originalSessionDir;
});

describe("openOrCreateSession", () => {
  it("让 pi runner 的写入目录跟随 PI_CODING_AGENT_SESSION_DIR", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-open-session-"));
    process.env[SESSION_DIR_ENV] = root;
    try {
      const result = await openOrCreateSession(join(root, "project"), "session-1");
      expect(result.isNewSession).toBe(true);
      expect(result.sessionManager.getSessionFile()).toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
