/**
 * 集成测试(Req 7.4, 2.1, 4.1, 4.2):对一个真实子进程 spawn,发 `prompt`,
 * 断言收到 `agent_end` 事件并收到 prompt 的 response,且 stdout 经严格 reader 正确成帧。
 *
 * provider:
 *  - 默认走 STUB 子进程(test/rpc-channel/fixtures/rpc-stub-process.mjs),无需网络/API key,
 *    genuinely 走 spawn → JSONL 成帧 → 三类分发 → id 关联的完整本地路径。
 *  - 当设置 PI_WEB_LIVE=1 且能 require.resolve 到 pi cli.js 时,改 spawn 真实
 *    `node <pkg>/dist/cli.js --mode rpc --no-session`(LIVE)。
 */
import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import type { SpawnSpec } from "@blksails/protocol";

const STUB = fileURLToPath(
  new URL("./fixtures/rpc-stub-process.mjs", import.meta.url),
);

/** 解析真实 pi cli.js 路径(其 package.json 未在 exports 暴露子路径,经 bin 解析)。 */
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

describe(`PiRpcProcess integration [${MODE}]`, () => {
  it("spawns, sends prompt, frames stdout strictly, and receives an agent_end event + prompt response (Req 7.4)", async () => {
    const proc = new PiRpcProcess(makeSpec());
    live.push(proc);

    const eventTypes: string[] = [];
    const lines: string[] = [];
    proc.onLine((l) => lines.push(l));
    proc.onEvent((e) => eventTypes.push(e.type));

    const gotAgentEnd = new Promise<void>((resolve) => {
      proc.onEvent((e) => {
        if (e.type === "agent_end") resolve();
      });
    });

    const responsePromise = proc.prompt("hello world");

    await gotAgentEnd;
    const res = await responsePromise;

    expect(eventTypes).toContain("agent_end");
    expect(res.command).toBe("prompt");

    // 严格成帧:每条收到的行都应是合法 JSON(reader 未误切)。
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});
