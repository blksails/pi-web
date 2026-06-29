/**
 * 自动会话标题扩展端到端(离线确定性) —— spec auto-session-title。
 *
 * 真实 spawn custom 模式 runner 子进程,模型指向本地 mock OpenAI Chat Completions provider
 * (models.json),从而 agent loop 离线跑到 `agent_end`(无需真实 API key)。经 spawn env
 * 注入自动标题扩展入口 + 策略 heuristic → 标题确定性来自首条用户消息(不依赖 mock 回包内容)。
 *
 * 断言:runner stdout 出现 `extension_ui_request{method:"setTitle", title:<首条用户消息>}`,
 * 证明「forcedExtensionPaths 注入 → agent_end → ctx.ui.setTitle → setTitle 帧」端到端打通。
 *
 * 标题的前端展示(ambient.title / PiChat 渲染)是既有链路,不在本 e2e 范围。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionEntryStore } from "../../packages/server/src/session-store/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// e2e/node -> 仓库根
const repoRoot = join(here, "..", "..");
const serverPkgDir = join(repoRoot, "packages", "server");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const minimalAgent = join(repoRoot, "examples", "minimal-agent");
const autoTitleEntry = join(
  repoRoot,
  "packages",
  "tool-kit",
  "src",
  "auto-title",
  "auto-title-extension.ts",
);

const PROMPT = "帮我实现一个二分查找算法";

/** 本地 mock OpenAI Chat Completions:确定性 SSE 回包,使 agent loop 离线完成。 */
function startMockProvider(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const base = {
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock-model",
        };
        const send = (choices: unknown[], extra?: object): void => {
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        };
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: "好的。" }, finish_reason: null }]);
        send([{ index: 0, delta: {}, finish_reason: "stop" }]);
        send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

/** 写最小 agent-dir,默认模型指向 mock provider。 */
function makeAgentDir(mockPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), "auto-title-agentdir-"));
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
  /** 优雅结束(end stdin → runRpcMode dispose → 进程退出),释放 sqlite 文件句柄。 */
  gracefulExit: (timeoutMs?: number) => Promise<void>;
  dispose: () => void;
}

function launch(
  agentDir: string,
  cwd: string,
  extraEnv: Record<string, string> = {},
): RunnerHandle {
  const proc: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      minimalAgent,
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
        // 强制注入自动标题扩展 + 启发式策略(标题确定性来自首条用户消息)。
        PI_WEB_AUTO_TITLE_ENTRY: autoTitleEntry,
        PI_WEB_AUTO_TITLE_STRATEGY: "heuristic",
        // 隔离:不让父进程的 stub 标记泄漏到真实 runner。
        PI_WEB_STUB_AGENT: "",
        ...extraEnv,
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
      if (line.length > 0) frames.push(JSON.parse(line));
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
    timeoutMs = 25000,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const found = frames.find(p);
      if (found !== undefined) return resolve(found);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(
          new Error(
            `timeout waiting for frame\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`,
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
    gracefulExit: (timeoutMs = 4000) =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        proc.once("exit", finish);
        setTimeout(() => {
          if (!done) proc.kill("SIGKILL");
          finish();
        }, timeoutMs);
        proc.stdin.end();
      }),
    dispose: () => {
      proc.stdin.end();
      proc.kill("SIGKILL");
    },
  };
}

const isSetTitle = (f: unknown): f is { method: string; title: string } =>
  typeof f === "object" &&
  f !== null &&
  (f as { type?: unknown }).type === "extension_ui_request" &&
  (f as { method?: unknown }).method === "setTitle";

describe("auto-session-title e2e(真实 runner + mock provider + heuristic)", () => {
  let handle: RunnerHandle | undefined;
  let mock: { server: Server; port: number } | undefined;

  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    mock?.server.close();
    mock = undefined;
  });

  it("agent_end 后发出 setTitle 帧,标题来自首条用户消息", async () => {
    mock = await startMockProvider();
    const agentDir = makeAgentDir(mock.port);
    const cwd = mkdtempSync(join(tmpdir(), "auto-title-cwd-"));
    handle = launch(agentDir, cwd);

    handle.send({ id: "p1", type: "prompt", message: PROMPT });

    const frame = (await handle.waitForFrame(isSetTitle, 25000)) as {
      title: string;
    };
    expect(frame.title).toBe(PROMPT);
  }, 30000);

  it("标题持久化为会话名(SESSION_STORE=sqlite:setTitle→appendSessionInfo→镜像→name 列)", async () => {
    mock = await startMockProvider();
    const agentDir = makeAgentDir(mock.port);
    const cwd = mkdtempSync(join(tmpdir(), "auto-title-cwd-"));
    const dbPath = join(mkdtempSync(join(tmpdir(), "auto-title-db-")), "sessions.db");
    handle = launch(agentDir, cwd, {
      SESSION_STORE: "sqlite",
      SESSION_STORE_PATH: dbPath,
    });

    handle.send({ id: "p1", type: "prompt", message: PROMPT });
    // 收到 setTitle 帧 → appendSessionInfo 已调用;留窗口让异步镜像把 session_info 落 sqlite。
    await handle.waitForFrame(isSetTitle, 25000);
    await new Promise((r) => setTimeout(r, 1000));
    // 优雅退出释放 sqlite 句柄,再读库。
    await handle.gracefulExit();
    handle = undefined;

    // 轮询读回:会话名应等于首条用户消息(name 列经 append session_info 维护)。
    let name: string | undefined;
    for (let i = 0; i < 20 && name !== PROMPT; i += 1) {
      const store = new SqliteSessionEntryStore(dbPath);
      try {
        const sessions = await store.list(cwd);
        name = sessions.find((s) => s.cwd === cwd)?.name;
      } finally {
        store.close();
      }
      if (name !== PROMPT) await new Promise((r) => setTimeout(r, 150));
    }
    expect(name).toBe(PROMPT);
  }, 30000);
});
