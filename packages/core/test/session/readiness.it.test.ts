/**
 * 会话就绪判定集成测试(spec runner-ready-frame,T4;前身为 session-readiness-handshake Task 5.1)。
 *
 * 用**真实 spawn 的子进程**(readiness-stub-process.mjs,经 PiRpcProcess 真实通道)验证:
 *  - cli 单发 get_commands 对真子进程可得到响应 → 驱动 PiSession 迁移为 ready(6.1/6.2)
 *  - runner 形态:子进程主动上报的 `runner_ready` 帧跨真实进程驱动 ready(2.1/2.3)
 *  - **spawn 后立即写入**的命令不丢失、可得到响应(1.1;真实 runner 的根因级验证
 *    另由 packages/runner 的 4 个 subprocess it 档承担 —— 它们等真 runner 的
 *    lifecycle→ready,真 runner 不发帧即超时红)
 *  - 既有订阅者收到广播的 session-status{ready};延迟订阅粘性回放(7.1)
 *  - 子进程就绪前早退 → error{exit-before-ready}(4.5)
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

function makeSession(
  mode?: string,
  sessionMode: "cli" | "custom" = "cli",
): {
  session: PiSession;
  channel: SessionChannel;
} {
  const channel = new PiRpcProcess(makeSpec(mode)) as unknown as SessionChannel;
  const session = new PiSession({
    id: `rd-int-${active.length}`,
    resolved: makeResolved({ mode: sessionMode }),
    channel,
    idleMs: 0,
    readinessHandshake: true,
    readyTimeoutMs: 3000,
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

describe("会话就绪判定 · 真实子进程集成 (runner-ready-frame T4)", () => {
  it("cli 单发驱动真子进程就绪,既有订阅者收到 session-status{ready}(6.1)", async () => {
    const { session } = makeSession();
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await waitFor(() => session.lifecycle === "ready");
    expect(statuses(frames)).toContain("ready");
  });

  it("runner 形态:子进程主动上报 runner_ready 帧 → ready(2.1/2.3,跨真实进程)", async () => {
    // custom 模式:服务端不发任何探针请求,就绪只能来自子进程的 ready 帧 ——
    // 若帧未到达/未被识别,本用例将卡到 waitFor 超时(具备判别力)。
    const { session } = makeSession("ready-frame", "custom");
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await waitFor(() => session.lifecycle === "ready");
    expect(statuses(frames)).toContain("ready");
  });

  it("spawn 后立即写入的命令不丢失,可得到响应(1.1)", async () => {
    // 构造后**立即**发命令(不等 ready)—— 通道/子进程早期窗口内的行不得丢失。
    // 若早写行被吞,getCommands 永不 settle,用例在 Promise.race 超时处红。
    const { session } = makeSession("ready-frame", "custom");
    const res = await Promise.race([
      session.getCommands(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("early-write lost: no response in 4s")), 4000),
      ),
    ]);
    expect((res as { type: string }).type).toBe("response");
  });

  it("延迟订阅(晚于 ready)仍立即收到粘性 session-status{ready}(2.4)", async () => {
    const { session } = makeSession();
    await waitFor(() => session.lifecycle === "ready");

    // 此刻才订阅 —— 跨真实进程,仍应通过粘性回放立即拿到 ready。
    const late: SseFrame[] = [];
    session.subscribe((f) => late.push(f));
    expect(statuses(late)).toEqual(["ready"]);
  });

  it("runner 真实重生(onRestart)后重新握手:initializing → ready(5.1)", async () => {
    const { session, channel } = makeSession();
    await waitFor(() => session.lifecycle === "ready");

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // 真实重生:PiRpcProcess kill 旧子进程 + 重 spawn 新 stub;onRestart 在重生后驱动重探针。
    (channel as unknown as { requestRestart: () => void }).requestRestart();

    // 复位经历 initializing,再由新进程探针应答回到 ready。
    await waitFor(() => statuses(frames).includes("initializing"));
    await waitFor(() => session.lifecycle === "ready");
    const seq = statuses(frames);
    expect(seq).toContain("initializing");
    expect(seq[seq.length - 1]).toBe("ready");
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
