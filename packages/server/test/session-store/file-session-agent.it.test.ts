/**
 * file-session-agent e2e —— 文件存储会话的端到端验证。
 *
 * 覆盖两条始终运行的确定性路径 + 一条按需的真实 LLM 路径:
 *  A. 真实的第三方 `SessionManager`(pi 子进程用的同一套写盘代码)把会话 flush 成 JSONL
 *     文件,`FsSessionEntryStore` 以兼容布局 list/read 回来并按序重建(Req 10.4 端到端)。
 *  B. 真启 file-session-agent 子进程(隔离 agent-dir),非 LLM RPC 证明 example agent
 *     可被 bootstrap runner 加载并服务帧。
 *  C. [PI_WEB_E2E_LLM=1 才跑] 真启 agent + 真实一轮 prompt → pi 把会话落盘 →
 *     FsSessionEntryStore 读回。需要 ~/.pi 凭证,默认跳过以免触发网络/计费。
 *
 * 说明:pi 的会话只在**首条 assistant 消息**后才 flush 成文件(在此之前在内存缓冲)。
 * 因此「真 agent 产出文件」要么走真实 LLM 轮次(路径 C,门控),要么用真实 SessionManager
 * 直接驱动(路径 A,确定性)。路径 A 用的就是 pi 自己的写盘实现,故仍是真实兼容证明。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SESSION_VERSION, SessionManager } from "@earendil-works/pi-coding-agent";
import { bucketDirName, FsSessionEntryStore, type SessionEntry } from "../../src/session-store/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "file-session-agent");

type AppendArg = Parameters<SessionManager["appendMessage"]>[0];

async function collect(it: AsyncIterable<SessionEntry>): Promise<SessionEntry[]> {
  const out: SessionEntry[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("file-session-agent e2e — 真实 SessionManager 落盘 ↔ FsSessionEntryStore 回读 (Req 10.4)", () => {
  it("pi SessionManager 写出的 JSONL 会话被 FsSessionEntryStore list/read 按序读回", async () => {
    const root = mkdtempSync(join(tmpdir(), "fsa-sessions-"));
    const cwd = join(tmpdir(), "fsa-proj");
    // 显式把会话目录指到 <root>/<bucket(cwd)>,使 FsSessionEntryStore(root) 与之对齐
    const sm = SessionManager.create(cwd, join(root, bucketDirName(cwd)));
    const sessionId = sm.getSessionId();

    sm.appendMessage({ role: "user", content: "记一条笔记", timestamp: Date.now() } as AppendArg);
    sm.appendModelChange("openrouter", "anthropic/claude-sonnet-4.6");
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "noted" }],
      api: "openai-completions",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } as AppendArg);

    // 真实 pi 已把会话 flush 成磁盘文件
    const file = sm.getSessionFile();
    expect(file).toBeDefined();
    expect(existsSync(file as string)).toBe(true);

    const store = new FsSessionEntryStore(root);

    // listAll / list(cwd) 都能定位该会话
    expect((await store.listAll()).map((m) => m.sessionId)).toContain(sessionId);
    expect((await store.list(cwd)).map((m) => m.sessionId)).toContain(sessionId);

    // 头部回读
    const header = await store.readHeader(sessionId);
    expect(header.cwd).toBe(cwd);
    expect(header.version).toBe(CURRENT_SESSION_VERSION);

    // 条目按追加序回读:message(user) → model_change → message(assistant)
    const entries = await collect(store.read(sessionId));
    expect(entries.map((e) => e.type)).toEqual(["message", "model_change", "message"]);
    const assistant = entries[2];
    expect(assistant?.type).toBe("message");
    if (assistant?.type === "message") {
      expect((assistant.message as { role?: unknown }).role).toBe("assistant");
    }
  });
});

// ---- 子进程启动器(B/C 复用,改编自 runner.e2e)----

interface RunnerHandle {
  proc: ChildProcessWithoutNullStreams;
  frames: unknown[];
  send: (cmd: object) => void;
  waitForFrame: (predicate: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
}

function launchRunner(agentDir: string): RunnerHandle {
  const cwd = mkdtempSync(join(tmpdir(), "fsa-cwd-"));
  const proc = spawn(
    process.execPath,
    ["--import", "jiti/register", runnerEntry, "--agent", exampleAgent, "--cwd", cwd, "--agent-dir", agentDir],
    { cwd: serverPkgDir, stdio: ["pipe", "pipe", "pipe"] },
  );
  return wrapProc(proc);
}

function wrapProc(proc: ChildProcessWithoutNullStreams): RunnerHandle {
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
  proc.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });
  const send = (cmd: object): void => {
    proc.stdin.write(`${JSON.stringify(cmd)}\n`);
  };
  const waitForFrame = (predicate: (f: unknown) => boolean, timeoutMs = 30000): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const existing = frames.find(predicate);
      if (existing !== undefined) return resolve(existing);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(new Error(`Timed out waiting for frame.\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`));
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
    send,
    waitForFrame,
    dispose: () => {
      proc.stdin.end();
      proc.kill("SIGKILL");
    },
  };
}

describe("file-session-agent e2e — 真启 example agent 子进程 (Req 7.2)", () => {
  let handle: RunnerHandle | undefined;
  afterEach(() => {
    handle?.dispose();
    handle = undefined;
  });

  it("bootstrap runner 加载 file-session-agent 并应答 get_state(非 LLM)", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "fsa-agentdir-"));
    handle = launchRunner(agentDir);
    handle.send({ id: "s1", type: "get_state" });
    const frame = (await handle.waitForFrame(
      (f) => typeof f === "object" && f !== null && (f as { id?: string }).id === "s1",
    )) as { command: string; success: boolean };
    expect(frame.command).toBe("get_state");
    expect(frame.success).toBe(true);
  });
});

// 路径 C:真实 LLM 轮次 → pi 落盘 → FsSessionEntryStore 回读。默认跳过(避免网络/计费)。
// 设 PI_WEB_E2E_LLM=1 且本机存在 ~/.pi/agent/auth.json 时启用。使用**真实 agent-dir**
// (含凭证 + 代理等用户包,确保 provider 可达),但用临时 cwd 隔离会话桶,跑完即删除以免污染。
const realAgentDir = join(homedir(), ".pi", "agent");
const enableLlm = process.env["PI_WEB_E2E_LLM"] === "1" && existsSync(join(realAgentDir, "auth.json"));

describe.skipIf(!enableLlm)(
  "file-session-agent e2e — 真 agent 一轮 prompt 产出文件并回读 [PI_WEB_E2E_LLM=1]",
  () => {
    let handle: RunnerHandle | undefined;
    afterEach(() => {
      handle?.dispose();
      handle = undefined;
    });

    it(
      "agent 真实回复后,会话被写成文件并由 FsSessionEntryStore 读回 assistant 消息",
      async () => {
        // 用真实 agent-dir(凭证+代理包齐全),但临时 cwd → 独立会话桶,便于隔离与清理
        const cwd = mkdtempSync(join(tmpdir(), "fsa-llm-cwd-"));
        const proc = spawn(
          process.execPath,
          ["--import", "jiti/register", runnerEntry, "--agent", exampleAgent, "--cwd", cwd, "--agent-dir", realAgentDir],
          { cwd: serverPkgDir, stdio: ["pipe", "pipe", "pipe"] },
        );
        handle = wrapProc(proc);
        handle.send({ id: "p1", type: "prompt", message: "Reply with the single word: ok" });
        await handle.waitForFrame(
          (f) => typeof f === "object" && f !== null && (f as { type?: string }).type === "agent_end",
          130000,
        );

        const store = new FsSessionEntryStore(join(realAgentDir, "sessions"));
        const sessions = await store.list(cwd); // 仅本次临时 cwd 的会话
        expect(sessions.length).toBeGreaterThan(0);
        const sessionId = sessions[0]!.sessionId;
        const entries = await collect(store.read(sessionId));
        const hasAssistant = entries.some(
          (e) => e.type === "message" && (e.message as { role?: unknown }).role === "assistant",
        );
        expect(hasAssistant).toBe(true);

        await store.delete(sessionId); // 清理:删除本次测试产生的会话文件
      },
      150000,
    );
  },
);
