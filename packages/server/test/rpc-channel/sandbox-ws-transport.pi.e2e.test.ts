/**
 * 真 pi 完整闭环(本地 agent-sandbox + piweb-pi 镜像,WS-runner 数据面)。
 * 仅 PI_WEB_E2B_PI_LOCAL=1 且有 DASHSCOPE_API_KEY 时运行。
 *
 * 证明 pi-web 完整链路:
 *   PiRpcSession(会话核心) → SandboxWsTransport(WS-runner) → Sandbox.create(piweb-pi)
 *   → 容器内 agent-runner → 真实 `pi --mode rpc`(qwen via DashScope)
 *   → getCommands 探针就绪 → prompt → pi 处理并经 event 流式回复。
 *
 * 前置:kind + agent-sandbox、port-forward :10000、反代 :13000、piweb-pi 模板已注册、
 *       pi-clouds/agent-runner:pi 已 kind load。
 * 运行:
 *   PI_WEB_E2B_PI_LOCAL=1 E2B_API_KEY=sys-... DASHSCOPE_API_KEY=sk-... \
 *   npx vitest run test/rpc-channel/sandbox-ws-transport.pi.local.test.ts
 */
import { describe, it, expect } from "vitest";
import { SandboxWsTransport } from "../../src/rpc-channel/sandbox-ws-transport.js";
import { PiRpcSession } from "../../src/rpc-channel/pi-rpc-session.js";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

const RUN = process.env.PI_WEB_E2B_PI_LOCAL === "1" && !!process.env.DASHSCOPE_API_KEY;
const API_KEY = process.env.E2B_API_KEY ?? "sys-2492a85b10ed4cb083b2c76b181eac96";
const API_URL = process.env.PI_WEB_E2B_API_URL ?? "http://127.0.0.1:13000";
const WS_BASE = process.env.PI_WEB_E2B_RUNNER_WS_BASE ?? "ws://127.0.0.1:10000";
const DOMAIN = process.env.E2B_DOMAIN ?? "localhost:10000";

function spec(): SpawnSpec {
  return {
    cmd: "node",
    args: [],
    cwd: "/tmp",
    env: { DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY ?? "" },
  };
}

/** 轮询 getCommands 直到 pi 就绪(每次带超时,失败即重试)。 */
async function waitPiReady(session: PiRpcSession, deadlineMs: number): Promise<boolean> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const ok = await Promise.race([
      session.getCommands().then(() => true).catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
    ]);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

describe.skipIf(!RUN)("真 pi 完整闭环 @ 本地 agent-sandbox(WS-runner)", () => {
  it("PiRpcSession → SandboxWsTransport → piweb-pi 内 pi --mode rpc → prompt 流式回复", async () => {
    const transport = new SandboxWsTransport(spec(), {
      apiKey: API_KEY,
      template: "piweb-pi",
      apiUrl: API_URL,
      domain: DOMAIN,
      validateApiKey: false,
      wsBase: WS_BASE,
      runnerPort: 8080,
      reconnectDelayMs: 1000,
      envPassthrough: ["DASHSCOPE_API_KEY"],
    });
    const session = new PiRpcSession(transport);

    const events: unknown[] = [];
    session.onEvent((e) => events.push(e));
    const rawLines: string[] = [];
    session.onLine((l) => rawLines.push(l));
    const stderr: string[] = [];
    session.onStderr((c) => stderr.push(c));

    await transport.ready();

    // 等冷 pod + pi --mode rpc 启动就绪(getCommands 探针)。
    const ready = await waitPiReady(session, 90_000);
    // eslint-disable-next-line no-console
    console.log("[pi] getCommands 就绪:", ready);
    expect(ready, "pi 未在 90s 内就绪(看 stderr):\n" + stderr.join("")).toBe(true);

    // 发真 prompt → pi 处理并流式回复。
    const resp = await session.prompt(
      "Reply with exactly one word: PONG. No punctuation.",
    );
    // eslint-disable-next-line no-console
    console.log("[pi] prompt response:", JSON.stringify(resp).slice(0, 200));

    // 等事件流(qwen 回复)。
    await new Promise((r) => setTimeout(r, 40_000));

    // eslint-disable-next-line no-console
    console.log("[pi] 收到 event 数:", events.length, " raw 行数:", rawLines.length);
    for (const l of rawLines.slice(0,20)) console.log("  raw:", l.slice(0,150));
    if (stderr.length) console.log("  stderr:", stderr.join("").slice(0,600));
    for (const e of events.slice(0, 30)) {
      // eslint-disable-next-line no-console
      console.log("  event:", JSON.stringify(e).slice(0, 160));
    }

    // 断言:prompt 有响应,且收到了 agent 事件(真实 pi 在容器内处理的证据)。
    expect(resp).toBeTruthy();
    expect(events.length).toBeGreaterThan(0);

    await session.close();
  }, 180_000);
});
