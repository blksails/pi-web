/**
 * 真实子进程日志通道集成测试（任务 5.3）。
 *
 * 策略：spawn 一个最小 Node.js stub 子进程（logging-stub-process.mjs），
 * 该 stub 通过 stderr 写 sentinel 格式结构化日志行和纯文本行，通过 stdout 写
 * 合法 pi RPC JSONL 帧。PiRpcProcess 持有真实子进程，PiSession 订阅其 onStderr，
 * 完整跑通 stderr→StderrLogParser→LogRingBuffer→control:logs 帧链路。
 * 同时经 GET /sessions/:id/logs 路由验证 REST 取回路径。
 *
 * 此测试中不使用 MockChannel，所有断言都针对真实 spawn 的子进程产出。
 *
 * 覆盖：
 *  - Req 2.2/2.3：真实子进程 stderr → 主进程 onStderr 管道
 *  - Req 2.4/4.2：sentinel 日志行 → control:logs 帧（含分配 id）
 *  - Req 4.3：非 sentinel stderr 文本行 → proc:stderr 包装条目
 *  - Req 9.1：既有 message_update/agent_end 帧与日志帧互不干扰（回归）
 *  - Req 6.3：GET /sessions/:id/logs 取回 ring buffer 条目
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { SpawnSpec, SseFrame, LogEntry } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { makeResolved } from "./fixtures.js";

const STUB = fileURLToPath(
  new URL("./fixtures/logging-stub-process.mjs", import.meta.url),
);

function makeSpec(): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [STUB],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

/** 从帧数组中提取所有 control:logs 帧的 entries。 */
function extractLogEntries(frames: SseFrame[]): (LogEntry & { id: string })[] {
  const entries: (LogEntry & { id: string })[] = [];
  for (const f of frames) {
    if (
      f.kind === "control" &&
      (f as { payload?: { control?: string } }).payload?.control === "logs"
    ) {
      const payload = (f as { payload: { entries: (LogEntry & { id: string })[] } }).payload;
      entries.push(...payload.entries);
    }
  }
  return entries;
}

/** 判断 SseFrame 是否属于现有的 RPC 消息帧（uiMessageChunk 或非 logs 的 control）。 */
function isLegacyFrame(f: SseFrame): boolean {
  if (f.kind === "uiMessageChunk") return true;
  if (f.kind === "control") {
    const ctrl = (f as { payload?: { control?: string } }).payload?.control;
    return ctrl !== "logs";
  }
  return false;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c().catch(() => undefined)));
  cleanups.length = 0;
});

