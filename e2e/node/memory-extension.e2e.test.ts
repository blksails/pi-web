/**
 * memory-extension e2e — real runner + examples/memory-agent + mock LLM tool_calls.
 *
 * Proves the shipped path:
 *   examples/memory-agent → extensions: [memoryExtension]
 *   → runner loads agent → mock model issues memory_write then memory_read
 *   → FileMemoryStore under PI_WEB_MEMORY_DIR writes skills-like .md
 *   → tool_execution_end carries structured { ok, entry.content }
 *
 * Offline / zero external credentials. File backend only (primary e2e path).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const serverPkgDir = join(repoRoot, "packages", "server");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const memoryAgent = join(repoRoot, "examples", "memory-agent");

const MEMORY_NAME = "e2e-note";
const MEMORY_BODY = "memory-body-unique-xyz-kiro-e2e";
const FINAL_ANSWER = "memory write and read ok";

interface Frame {
  type?: string;
  toolName?: string;
  command?: string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    details?: {
      ok?: boolean;
      entry?: { name?: string; content?: string; tags?: string[] };
      code?: string;
    };
  };
}

function startMockProvider(): Promise<{ server: Server; port: number }> {
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !/\/chat\/completions/.test(req.url ?? "")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => {
      raw += String(c);
    });
    req.on("end", () => {
      calls += 1;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const model = "mock-model";
      const base = {
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: 0,
        model,
      };
      const send = (choices: unknown[], extra?: object): void => {
        res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
      };
      send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);

      if (calls === 1) {
        // First turn: call memory_write
        send([
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_write",
                  type: "function",
                  function: { name: "memory_write", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ]);
        const args = JSON.stringify({
          name: MEMORY_NAME,
          content: MEMORY_BODY,
          tags: ["e2e"],
          description: "e2e memory",
        });
        send([
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
            finish_reason: null,
          },
        ]);
        send([{ index: 0, delta: {}, finish_reason: "tool_calls" }]);
      } else if (calls === 2) {
        // After write: call memory_read
        send([
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_read",
                  type: "function",
                  function: { name: "memory_read", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ]);
        const args = JSON.stringify({ name: MEMORY_NAME });
        send([
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
            finish_reason: null,
          },
        ]);
        send([{ index: 0, delta: {}, finish_reason: "tool_calls" }]);
      } else {
        send([{ index: 0, delta: { content: FINAL_ANSWER }, finish_reason: null }]);
        send([{ index: 0, delta: {}, finish_reason: "stop" }]);
      }
      send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function makeAgentDir(mockPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), "memory-agentdir-"));
  const models = {
    providers: {
      mock: {
        name: "Mock (e2e)",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: "mock-key",
        api: "openai-completions",
        models: [
          {
            id: "mock-model",
            name: "Mock Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
  const settings = {
    defaultProvider: "mock",
    defaultModel: "mock-model",
    packages: [],
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

interface RunnerHandle {
  frames: unknown[];
  send: (cmd: object) => void;
  waitForFrame: (p: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
  stderr: () => string;
}

function launch(
  agentDir: string,
  cwd: string,
  memoryDir: string,
): RunnerHandle {
  const proc: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      memoryAgent,
      "--cwd",
      cwd,
      "--agent-dir",
      agentDir,
    ],
    {
      cwd: serverPkgDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_WEB_STUB_AGENT: "",
        PI_WEB_MEMORY_BACKEND: "file",
        PI_WEB_MEMORY_DIR: memoryDir,
        PI_WEB_AUTO_TITLE: "0",
      },
    },
  );
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
        try {
          frames.push(JSON.parse(line));
        } catch {
          /* non-JSON */
        }
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (c: string) => {
    stderrBuf += c;
  });
  const send = (cmd: object): void => {
    proc.stdin.write(`${JSON.stringify(cmd)}\n`);
  };
  const waitForFrame = (
    p: (f: unknown) => boolean,
    timeoutMs = 45000,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const found = frames.find(p);
      if (found !== undefined) return resolve(found);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(
          new Error(
            `timeout waiting for frame\nframes=${JSON.stringify(frames).slice(0, 4000)}\nstderr=${stderrBuf.slice(-3000)}`,
          ),
        );
      }, timeoutMs);
      const onData = (): void => {
        const m = frames.find(p);
        if (m !== undefined) {
          clearTimeout(timer);
          proc.stdout.off("data", onData);
          resolve(m);
        }
      };
      proc.stdout.on("data", onData);
    });
  return {
    frames,
    send,
    waitForFrame,
    dispose: () => {
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      proc.kill("SIGKILL");
    },
    stderr: () => stderrBuf,
  };
}

const isToolEnd = (name: string) => (f: unknown): boolean =>
  typeof f === "object" &&
  f !== null &&
  (f as Frame).type === "tool_execution_end" &&
  (f as Frame).toolName === name;

const isAgentEnd = (f: unknown): boolean =>
  typeof f === "object" && f !== null && (f as Frame).type === "agent_end";

describe("memory-extension e2e (real runner + memory-agent + file backend)", () => {
  let handle: RunnerHandle | undefined;
  let mock: { server: Server; port: number } | undefined;

  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    mock?.server.close();
    mock = undefined;
  });

  it(
    "★ memory_write then memory_read via real extension; body round-trips and lands on disk",
    { timeout: 90_000 },
    async () => {
      mock = await startMockProvider();
      const agentDir = makeAgentDir(mock.port);
      const cwd = mkdtempSync(join(tmpdir(), "memory-cwd-"));
      const memoryDir = mkdtempSync(join(tmpdir(), "memory-store-"));
      handle = launch(agentDir, cwd, memoryDir);

      handle.send({ id: "p1", type: "prompt", message: "请把这条记住再读回来" });

      const writeEnd = (await handle.waitForFrame(isToolEnd("memory_write"))) as Frame;
      expect(writeEnd.result?.details?.ok).toBe(true);
      expect(writeEnd.result?.details?.entry?.name).toBe(MEMORY_NAME);
      expect(writeEnd.result?.details?.entry?.content).toBe(MEMORY_BODY);

      const readEnd = (await handle.waitForFrame(isToolEnd("memory_read"))) as Frame;
      expect(readEnd.result?.details?.ok).toBe(true);
      expect(readEnd.result?.details?.entry?.content).toBe(MEMORY_BODY);

      // Skills-like file persisted under PI_WEB_MEMORY_DIR (shipped FileMemoryStore path).
      const diskPath = join(memoryDir, "global", `${MEMORY_NAME}.md`);
      expect(existsSync(diskPath), `expected memory file at ${diskPath}`).toBe(true);
      const disk = readFileSync(diskPath, "utf8");
      expect(disk).toContain("name: e2e-note");
      expect(disk).toContain(MEMORY_BODY);
      expect(disk.startsWith("---\n")).toBe(true);

      const done = await handle.waitForFrame(isAgentEnd);
      expect(JSON.stringify(done)).toContain(FINAL_ANSWER);
    },
  );
});
