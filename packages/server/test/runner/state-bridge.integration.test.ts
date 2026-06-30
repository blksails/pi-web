/**
 * 集成（真实 runner 子进程）— 状态注入桥写回路径（state-injection-bridge, Task 4.2）。
 *
 * 把真实 runner 作为子进程拉起（`runRpcMode` 内有 wireStateBridge 已装配），经 stdin 喂一条
 * 写回内部行 `{"type":"piweb_state_set",...}`，断言子进程 stdout 回出一条 `{"type":"piweb_state",...}`
 * 下行行 —— 直接验证「wireStateBridge 的第二个 stdin 读取器 + 权威 KV + 下行帧」在真实进程内联通
 * （无需 LLM；不依赖 stub）。pi 自身读取器对该行回的 Unknown-command 不影响本路径。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "state-bridge-agent");

interface RunnerHandle {
  proc: ChildProcessWithoutNullStreams;
  frames: unknown[];
  stderr: () => string;
  send: (cmd: object) => void;
  waitForFrame: (predicate: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
}

function launchRunner(): RunnerHandle {
  const cwd = mkdtempSync(join(tmpdir(), "state-runner-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "state-runner-agentdir-"));
  const proc = spawn(
    process.execPath,
    [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      exampleAgent,
      "--cwd",
      cwd,
      "--agent-dir",
      agentDir,
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
      if (line.length > 0) {
        try {
          frames.push(JSON.parse(line));
        } catch {
          /* 非 JSON 行忽略 */
        }
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
    predicate: (f: unknown) => boolean,
    timeoutMs = 30000,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const existing = frames.find(predicate);
      if (existing !== undefined) return resolve(existing);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(
          new Error(
            `Timed out.\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`,
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

function isStateDown(f: unknown, key: string): boolean {
  return (
    typeof f === "object" &&
    f !== null &&
    (f as { type?: unknown }).type === "piweb_state" &&
    (f as { key?: unknown }).key === key
  );
}

describe("state-injection-bridge — 真实 runner 子进程写回路径 (Task 4.2)", () => {
  let handle: RunnerHandle | undefined;
  afterEach(() => {
    handle?.dispose();
    handle = undefined;
  });

  it("stdin 喂 piweb_state_set → stdout 回出 piweb_state 下行行(无 LLM)", async () => {
    handle = launchRunner();
    // 先等就绪锚点(get_commands 探针返回)以确保 runRpcMode + wireStateBridge 已装配。
    handle.send({ id: "probe", type: "get_commands" });
    await handle.waitForFrame(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        (f as { command?: unknown }).command === "get_commands",
    );

    // 写回:set count=7。
    handle.send({ type: "piweb_state_set", key: "count", value: 7 });
    const down = (await handle.waitForFrame((f) => isStateDown(f, "count"))) as {
      value: unknown;
      rev: number;
    };
    expect(down.value).toBe(7);
    expect(down.rev).toBe(0);

    // 删除写回:发 deleted 下行行。
    handle.send({ type: "piweb_state_delete", key: "count" });
    const del = (await handle.waitForFrame(
      (f) => isStateDown(f, "count") && (f as { deleted?: unknown }).deleted === true,
    )) as { rev: number };
    expect(del.rev).toBe(1);
  }, 40000);
});
