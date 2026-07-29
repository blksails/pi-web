/**
 * 三个示例 agent 的「对话 + 工具」端到端测试(真实 LLM 轮次)。
 *
 *  - hello-agent       : 自定义 echo 工具 → 诱导调用,断言 tool_execution_start(echo)。
 *  - minimal-agent     : noTools:"all" → 对话正常,但**不应**出现任何 tool_execution_start。
 *  - builtin-tools-agent: 内置工具集 → 诱导 ls,断言 tool_execution_start(内置工具名)。
 *
 * 默认跳过(避免网络/计费)。设 PI_WEB_E2E_LLM=1 且本机有 ~/.pi/agent/auth.json 时启用,
 * 使用真实 agent-dir 以获完整凭证/代理环境(与 file-session-agent Part C 一致)。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const examplesDir = join(serverPkgDir, "..", "..", "examples");
const realAgentDir = join(homedir(), ".pi", "agent");
const enableLlm = process.env["PI_WEB_E2E_LLM"] === "1" && existsSync(join(realAgentDir, "auth.json"));

const BUILTIN_TOOLS = ["bash", "read", "edit", "write", "ls", "grep", "glob", "patch", "fetch"];

interface RunnerHandle {
  frames: unknown[];
  send: (cmd: object) => void;
  waitForFrame: (p: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
}

function launch(agentName: string, cwd: string): RunnerHandle {
  const proc: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      join(examplesDir, agentName),
      "--cwd",
      cwd,
      "--agent-dir",
      realAgentDir,
    ],
    { cwd: serverPkgDir, stdio: ["pipe", "pipe", "pipe"] },
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
  const waitForFrame = (p: (f: unknown) => boolean, timeoutMs = 120000): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const found = frames.find(p);
      if (found !== undefined) return resolve(found);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(new Error(`timeout waiting for frame\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`));
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
      proc.stdin.end();
      proc.kill("SIGKILL");
    },
  };
}

const isType = (f: unknown, t: string): boolean =>
  typeof f === "object" && f !== null && (f as { type?: unknown }).type === t;

const toolStarts = (frames: unknown[]): string[] =>
  frames.flatMap((f) => {
    if (!isType(f, "tool_execution_start")) return [];
    const name = (f as { toolName?: unknown }).toolName;
    return typeof name === "string" ? [name] : [];
  });

const hasTextDelta = (frames: unknown[]): boolean =>
  frames.some((f) => isType(f, "message_update") && JSON.stringify(f).includes("text_delta"));

describe.skipIf(!enableLlm)("示例 agent 对话 + 工具 e2e [PI_WEB_E2E_LLM=1]", () => {
  let handle: RunnerHandle | undefined;
  afterEach(() => {
    handle?.dispose();
    handle = undefined;
  });

  it("hello-agent:对话正常,且能调用自定义 echo 工具", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "hello-cwd-"));
    handle = launch("hello-agent", cwd);
    handle.send({ id: "p1", type: "prompt", message: "Call the echo tool with text \"pong\", then stop." });
    await handle.waitForFrame((f) => isType(f, "agent_end"), 120000);
    expect(hasTextDelta(handle.frames) || toolStarts(handle.frames).length > 0).toBe(true);
    expect(toolStarts(handle.frames)).toContain("echo");
  }, 130000);

  it("minimal-agent:抵达终态、零工具;对话在模型可达时有文本(区域不可达则容忍)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "minimal-cwd-"));
    handle = launch("minimal-agent", cwd);
    handle.send({ id: "p1", type: "prompt", message: "Reply with a short greeting in one word." });
    const end = (await handle.waitForFrame((f) => isType(f, "agent_end"), 120000)) as {
      messages?: Array<{ role?: string; stopReason?: string; errorMessage?: string; content?: Array<{ type?: string; text?: string }> }>;
    };

    // 核心不变式(不依赖模型成功):minimal 零工具。
    expect(toolStarts(handle.frames)).toEqual([]);

    // 对话:有文本输出 OR 上游模型在本环境不可用(region/403)——后者属环境限制,
    // 仍证明 agent 启动、请求成形、终态处理正常,不应误判为 agent 缺陷。
    const assistant = (end.messages ?? []).find((m) => m.role === "assistant");
    const hasText =
      hasTextDelta(handle.frames) ||
      (assistant?.content ?? []).some((c) => c.type === "text" && typeof c.text === "string" && c.text.length > 0);
    const upstreamUnavailable =
      assistant?.stopReason === "error" &&
      /region|not available|unavailable|\b403\b/i.test(assistant.errorMessage ?? "");
    if (upstreamUnavailable) {
      // eslint-disable-next-line no-console
      console.warn(`[minimal-agent] 上游模型不可用,容忍:${assistant?.errorMessage}`);
    }
    expect(hasText || upstreamUnavailable).toBe(true);
  }, 130000);

  it("builtin-tools-agent:对话正常,且能调用内置工具(ls)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "builtin-cwd-"));
    writeFileSync(join(cwd, "hello.txt"), "hi\n");
    handle = launch("builtin-tools-agent", cwd);
    handle.send({
      id: "p1",
      type: "prompt",
      message: "Use the ls tool to list files in the current directory, then stop.",
    });
    await handle.waitForFrame((f) => isType(f, "agent_end"), 120000);
    const tools = toolStarts(handle.frames);
    expect(tools.some((t) => BUILTIN_TOOLS.includes(t))).toBe(true);
  }, 130000);
});
