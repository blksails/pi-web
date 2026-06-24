import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AgentEventSchema, RpcResponseSchema } from "@blksails/protocol";

/**
 * Integration + e2e for the bootstrap runner (Req 7.2, 7.3, 6.1–6.3).
 *
 * The runner is spawned as a real subprocess:
 *   node --import jiti/register src/runner/runner.ts --agent <example> --cwd <tmp> --agent-dir <tmp>
 *
 * `--agent-dir` is pointed at an empty temp dir to isolate from the developer's
 * global ~/.pi resources, keeping frames deterministic.
 *
 * Without an API key we assert the non-LLM RPC round-trip (get_state /
 * get_commands), which still proves `runRpcMode` is live and serving frames
 * that pass the protocol schema. With a key we additionally assert a prompt
 * yields message_update(text_delta) + agent_end.
 */

const here = dirname(fileURLToPath(import.meta.url));
// test/runner -> packages/server
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
// The production real-mode entry: a cwd-independent bootstrap that constructs
// jiti itself (no `--import jiti/register`). It must boot even when spawned from
// the agent's working directory, which has no node_modules.
const bootstrapEntry = join(serverPkgDir, "runner-bootstrap.mjs");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "hello-agent");

const hasApiKey =
  typeof process.env.ANTHROPIC_API_KEY === "string" &&
  process.env.ANTHROPIC_API_KEY.length > 0;

interface RunnerHandle {
  proc: ChildProcessWithoutNullStreams;
  frames: unknown[];
  stderr: () => string;
  send: (cmd: object) => void;
  waitForFrame: (
    predicate: (frame: unknown) => boolean,
    timeoutMs?: number,
  ) => Promise<unknown>;
  dispose: () => void;
}

interface LaunchOptions {
  /**
   * "jiti" → legacy `node --import jiti/register <runner.ts>` (spawned with
   *   cwd=serverPkgDir so jiti resolves);
   * "bootstrap" → production entry `node <runner-bootstrap.mjs>` spawned with
   *   cwd=<agent work dir> to prove cwd-independent module resolution.
   */
  mode?: "jiti" | "bootstrap";
}

function launchRunner(opts: LaunchOptions = {}): RunnerHandle {
  const mode = opts.mode ?? "jiti";
  const cwd = mkdtempSync(join(tmpdir(), "runner-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "runner-agentdir-"));
  const runnerArgs = ["--agent", exampleAgent, "--cwd", cwd, "--agent-dir", agentDir];
  const spawnArgs =
    mode === "bootstrap"
      ? [bootstrapEntry, ...runnerArgs]
      : ["--import", "jiti/register", runnerEntry, ...runnerArgs];
  const proc = spawn(process.execPath, spawnArgs, {
    // bootstrap is cwd-independent: run it from the agent's work dir (which has
    // no node_modules) to exercise the real-mode failure mode that caused 404s.
    cwd: mode === "bootstrap" ? cwd : serverPkgDir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const frames: unknown[] = [];
  let stdoutBuf = "";
  let stderrBuf = "";

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.length > 0) {
        frames.push(JSON.parse(line));
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });

  const send = (cmd: object): void => {
    proc.stdin.write(`${JSON.stringify(cmd)}\n`);
  };

  const waitForFrame = (
    predicate: (frame: unknown) => boolean,
    timeoutMs = 30000,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const existing = frames.find(predicate);
      if (existing !== undefined) {
        resolve(existing);
        return;
      }
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(
          new Error(
            `Timed out waiting for frame.\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`,
          ),
        );
      }, timeoutMs);
      const onData = (): void => {
        const match = frames.find(predicate);
        if (match !== undefined) {
          clearTimeout(timer);
          proc.stdout.off("data", onData);
          resolve(match);
        }
      };
      proc.stdout.on("data", onData);
    });

  return {
    proc,
    frames,
    stderr: () => stderrBuf,
    send,
    waitForFrame,
    dispose: () => {
      proc.stdin.end();
      proc.kill("SIGKILL");
    },
  };
}

