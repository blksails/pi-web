/**
 * PiSession 服务端权威门控测试（任务 4.4）。
 *
 * 覆盖 Req 6.4/6.5/6.6 Node 侧行为：
 *  - enabled=false → 全丢（不入 buffer、不产帧）
 *  - level=warn    → 喂 info+warn 行 → 仅 warn 入 buffer/产帧
 *  - namespaces:{"agent:x":false} → 仅 agent:y 留存
 *  - 默认（无配置）→ 全产出（向后兼容）
 *
 * 注入方式：通过 PiSessionOptions.loggingConfigProvider（可选），返回
 * Promise<LoggingConfig>（已解析/默认值由调用方提供）。
 * 这样测试无需写文件系统，最小侵入既有构造。
 */
import { describe, it, expect } from "vitest";
import { LOG_SENTINEL } from "@blksails/pi-web-logger";
import type { SseFrame, LogEntry } from "@blksails/pi-web-protocol";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";
import type { LoggingConfig } from "@blksails/pi-web-protocol";

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

function makeGatedSession(config: Partial<LoggingConfig>): {
  session: PiSession;
  channel: MockChannel;
} {
  const channel = new MockChannel();
  const resolvedConfig: LoggingConfig = {
    enabled: true,
    level: "debug",
    namespaces: undefined,
    panelDefaultLevel: "info",
    ...config,
  };
  const session = new PiSession({
    id: "gate-test",
    resolved: makeResolved(),
    channel,
    idleMs: 0,
    loggingConfigProvider: () => Promise.resolve(resolvedConfig),
  });
  return { session, channel };
}

describe("PiSession server-side authority gate (task 4.4)", () => {
  it("enabled=false → sentinel logs are fully suppressed (not buffered, no frame)", async () => {
    const { session, channel } = makeGatedSession({ enabled: false });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Force config load by emitting a dummy byte first (triggers async load)
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "sentinel", ts: 1 }) + "\n",
    );

    // Wait for async config load to complete
    await new Promise<void>((r) => setTimeout(r, 10));

    // Now emit the actual test line — gate should be loaded
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "should-be-dropped", ts: 2 }) + "\n",
    );

    await new Promise<void>((r) => setTimeout(r, 10));

    const entries = extractLogEntries(frames);
    // All entries should be dropped because enabled=false
    expect(entries).toHaveLength(0);
    expect(session.getLogs({})).toHaveLength(0);
  });

  it("level=warn → info entries dropped, warn entries kept", async () => {
    const { session, channel } = makeGatedSession({ level: "warn" });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Trigger config load
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "info-msg", ts: 1 }) + "\n",
    );
    await new Promise<void>((r) => setTimeout(r, 10));

    // Now emit both info and warn
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "dropped-info", ts: 2 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "warn", ns: "agent:x", msg: "kept-warn", ts: 3 }) + "\n",
    );

    await new Promise<void>((r) => setTimeout(r, 10));

    const buffered = session.getLogs({});
    // Only warn-level entries should remain
    expect(buffered.every((e) => e.level === "warn" || e.level === "error")).toBe(true);
    const warnEntries = buffered.filter((e) => e.level === "warn");
    expect(warnEntries.length).toBeGreaterThanOrEqual(1);
    expect(warnEntries.some((e) => e.msg === "kept-warn")).toBe(true);
    // No info-level entries
    expect(buffered.filter((e) => e.level === "info")).toHaveLength(0);
  });

  it("namespaces:{agent:x:false} → agent:x dropped, agent:y kept", async () => {
    const { session, channel } = makeGatedSession({
      namespaces: { "agent:x": false },
    });
    const frames: SseFrame[] = [];
    session.subscribe((f) => frames.push(f));

    // Trigger config load
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:y", msg: "probe", ts: 1 }) + "\n",
    );
    await new Promise<void>((r) => setTimeout(r, 10));

    // Emit from both namespaces
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:x", msg: "x-msg", ts: 2 }) + "\n",
    );
    channel.emitStderr(
      makeLogLine({ level: "info", ns: "agent:y", msg: "y-msg", ts: 3 }) + "\n",
    );

    await new Promise<void>((r) => setTimeout(r, 10));

    const buffered = session.getLogs({});
    const xEntries = buffered.filter((e) => e.ns === "agent:x");
    const yEntries = buffered.filter((e) => e.ns === "agent:y");
    expect(xEntries).toHaveLength(0);
    expect(yEntries.length).toBeGreaterThanOrEqual(1);
    expect(yEntries.some((e) => e.msg === "y-msg")).toBe(true);
  });

  it("no config provider (default) → all entries pass through (backward compat)", () => {
    // No loggingConfigProvider — default open behavior
    const channel = new MockChannel();
    const session = new PiSession({
      id: "gate-default",
      resolved: makeResolved(),
      channel,
      idleMs: 0,
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
