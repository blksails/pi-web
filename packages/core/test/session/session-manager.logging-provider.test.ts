/**
 * SessionManager 日志门控 provider 透传测试（任务 4.4 修复轮）。
 *
 * 验证 loggingConfigProvider 从 SessionManagerOptions → createSession → PiSession
 * 的生产链路接通。注入 stub provider（enabled:false）→ 向会话 channel 喂 sentinel
 * stderr → 断言日志被门控（不产帧、不入 buffer）。
 *
 * 这证明 provider 真实流通到 PiSession，而非仅靠 GATE_DEFAULT 全开。
 */
import { describe, it, expect } from "vitest";
import { LOG_SENTINEL } from "@blksails/pi-web-logger";
import type { SseFrame, LogEntry } from "@blksails/pi-web-protocol";
import type { LoggingConfig } from "@blksails/pi-web-protocol";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function makeLogLine(entry: Omit<LogEntry, "id">): string {
  return LOG_SENTINEL + JSON.stringify(entry);
}

/** 从帧数组提取所有 control:logs 帧的条目。 */
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

function makeManagerWithProvider(config: Partial<LoggingConfig>): {
  manager: SessionManager;
  store: InMemorySessionStore;
} {
  const store = new InMemorySessionStore(true);
  const resolvedConfig: LoggingConfig = {
    enabled: true,
    level: "debug",
    namespaces: undefined,
    panelDefaultLevel: "info",
    ...config,
  };
  const manager = new SessionManager({
    store,
    idleMs: 0,
    loggingConfigProvider: () => Promise.resolve(resolvedConfig),
  });
  return { manager, store };
}

describe("SessionManager loggingConfigProvider propagation (task 4.4 fix)", () => {
  it("provider with enabled=false suppresses all sentinel logs in created session", async () => {
    const { manager } = makeManagerWithProvider({ enabled: false });
    const channel = new MockChannel();
    const { session } = manager.createSession({
      resolved: makeResolved(),
      channel,
    });

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Trigger async config load via first stderr chunk
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "probe", ts: 1 }) + "\n",
    );
    await new Promise<void>((r) => setTimeout(r, 20));

    // After config is loaded, emit more logs — should all be dropped
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "dropped-1", ts: 2 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "warn", ns: "agent:y", msg: "dropped-2", ts: 3 }) + "\n",
    );
    await new Promise<void>((r) => setTimeout(r, 20));

    const entries = extractLogEntries(frames);
    // All dropped because enabled=false
    expect(entries).toHaveLength(0);
    expect(session.getLogs({})).toHaveLength(0);
  });

  it("provider with level=error suppresses info/warn, keeps error", async () => {
    const { manager } = makeManagerWithProvider({ level: "error" });
    const channel = new MockChannel();
    const { session } = manager.createSession({
      resolved: makeResolved(),
      channel,
    });

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Trigger async config load
    channel.emitStderr(
      makeLogLine({ level: "error", ns: "agent:x", msg: "probe-error", ts: 1 }) + "\n",
    );
    await new Promise<void>((r) => setTimeout(r, 20));

    // Emit info, warn, and error
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "dropped-info", ts: 2 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "warn", ns: "agent:x", msg: "dropped-warn", ts: 3 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "error", ns: "agent:x", msg: "kept-error", ts: 4 }) + "\n",
    );
    await new Promise<void>((r) => setTimeout(r, 20));

    const buffered = session.getLogs({});
    const infoEntries = buffered.filter((e) => e.level === "info" && e.msg === "dropped-info");
    const warnEntries = buffered.filter((e) => e.level === "warn" && e.msg === "dropped-warn");
    const errorEntries = buffered.filter((e) => e.level === "error" && e.msg === "kept-error");

    expect(infoEntries).toHaveLength(0);
    expect(warnEntries).toHaveLength(0);
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("provider is per-session: different sessions share same provider", async () => {
    const { manager } = makeManagerWithProvider({ enabled: false });

    const ch1 = new MockChannel();
    const ch2 = new MockChannel();
    const { session: s1 } = manager.createSession({ resolved: makeResolved(), channel: ch1 });
    const { session: s2 } = manager.createSession({ resolved: makeResolved(), channel: ch2 });

    const frames1: SseFrame[] = [];
    const frames2: SseFrame[] = [];
    s1.subscribe((f) => frames1.push(f));
    s2.subscribe((f) => frames2.push(f));

    // Trigger config load and emit logs on both
    ch1.emitStderr(makeLogLine({ level: "info", ns: "agent:x", msg: "s1-msg", ts: 1 }) + "\n");
    ch2.emitStderr(makeLogLine({ level: "info", ns: "agent:x", msg: "s2-msg", ts: 1 }) + "\n");
    await new Promise<void>((r) => setTimeout(r, 20));

    ch1.emitStderr(makeLogLine({ level: "info", ns: "agent:x", msg: "s1-after", ts: 2 }) + "\n");
    ch2.emitStderr(makeLogLine({ level: "info", ns: "agent:x", msg: "s2-after", ts: 2 }) + "\n");
    await new Promise<void>((r) => setTimeout(r, 20));

    // Both sessions should have enabled=false gating → no logs
    expect(s1.getLogs({})).toHaveLength(0);
    expect(s2.getLogs({})).toHaveLength(0);
  });

  it("no provider (backward compat) → all entries pass through via GATE_DEFAULT", () => {
    // No loggingConfigProvider → manager uses default behavior (no provider passed to PiSession)
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const channel = new MockChannel();
    const { session } = manager.createSession({
      resolved: makeResolved(),
      channel,
    });

    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    channel.emitStderr(
      makeLogLine({ level: "debug", ns: "agent:x", msg: "debug-msg", ts: 1 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:y", msg: "info-msg", ts: 2 }) + "\n",
    );

    const entries = extractLogEntries(frames);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const buffered = session.getLogs({});
    expect(buffered.length).toBeGreaterThanOrEqual(2);
  });
});