/** A frame validates if it parses against either protocol schema. */
function validateFrame(frame: unknown): boolean {
  return (
    RpcResponseSchema.safeParse(frame).success ||
    AgentEventSchema.safeParse(frame).success
  );
}

describe("runner subprocess — boot + non-LLM RPC round-trip (Req 7.2, 6.3)", () => {
  let handle: RunnerHandle | undefined;
  afterEach(() => {
    handle?.dispose();
    handle = undefined;
  });

  it("boots, loads the example, enters runRpcMode and answers get_state (no LLM)", async () => {
    handle = launchRunner();
    handle.send({ id: "s1", type: "get_state" });
    const frame = (await handle.waitForFrame(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        (f as { id?: string }).id === "s1",
    )) as { command: string; success: boolean };
    expect(frame.command).toBe("get_state");
    expect(frame.success).toBe(true);
    // get_state is a discriminated RpcResponse — must pass the protocol schema.
    expect(RpcResponseSchema.safeParse(frame).success).toBe(true);
  });

  it("answers get_commands and every emitted frame passes the protocol schema (Req 6.1/6.3)", async () => {
    handle = launchRunner();
    handle.send({ id: "c1", type: "get_commands" });
    await handle.waitForFrame(
      (f) =>
        typeof f === "object" && f !== null && (f as { id?: string }).id === "c1",
    );
    // Every frame seen so far must validate against the protocol union.
    for (const frame of handle.frames) {
      const ok = validateFrame(frame);
      if (!ok) {
        // Surface the offending frame for diagnosis.
        expect.fail(`frame failed protocol schema: ${JSON.stringify(frame)}`);
      }
    }
  });

  it("PRODUCTION bootstrap boots from the agent cwd (no node_modules) and answers get_state (no LLM)", async () => {
    // Regression guard for the real-mode 404: the bootstrap is spawned with
    // cwd=<agent work dir>. If module resolution were anchored to cwd (as the
    // old `--import jiti/register` path was) the runner would crash on
    // `Cannot find package 'jiti'`, the session would be deleted, and :id
    // routes would 404. The bootstrap resolves jiti + the pi SDK from the
    // server package, so it must boot and serve frames regardless of cwd.
    handle = launchRunner({ mode: "bootstrap" });
    handle.send({ id: "b1", type: "get_state" });
    const frame = (await handle.waitForFrame(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        (f as { id?: string }).id === "b1",
    )) as { command: string; success: boolean };
    expect(frame.command).toBe("get_state");
    expect(frame.success).toBe(true);
    expect(RpcResponseSchema.safeParse(frame).success).toBe(true);
  });
});

describe.skipIf(!hasApiKey)(
  "runner subprocess — prompt e2e (Req 7.3, 6.2) [requires ANTHROPIC_API_KEY]",
  () => {
    let handle: RunnerHandle | undefined;
    afterEach(() => {
      handle?.dispose();
      handle = undefined;
    });

    it("prompt yields message_update(text_delta) and agent_end, all schema-valid", async () => {
      handle = launchRunner();
      handle.send({ id: "p1", type: "prompt", message: "Say hi in one word." });

      await handle.waitForFrame(
        (f) =>
          typeof f === "object" &&
          f !== null &&
          (f as { type?: string }).type === "agent_end",
        60000,
      );

      const hasTextDelta = handle.frames.some((f) => {
        if (typeof f !== "object" || f === null) return false;
        const ev = f as { type?: string; subtype?: string; event?: { type?: string } };
        return (
          ev.type === "message_update" &&
          JSON.stringify(f).includes("text_delta")
        );
      });
      expect(hasTextDelta).toBe(true);

      for (const frame of handle.frames) {
        expect(validateFrame(frame)).toBe(true);
      }
    });
  },
);