describe("real subprocess logging channel integration", () => {
  /**
   * 核心端到端测试：
   * 真实子进程 stderr sentinel 行 → PiSession.handleStderr → ring buffer → control:logs 帧。
   * 等待 agent_end（via prompt）后，检查 frames 数组中是否有 logs 帧。
   */
  it("stderr sentinel lines from real subprocess produce control:logs frames with ids (Req 2.4, 4.2)", async () => {
    const channel: SessionChannel = new PiRpcProcess(makeSpec());
    const store = new InMemorySessionStore(true);
    const mgr = new SessionManager({ store, idleMs: 0 });
    const { session } = mgr.createSession({ resolved: makeResolved(), channel });
    cleanups.push(() => session.stop());

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Trigger prompt — the stub emits startup stderr logs before and during this.
    await session.prompt("hello");

    // Give the event loop a tick for any remaining stderr data to arrive.
    await new Promise<void>((r) => setTimeout(r, 50));

    const logEntries = extractLogEntries(frames);

    // Must have received at least the startup sentinel logs from the subprocess.
    expect(logEntries.length).toBeGreaterThanOrEqual(1);

    // All sentinel entries must have string ids assigned by the ring buffer.
    for (const e of logEntries) {
      expect(typeof e.id).toBe("string");
      expect(e.id.length).toBeGreaterThan(0);
    }

    // The startup info log (ns=agent:init, msg="stub agent starting") must appear.
    const initLog = logEntries.find((e) => e.ns === "agent:init");
    expect(initLog).toBeDefined();
    expect(initLog?.msg).toBe("stub agent starting");
    expect(initLog?.level).toBe("info");
  });

  it("non-sentinel stderr lines are wrapped as proc:stderr entries (Req 4.3)", async () => {
    const channel: SessionChannel = new PiRpcProcess(makeSpec());
    const store = new InMemorySessionStore(true);
    const mgr = new SessionManager({ store, idleMs: 0 });
    const { session } = mgr.createSession({ resolved: makeResolved(), channel });
    cleanups.push(() => session.stop());

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await session.prompt("hello");
    await new Promise<void>((r) => setTimeout(r, 50));

    const logEntries = extractLogEntries(frames);

    // The stub writes one plain line: "raw stderr noise from agent boot"
    const procEntry = logEntries.find((e) => e.ns === "proc:stderr");
    expect(procEntry).toBeDefined();
    expect(procEntry?.msg).toBe("raw stderr noise from agent boot");
    expect(procEntry?.level).toBe("warn");
  });

  it("GET /sessions/:id/logs returns all ring-buffered log entries (Req 6.3)", async () => {
    const store = new InMemorySessionStore(true);
    const mgr = new SessionManager({ store, idleMs: 0 });
    const channel: SessionChannel = new PiRpcProcess(makeSpec());
    const { sessionId, session } = mgr.createSession({ resolved: makeResolved(), channel });
    cleanups.push(() => session.stop());

    const handler = createPiWebHandler({ manager: mgr, store });

    // Let the subprocess emit startup logs and complete a prompt.
    await session.prompt("hello");
    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await handler(
      new Request(`http://localhost/sessions/${sessionId}/logs`, { method: "GET" }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: (LogEntry & { id: string })[] };
    expect(Array.isArray(body.entries)).toBe(true);
    // Must have at least the startup logs (agent:init + agent:config + proc:stderr).
    expect(body.entries.length).toBeGreaterThanOrEqual(1);

    // Each entry must carry a string id.
    for (const e of body.entries) {
      expect(typeof e.id).toBe("string");
    }

    // The sentinel logs must be present (not proc:stderr-wrapped).
    const sentinel = body.entries.find((e) => e.ns === "agent:init");
    expect(sentinel).toBeDefined();
    expect(sentinel?.msg).toBe("stub agent starting");
  });

  /**
   * Req 9.1 回归：日志帧与既有 message_update/agent_end 帧互不干扰。
   * 真实子进程走完一次 prompt，校验：
   *  - 有 uiMessageChunk 帧（text-delta）存在
   *  - 同时有 control:logs 帧存在
   *  - 二者不互相覆盖或丢失
   */
  it("existing frame types (uiMessageChunk) coexist with control:logs frames without interference (Req 9.1)", async () => {
    const channel: SessionChannel = new PiRpcProcess(makeSpec());
    const store = new InMemorySessionStore(true);
    const mgr = new SessionManager({ store, idleMs: 0 });
    const { session } = mgr.createSession({ resolved: makeResolved(), channel });
    cleanups.push(() => session.stop());

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    await session.prompt("hello");
    await new Promise<void>((r) => setTimeout(r, 50));

    // Should have uiMessageChunk frames (text-delta from message_update).
    const uiChunks = frames.filter((f) => f.kind === "uiMessageChunk");
    expect(uiChunks.length).toBeGreaterThanOrEqual(1);

    // Should have control:logs frames from stderr.
    const logsFrames = frames.filter(
      (f) =>
        f.kind === "control" &&
        (f as { payload?: { control?: string } }).payload?.control === "logs",
    );
    expect(logsFrames.length).toBeGreaterThanOrEqual(1);

    // Legacy frames (non-logs) must still be present and unmodified.
    const legacyFrames = frames.filter(isLegacyFrame);
    expect(legacyFrames.length).toBeGreaterThanOrEqual(1);

    // Logs frames must NOT appear in uiMessageChunk category.
    for (const lf of logsFrames) {
      expect(lf.kind).not.toBe("uiMessageChunk");
    }
  });

  it("prompt-phase stderr log (warn level) also appears in ring buffer via GET /logs (Req 2.3)", async () => {
    const store = new InMemorySessionStore(true);
    const mgr = new SessionManager({ store, idleMs: 0 });
    const channel: SessionChannel = new PiRpcProcess(makeSpec());
    const { sessionId, session } = mgr.createSession({ resolved: makeResolved(), channel });
    cleanups.push(() => session.stop());

    const handler = createPiWebHandler({ manager: mgr, store });

    await session.prompt("hello");
    await new Promise<void>((r) => setTimeout(r, 50));

    // Query only warn+ entries.
    const res = await handler(
      new Request(`http://localhost/sessions/${sessionId}/logs?level=warn`, { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: (LogEntry & { id: string })[] };

    // The stub emits "handling prompt" at warn level on ns=agent:prompt.
    // It also emits "raw stderr noise" wrapped as proc:stderr warn.
    // Both should appear in warn-filtered results.
    const warnPlus = body.entries.filter(
      (e) => e.level === "warn" || e.level === "error",
    );
    expect(warnPlus.length).toBeGreaterThanOrEqual(1);

    // Specifically, the structured warn log from the prompt handler must be present.
    const promptLog = body.entries.find(
      (e) => e.ns === "agent:prompt" && e.msg === "handling prompt",
    );
    expect(promptLog).toBeDefined();
    expect(promptLog?.level).toBe("warn");
  });
});
