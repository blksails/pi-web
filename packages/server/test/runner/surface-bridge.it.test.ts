/**
 * 集成(真实 runner 子进程)— agent 权威 surface(agent-authoritative-surface, Task 7)。
 *
 * 把真实 runner 作为子进程拉起(`startRunner` 内 wireStateBridge + wireSurfaceBridge 已装配,
 * surface-demo-agent 经 createSurface 注册了 domain="demo" surface)。经 stdin 喂一条 ui_rpc 命令行
 * `{"type":"ui_rpc","request":{point:"command",action:"execute",payload:{domain:"demo",action:"increment"}}}`,
 * 断言子进程 stdout(**fd1**)回出:
 *   1. `{"type":"ui_rpc_response",...}` 回流行(result 为 SurfaceCommandResult,ok:true)——只有真实
 *      子进程能抓到 fd1 直写(stub 无 takeOverStdout);
 *   2. `{"type":"piweb_state",key:"surface:demo",...}` 下行行(命令内 ctx.setState → wireStateBridge 下行)。
 * 另断言:非 surface 命令行(payload 含 name)被**放行**——不回 ui_rpc_response(不吞既有链路)。
 *
 * 无需 LLM;不依赖 stub。pi 自身读取器对这些行回的 Unknown-command 不影响本路径。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { protocolVersion } from "@blksails/pi-web-protocol";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "surface-demo-agent");

interface RunnerHandle {
  proc: ChildProcessWithoutNullStreams;
  frames: unknown[];
  stderr: () => string;
  send: (cmd: object) => void;
  waitForFrame: (predicate: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
}

function launchRunner(): RunnerHandle {
  const cwd = mkdtempSync(join(tmpdir(), "surface-runner-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "surface-runner-agentdir-"));
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
          new Error(`Timed out.\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`),
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

function isType(f: unknown, type: string): boolean {
  return typeof f === "object" && f !== null && (f as { type?: unknown }).type === type;
}

async function waitReady(handle: RunnerHandle): Promise<void> {
  handle.send({ id: "probe", type: "get_commands" });
  await handle.waitForFrame(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      (f as { command?: unknown }).command === "get_commands",
  );
}

describe("agent-authoritative-surface — 真实 runner 子进程 fd1 回流 + setState 下行 (Task 7)", () => {
  let handle: RunnerHandle | undefined;
  afterEach(() => {
    handle?.dispose();
    handle = undefined;
  });

  it("ui_rpc 命令转发 → 派发 → fd1 回流 ui_rpc_response + 命令内 setState → piweb_state 下行", async () => {
    handle = launchRunner();
    await waitReady(handle);

    // 转发一条 surface 命令(无 name → 逃逸 host;wireSurfaceBridge 按 domain 派发)。
    handle.send({
      type: "ui_rpc",
      request: {
        correlationId: "cmd-1",
        point: "command",
        action: "execute",
        payload: { domain: "demo", action: "increment" },
        protocolVersion,
      },
    });

    // 1) fd1 回流 ui_rpc_response(result 为 SurfaceCommandResult,ok:true)。
    const resp = (await handle.waitForFrame(
      (f) =>
        isType(f, "ui_rpc_response") &&
        (f as { response?: { correlationId?: unknown } }).response?.correlationId === "cmd-1",
    )) as { response: { ok: boolean; result: { domain: string; action: string; ok: boolean } } };
    expect(resp.response.ok).toBe(true);
    expect(resp.response.result.domain).toBe("demo");
    expect(resp.response.result.action).toBe("increment");
    expect(resp.response.result.ok).toBe(true);

    // 2) 命令内 ctx.setState → piweb_state 下行行(key=surface:demo,count 递增)。
    const state = (await handle.waitForFrame(
      (f) =>
        isType(f, "piweb_state") &&
        (f as { key?: unknown }).key === "surface:demo" &&
        typeof (f as { value?: { count?: unknown } }).value?.count === "number" &&
        (f as { value: { count: number } }).value.count >= 1,
    )) as { key: string; value: { count: number } };
    expect(state.key).toBe("surface:demo");
    expect(state.value.count).toBeGreaterThanOrEqual(1);
  }, 60000);

  it("非 surface 命令行(payload 含 name)被放行 → 不回 ui_rpc_response", async () => {
    handle = launchRunner();
    await waitReady(handle);

    handle.send({
      type: "ui_rpc",
      request: {
        correlationId: "host-1",
        point: "command",
        action: "execute",
        payload: { name: "plugin", argv: "list" },
        protocolVersion,
      },
    });

    // 放行:wireSurfaceBridge 不消费,不写回。给一点时间后断言无该 correlationId 的回流。
    await new Promise((r) => setTimeout(r, 1500));
    const hit = handle.frames.find(
      (f) =>
        isType(f, "ui_rpc_response") &&
        (f as { response?: { correlationId?: unknown } }).response?.correlationId === "host-1",
    );
    expect(hit).toBeUndefined();
  }, 60000);
});
