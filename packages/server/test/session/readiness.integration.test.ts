/**
 * 会话就绪握手集成测试(spec session-readiness-handshake, Task 5.1)。
 *
 * 用**真实 spawn 的子进程**(readiness-stub-process.mjs,经 PiRpcProcess 真实通道)验证:
 *  - 只读探针 get_commands 对真子进程可得到响应 → 驱动 PiSession 迁移为 ready(1.3/1.4)
 *  - 既有订阅者收到广播的 session-status{ready}(2.1)
 *  - **延迟订阅**(晚于 ready)仍立即收到粘性 session-status{ready}(2.4,跨进程防丢帧)
 *  - 子进程就绪前早退 → error{exit-before-ready}(4.2)
 *
 * 不使用 MockChannel;断言针对真实子进程产出。
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type {
  SpawnSpec,
  SseFrame,
  SessionLifecycleState,
} from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { makeResolved } from "./fixtures.js";

const STUB = fileURLToPath(
  new URL("./fixtures/readiness-stub-process.mjs", import.meta.url),
);

function makeSpec(mode?: string): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [STUB],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(mode ? { READINESS_STUB_MODE: mode } : {}),
    } as Record<string, string>,
  };
}

function statuses(frames: SseFrame[]): SessionLifecycleState[] {
  return frames
    .filter(
      (f) =>
        f.kind === "control" &&
        (f as { payload?: { control?: string } }).payload?.control ===
          "session-status",
    )
    .map(
      (f) =>
        (f as { payload: { state: SessionLifecycleState } }).payload.state,
    );
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

let active: { session: PiSession; channel: SessionChannel }[] = [];

function makeSession(mode?: string): {
  session: PiSession;
  channel: SessionChannel;
} {
  const channel = new PiRpcProcess(makeSpec(mode)) as unknown as SessionChannel;
  const session = new PiSession({
    id: `rd-int-${active.length}`,
    resolved: makeResolved(),
    channel,
    idleMs: 0,
    readinessHandshake: true,
    readinessProbeTimeoutMs: 3000,
  });
  const entry = { session, channel };
  active.push(entry);
  return entry;
}

afterEach(async () => {
  for (const { session } of active) {
    try {
      await session.stop("shutdown");
    } catch {
      /* ignore */
    }
  }
  active = [];
});

describe("会话就绪握手 · 真实子进程集成 (Task 5.1)", () => {
  it("探针驱动真子进程就绪,既有订阅者收到 session-status{ready}", async () => {
    const { session } = makeSession();
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await waitFor(() => session.lifecycle === "ready");
    expect(statuses(frames)).toContain("ready");
  });

  it("延迟订阅(晚于 ready)仍立即收到粘性 session-status{ready}(2.4)", async () => {
    const { session } = makeSession();
    await waitFor(() => session.lifecycle === "ready");

    // 此刻才订阅 —— 跨真实进程,仍应通过粘性回放立即拿到 ready。
    const late: SseFrame[] = [];
    session.subscribe((f) => late.push(f));
    expect(statuses(late)).toEqual(["ready"]);
  });

  it("子进程就绪前早退 → error{exit-before-ready}(4.2)", async () => {
    const { session } = makeSession("silent-exit");
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await waitFor(() => session.lifecycle === "error");
    const ss = frames.filter(
      (f) =>
        f.kind === "control" &&
        (f as { payload?: { control?: string } }).payload?.control ===
          "session-status",
    );
    const last = ss[ss.length - 1] as
      | { payload: { state: string; code?: string } }
      | undefined;
    expect(last?.payload.state).toBe("error");
    expect(last?.payload.code).toBe("exit-before-ready");
  });
});
