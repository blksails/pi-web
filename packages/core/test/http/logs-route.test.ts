/**
 * GET /sessions/:id/logs 路由集成测试（任务 3.1）。
 *
 * 覆盖：
 *  - 返回 { entries } 含会话已入库的日志条目
 *  - 支持 level 查询参数过滤
 *  - 支持 limit 查询参数过滤
 *  - 会话不存在 → 404
 */
import { describe, it, expect } from "vitest";
import { LOG_SENTINEL } from "@blksails/pi-web-logger";
import type { LogEntry } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/create-handler.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "../session/mock-channel.js";
import { makeResolved } from "../session/fixtures.js";

function makeLogLine(entry: Omit<LogEntry, "id">): string {
  return LOG_SENTINEL + JSON.stringify(entry) + "\n";
}

function makeHandlerWithLogs(): {
  handler: (req: Request) => Promise<Response>;
  channel: MockChannel;
} {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const channel = new MockChannel();
  const session = new PiSession({
    id: "logs-sess",
    resolved: makeResolved(),
    channel,
    idleMs: 0,
  });
  store.create(session);

  // Seed some log entries.
  channel.emitStderr(makeLogLine({ level: "debug", ns: "a", msg: "dbg", ts: 1 }));
  channel.emitStderr(makeLogLine({ level: "info", ns: "b", msg: "inf", ts: 2 }));
  channel.emitStderr(makeLogLine({ level: "warn", ns: "c", msg: "wrn", ts: 3 }));

  const handler = createPiWebHandler({ manager, store });
  return { handler, channel };
}

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

describe("GET /sessions/:id/logs", () => {
  it("returns { entries } with all seeded entries", async () => {
    const { handler } = makeHandlerWithLogs();
    const res = await handler(get("/sessions/logs-sess/logs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: LogEntry[] };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(3);
  });

  it("filters by level query param", async () => {
    const { handler } = makeHandlerWithLogs();
    const res = await handler(get("/sessions/logs-sess/logs?level=warn"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: LogEntry[] };
    expect(body.entries.every((e) => e.level === "warn" || e.level === "error")).toBe(true);
    expect(body.entries.length).toBe(1);
  });

  it("limits entries via limit query param", async () => {
    const { handler } = makeHandlerWithLogs();
    const res = await handler(get("/sessions/logs-sess/logs?limit=2"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: LogEntry[] };
    expect(body.entries.length).toBe(2);
  });

  it("returns 404 for unknown session", async () => {
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const handler = createPiWebHandler({ manager, store });
    const res = await handler(get("/sessions/no-such/logs"));
    expect(res.status).toBe(404);
  });

  it("entries have id fields assigned by ring buffer", async () => {
    const { handler } = makeHandlerWithLogs();
    const res = await handler(get("/sessions/logs-sess/logs"));
    const body = (await res.json()) as { entries: LogEntry[] };
    for (const e of body.entries) {
      expect(typeof e.id).toBe("string");
    }
  });
});
