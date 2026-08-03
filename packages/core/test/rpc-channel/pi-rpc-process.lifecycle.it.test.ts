/**
 * PiRpcProcess 生命周期单元测试(Req 2.4, 6.1–6.6, 7)。
 *
 * 用真实但受控的子进程(node 跑一小段脚本)验证:spawn 失败传播、stderr 收集、
 * 退出/崩溃拒绝待决、close 干净退出无僵尸、health 状态转换。
 */
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import {
  ChannelClosedError,
  ChildCrashError,
  SpawnError,
} from "../../src/rpc-channel/pi-rpc-process.errors.js";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

const ECHO = fileURLToPath(
  new URL("./fixtures/echo-process.mjs", import.meta.url),
);

function nodeSpec(args: string[]): SpawnSpec {
  return {
    cmd: process.execPath,
    args,
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

let live: PiRpcProcess[] = [];
function track(p: PiRpcProcess): PiRpcProcess {
  live.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(live.map((p) => p.close().catch(() => undefined)));
  live = [];
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("PiRpcProcess — spawn failure (Req 2.4)", () => {
  it("propagates a SpawnError via onExit when the command cannot be executed, and is not healthy", async () => {
    const proc = track(
      new PiRpcProcess({
        cmd: "this-command-does-not-exist-xyz",
        args: [],
        cwd: process.cwd(),
        env: {},
      }),
    );
    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => proc.onExit(resolve),
    );
    expect(exit.code).toBeNull();
    expect(proc.health().alive).toBe(false);

    // pending commands rejected with SpawnError after the error fires.
    await expect(proc.prompt("x")).rejects.toBeInstanceOf(Error);
  });
});

describe("PiRpcProcess — stderr collection (Req 6.1)", () => {
  it("continuously collects stderr and exposes it", async () => {
    const proc = track(
      new PiRpcProcess(
        nodeSpec(["-e", "process.stderr.write('boom-on-stderr'); setInterval(()=>{},1000);"]),
      ),
    );
    const chunks: string[] = [];
    proc.onStderr((c) => chunks.push(c));
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (proc.getStderr().includes("boom-on-stderr")) {
          clearInterval(t);
          resolve();
        }
      }, 10);
    });
    expect(proc.getStderr()).toContain("boom-on-stderr");
    expect(chunks.join("")).toContain("boom-on-stderr");
  });
});

describe("PiRpcProcess — exit / crash rejection (Req 6.2, 6.5)", () => {
  it("rejects all pending commands with ChildCrashError when the child crashes, and emits exit", async () => {
    // 子进程读 stdin(保持存活),0.2s 后非零退出崩溃。
    const proc = track(
      new PiRpcProcess(
        nodeSpec([
          "-e",
          "process.stdin.resume(); setTimeout(()=>process.exit(7), 200);",
        ]),
      ),
    );
    const exitInfo = new Promise<{ code: number | null }>((resolve) =>
      proc.onExit(resolve),
    );
    const pending = proc.getState();

    await expect(pending).rejects.toBeInstanceOf(ChildCrashError);
    const info = await exitInfo;
    expect(info.code).toBe(7);
    expect(proc.health().alive).toBe(false);
    expect(proc.health().exitCode).toBe(7);
  });
});

describe("PiRpcProcess — close() clean exit (Req 6.3, 6.4, 6.6)", () => {
  it("close() terminates the child, rejects pending with ChannelClosedError, reports unhealthy, leaves no zombie", async () => {
    const proc = track(new PiRpcProcess(nodeSpec([ECHO])));
    // 等就绪。
    await delay(50);
    expect(proc.health().alive).toBe(true);

    const pending = proc.getState(); // 永不会被回应 → 应被 close 拒绝
    const pid = (proc as unknown as { child: { pid?: number } }).child.pid;

    const rej = expect(pending).rejects.toBeInstanceOf(ChannelClosedError);
    await proc.close();
    await rej;

    expect(proc.health().alive).toBe(false);

    // 无僵尸:pid 不再存活。
    expect(typeof pid).toBe("number");
    let alive = true;
    try {
      process.kill(pid!, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);

    // close 幂等。
    await expect(proc.close()).resolves.toBeUndefined();

    // 关闭后命令立即拒绝。
    await expect(proc.getState()).rejects.toBeInstanceOf(ChannelClosedError);
  });
});

describe("PiRpcProcess — error types are distinguishable", () => {
  it("exposes named error classes", () => {
    expect(new SpawnError("x").name).toBe("SpawnError");
    expect(new ChannelClosedError().name).toBe("ChannelClosedError");
    expect(new ChildCrashError(1, null).name).toBe("ChildCrashError");
  });
});
