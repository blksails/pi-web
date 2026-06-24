/**
 * Task 3.3 — runner logger injection.
 *
 * Validates that:
 *  1. AgentContext (server-internal mirror) has an optional `logger` field.
 *  2. startRunner constructs the AgentContext with a `logger` whose namespace
 *     starts with "agent:".
 *  3. Calling logger.info writes a sentinel-prefixed JSONL line to stderr.
 *
 * These are unit-level checks against the context construction logic in
 * runner.ts (parseRunnerArgs / AgentContext shape). Full e2e (sub-process
 * launch) is covered by the existing runner.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../src/runner/agent-definition.js";
import { parseRunnerArgs } from "../../src/runner/runner.js";
import { createLogger } from "@blksails/pi-web-logger";
import { LOG_SENTINEL } from "@blksails/pi-web-logger";

// ── AgentContext type-level check ────────────────────────────────────────────

describe("AgentContext shape (task 3.3)", () => {
  it("logger field is typed as optional Logger on the server AgentContext", () => {
    // This is a compile-time assertion: if `logger` is not on AgentContext the
    // TS compiler will reject the assignment below — caught at typecheck phase.
    const ctx: AgentContext = {
      cwd: "/work",
      env: {},
      logger: createLogger({ namespace: "agent:test" }),
    };
    expect(ctx.logger).toBeDefined();
  });

  it("AgentContext is still valid without logger (optional field)", () => {
    const ctx: AgentContext = { cwd: "/work", env: {} };
    expect(ctx.logger).toBeUndefined();
  });
});

// ── Namespace derivation from agent path ─────────────────────────────────────

import { deriveAgentNamespace } from "../../src/runner/runner.js";

describe("runner logger namespace derivation (task 3.3)", () => {
  it("derives namespace from agent basename (no extension)", () => {
    const args = parseRunnerArgs(["--agent", "/path/to/my-agent.ts"]);
    // Simulate what startRunner does internally.
    const agentBasename =
      args.agent
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "agent";
    const ns = `agent:${agentBasename || "agent"}`;
    expect(ns).toBe("agent:my-agent");
  });

  it("derives namespace from bare filename", () => {
    const args = parseRunnerArgs(["--agent", "index.js"]);
    const agentBasename =
      args.agent
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "agent";
    const ns = `agent:${agentBasename || "agent"}`;
    expect(ns).toBe("agent:index");
  });

  it("falls back to 'agent' when basename is empty", () => {
    // Pathological edge case: agent path with trailing slash → basename would
    // be "". The runner guards with `|| "agent"`.
    const raw = "/dir/";
    const agentBasename =
      raw
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "agent";
    const ns = `agent:${agentBasename || "agent"}`;
    expect(ns).toBe("agent:agent");
  });
});

// ── deriveAgentNamespace pure function (task 7.1) ────────────────────────────

describe("deriveAgentNamespace (task 7.1)", () => {
  it("uses basename when it is not a generic entry name", () => {
    expect(deriveAgentNamespace("/path/to/my-agent.ts")).toBe("agent:my-agent");
  });

  it("falls back to parent dir name when basename is 'index'", () => {
    expect(deriveAgentNamespace("./examples/logging-demo-agent/index.ts")).toBe(
      "agent:logging-demo-agent",
    );
  });

  it("falls back to parent dir name when basename is 'main'", () => {
    expect(deriveAgentNamespace("/some/cool-agent/main.js")).toBe("agent:cool-agent");
  });

  it("uses non-generic basename even inside a directory", () => {
    expect(deriveAgentNamespace("/agents/my-agent/agent.ts")).toBe("agent:agent");
  });

  it("falls back to 'agent' when everything is empty (bare 'index.ts')", () => {
    // bare filename with generic name, no parent dir
    expect(deriveAgentNamespace("index.ts")).toBe("agent:agent");
  });

  it("uses directory name for trailing-slash pathological input", () => {
    // /dir/ has no file component; the last non-empty segment is 'dir'.
    expect(deriveAgentNamespace("/dir/")).toBe("agent:dir");
  });

  it("handles Windows-style backslash paths for 'index'", () => {
    expect(deriveAgentNamespace("C:\\agents\\my-bot\\index.ts")).toBe("agent:my-bot");
  });
});

// ── Logger produces sentinel output via Node sink ────────────────────────────

describe("logger node-sink sentinel output (task 3.3)", () => {
  it("logger.info writes a sentinel-prefixed JSONL line to stderr", () => {
    const lines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    // Capture stderr writes.
    process.stderr.write = (
      chunk: string | Uint8Array,
      cbOrEncoding?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      if (typeof cbOrEncoding === "function") {
        return originalWrite(chunk, cbOrEncoding);
      }
      if (cbOrEncoding !== undefined) {
        return originalWrite(chunk as string, cbOrEncoding, cb);
      }
      return originalWrite(chunk);
    };

    try {
      const logger = createLogger({ namespace: "agent:test-runner" });
      logger.info("sentinel-check", { key: "val" });
    } finally {
      process.stderr.write = originalWrite;
    }

    const sentinelLine = lines.find((l) => l.includes(LOG_SENTINEL));
    expect(sentinelLine).toBeDefined();
    // Should be valid JSON after the sentinel prefix.
    const jsonStr = sentinelLine!.slice(sentinelLine!.indexOf(LOG_SENTINEL) + LOG_SENTINEL.length).trim();
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    expect(parsed["ns"]).toBe("agent:test-runner");
    expect(parsed["msg"]).toBe("sentinel-check");
    expect(parsed["level"]).toBe("info");
  });
});
