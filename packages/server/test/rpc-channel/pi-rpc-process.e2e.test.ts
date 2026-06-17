/**
 * e2e 测试(Req 7.5, 5.1, 6.3, 6.6):完整一轮
 * spawn → prompt → 收集 text_delta/工具相关事件 → abort 生效 → close() 干净退出无僵尸。
 *
 * provider:默认 STUB(无 API key 时);PI_WEB_LIVE=1 且能解析 pi cli.js 时走 LIVE。
 * STUB 的 prompt 会吐 message_update(text_delta) + agent_end,abort 会回 response。
 */
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import type { SpawnSpec, AgentEvent } from "@pi-web/protocol";

const STUB = fileURLToPath(
  new URL("./fixtures/rpc-stub-process.mjs", import.meta.url),
);

function resolvePiCli(): string | null {
  try {
    const req = createRequire(import.meta.url);
    const pkgJson = req.resolve("@earendil-works/pi-coding-agent/package.json");
    const cli = path.join(path.dirname(pkgJson), "dist", "cli.js");
    return fs.existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

const LIVE = process.env.PI_WEB_LIVE === "1" && !!process.env.ANTHROPIC_API_KEY;
const piCli = resolvePiCli();
const useLive = LIVE && piCli !== null;
const MODE = useLive ? "LIVE (real pi --mode rpc)" : "STUB (rpc-stub-process.mjs)";

function makeSpec(): SpawnSpec {
  const env = { ...process.env } as Record<string, string>;
  if (useLive && piCli) {
    return {
      cmd: process.execPath,
      args: [piCli, "--mode", "rpc", "--no-session"],
      cwd: process.cwd(),
      env,
    };
  }
  return { cmd: process.execPath, args: [STUB], cwd: process.cwd(), env };
}

let live: PiRpcProcess[] = [];
afterEach(async () => {
  await Promise.all(live.map((p) => p.close().catch(() => undefined)));
  live = [];
});

describe(`PiRpcProcess e2e [${MODE}]`, () => {
  it("spawn → prompt → collect events → abort → close() leaves no zombie (Req 7.5, 6.3, 6.6)", async () => {
    const proc = new PiRpcProcess(makeSpec());
    live.push(proc);

    const events: AgentEvent[] = [];
    proc.onEvent((e) => events.push(e));

    const agentEnd = new Promise<void>((resolve) => {
      proc.onEvent((e) => {
        if (e.type === "agent_end") resolve();
      });
    });

    await proc.prompt("write some text");
    await agentEnd;

    // 收集到 text_delta(经 message_update.assistantMessageEvent)。
    const sawTextDelta = events.some(
      (e) =>
        e.type === "message_update" &&
        e.assistantMessageEvent.type === "text_delta",
    );
    expect(sawTextDelta).toBe(true);

    // abort 生效(返回 response)。
    const abortRes = await proc.abort();
    expect(abortRes.command).toBe("abort");

    const pid = (proc as unknown as { child: { pid?: number } }).child.pid;
    expect(typeof pid).toBe("number");

    // close() 干净退出。
    await proc.close();
    expect(proc.health().alive).toBe(false);

    // 无僵尸:pid 已不存在。
    let alive = true;
    try {
      process.kill(pid!, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });
});
