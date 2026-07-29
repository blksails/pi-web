/**
 * PiRpcProcess 热重载重启安全单测(spec pi-web-cli Req 8.2)。
 *
 * 核心:requestRestart 必须把"回合进行中"(agent_start..agent_end:流式 token /
 * 工具调用 / 等待 extension_ui 应答)视为忙、延迟重启,否则杀子进程致回合中断、丢失。
 * 仅靠 pendingCommands 不够(prompt 立即 ack,增量全走 event 流)。
 *
 * 用真实但受控的 node 子进程驱动 agent_start/agent_end 事件;以"新子进程启动即发
 * agent_start"作为重启已发生的可观测信号(重启 = 同 spawnSpec 重 spawn = 新 boot 事件)。
 */
import { describe, it, expect, afterEach } from "vitest";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

function nodeSpec(script: string): SpawnSpec {
  return {
    cmd: process.execPath,
    args: ["-e", script],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

let live: PiRpcProcess[] = [];
const track = (p: PiRpcProcess): PiRpcProcess => (live.push(p), p);
afterEach(async () => {
  await Promise.all(live.map((p) => p.close().catch(() => undefined)));
  live = [];
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const dl = Date.now() + ms;
  while (Date.now() < dl) {
    if (pred()) return;
    await delay(30);
  }
  throw new Error("waitFor timeout");
}

// 启动即发 agent_start(boot 标记 → 回合开始);收到含 "end" 的 stdin 后发 agent_end。
const TURN_STUB = [
  "process.stdin.resume();",
  "process.stdout.write(JSON.stringify({type:'agent_start'})+'\\n');",
  "let b='';process.stdin.on('data',d=>{b+=d;",
  "if(b.includes('end')){b='';process.stdout.write(JSON.stringify({type:'agent_end'})+'\\n');}});",
].join("");

// 启动即发 agent_start + 立即 agent_end(回合瞬结束 → 空闲)。
const IDLE_STUB = [
  "process.stdin.resume();",
  "process.stdout.write(JSON.stringify({type:'agent_start'})+'\\n');",
  "process.stdout.write(JSON.stringify({type:'agent_end'})+'\\n');",
].join("");

describe("PiRpcProcess — 热重载重启在回合进行中延迟(Req 8.2)", () => {
  it("回合进行中 requestRestart 延迟,回合结束后才重启", async () => {
    const proc = track(new PiRpcProcess(nodeSpec(TURN_STUB)));
    let starts = 0;
    proc.onEvent((e) => {
      if (e.type === "agent_start") starts++;
    });

    // 首个子进程 boot → agent_start(turnActive=true)
    await waitFor(() => starts === 1, 3000);

    // 回合进行中请求重启 → 应延迟(不杀子进程、不产生新 boot)
    proc.requestRestart();
    await delay(500);
    expect(starts).toBe(1); // 未重启,回合未被中断

    // 结束回合 → agent_end → 执行此前延迟的重启 → 新子进程 boot 发新 agent_start
    proc.send("end");
    await waitFor(() => starts === 2, 3000);
    expect(starts).toBe(2);
  });

  it("空闲(回合已结束、无待决命令)requestRestart 立即重启", async () => {
    const proc = track(new PiRpcProcess(nodeSpec(IDLE_STUB)));
    let starts = 0;
    let ends = 0;
    proc.onEvent((e) => {
      if (e.type === "agent_start") starts++;
      else if (e.type === "agent_end") ends++;
    });

    // 首个子进程 boot:agent_start + agent_end(turnActive 回到 false → 空闲)
    await waitFor(() => starts === 1 && ends === 1, 3000);

    // 空闲请求重启 → 立即重启 → 新子进程 boot 发新 agent_start
    proc.requestRestart();
    await waitFor(() => starts === 2, 3000);
    expect(starts).toBe(2);
  });
});
