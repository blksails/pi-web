/**
 * Task 1.3: Dual-sink & runtime config tests (TDD — behavior-driven)
 *
 * Covers:
 *   - LOG_SENTINEL constant + serializeLogLine (R1.4)
 *   - node-sink: writes sentinel+JSON+\n to stderr, not stdout (R1.4)
 *   - browser-sink: ring buffer, subscribe/emit, getBrowserLogs, capacity eviction (R1.5/R3.4)
 *   - Sink selection: typeof window → browser-sink, else → node-sink (R1.6)
 *   - Environment-variable initialization for Node-side config (R6)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { LogEntry } from "../types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: "info",
    ns: "test:ns",
    msg: "hello",
    ts: 1700000000000,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LOG_SENTINEL & serializeLogLine
// ═══════════════════════════════════════════════════════════════════════════

describe("LOG_SENTINEL & serializeLogLine", () => {
  it("LOG_SENTINEL is a non-empty string", async () => {
    const { LOG_SENTINEL } = await import("../node-sink.js");
    expect(typeof LOG_SENTINEL).toBe("string");
    expect(LOG_SENTINEL.length).toBeGreaterThan(0);
  });

  it("serializeLogLine returns sentinel + JSON.stringify(entry) + newline", async () => {
    const { LOG_SENTINEL, serializeLogLine } = await import("../node-sink.js");
    const entry = makeEntry();
    const line = serializeLogLine(entry);
    expect(line).toBe(LOG_SENTINEL + JSON.stringify(entry) + "\n");
  });

  it("serializeLogLine output starts with LOG_SENTINEL", async () => {
    const { LOG_SENTINEL, serializeLogLine } = await import("../node-sink.js");
    const line = serializeLogLine(makeEntry());
    expect(line.startsWith(LOG_SENTINEL)).toBe(true);
  });

  it("serializeLogLine output ends with newline", async () => {
    const { serializeLogLine } = await import("../node-sink.js");
    const line = serializeLogLine(makeEntry());
    expect(line.endsWith("\n")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. node-sink: writes to stderr, not stdout
// ═══════════════════════════════════════════════════════════════════════════

describe("node-sink", () => {
  it("calls process.stderr.write with sentinel+JSON+newline", async () => {
    const stderrSpy = vi.spyOn(globalThis.process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(globalThis.process.stdout, "write").mockImplementation(() => true);

    try {
      const { nodeSink, LOG_SENTINEL, serializeLogLine } = await import("../node-sink.js");
      const entry = makeEntry({ level: "warn", msg: "test stderr write" });
      nodeSink(entry);

      const expectedLine = LOG_SENTINEL + JSON.stringify(entry) + "\n";
      expect(stderrSpy).toHaveBeenCalledWith(expectedLine);
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it("does not throw when process.stderr.write throws (swallows errors)", async () => {
    const stderrSpy = vi.spyOn(globalThis.process.stderr, "write").mockImplementation(() => {
      throw new Error("write error");
    });
    try {
      const { nodeSink } = await import("../node-sink.js");
      expect(() => nodeSink(makeEntry())).not.toThrow();
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. browser-sink: ring buffer, subscribe, getBrowserLogs, capacity eviction
// ═══════════════════════════════════════════════════════════════════════════

describe("browser-sink", () => {
  // Reset module state between tests by re-importing a fresh module
  // We rely on vi.resetModules() before each test in this group
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("getBrowserLogs returns empty array initially", async () => {
    const { getBrowserLogs } = await import("../browser-sink.js");
    expect(getBrowserLogs()).toEqual([]);
  });

  it("push via browserSink appends entry; getBrowserLogs returns it", async () => {
    const { browserSink, getBrowserLogs } = await import("../browser-sink.js");
    const entry = makeEntry({ msg: "first" });
    browserSink(entry);
    expect(getBrowserLogs()).toHaveLength(1);
    expect(getBrowserLogs()[0]).toEqual(entry);
  });

  it("subscribeBrowserLogs callback is invoked with the entry on push", async () => {
    const { browserSink, subscribeBrowserLogs } = await import("../browser-sink.js");
    const received: LogEntry[] = [];
    subscribeBrowserLogs((e) => received.push(e));

    const entry = makeEntry({ msg: "notify me" });
    browserSink(entry);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(entry);
  });

  it("multiple subscribers are all notified", async () => {
    const { browserSink, subscribeBrowserLogs } = await import("../browser-sink.js");
    const a: LogEntry[] = [];
    const b: LogEntry[] = [];
    subscribeBrowserLogs((e) => a.push(e));
    subscribeBrowserLogs((e) => b.push(e));

    browserSink(makeEntry({ msg: "both" }));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("exceeding BROWSER_LOG_CAPACITY evicts oldest entries", async () => {
    const { browserSink, getBrowserLogs, BROWSER_LOG_CAPACITY } = await import("../browser-sink.js");

    // Fill beyond capacity
    const total = BROWSER_LOG_CAPACITY + 10;
    for (let i = 0; i < total; i++) {
      browserSink(makeEntry({ msg: `entry-${i}` }));
    }

    const logs = getBrowserLogs();
    expect(logs.length).toBe(BROWSER_LOG_CAPACITY);
    // Oldest 10 evicted; first entry should be entry-10
    expect(logs[0]?.msg).toBe("entry-10");
    expect(logs[logs.length - 1]?.msg).toBe(`entry-${total - 1}`);
  });

  it("eviction notifies subscribers (they see the new entry)", async () => {
    const { browserSink, subscribeBrowserLogs, BROWSER_LOG_CAPACITY } = await import("../browser-sink.js");
    const received: LogEntry[] = [];
    subscribeBrowserLogs((e) => received.push(e));

    const total = BROWSER_LOG_CAPACITY + 5;
    for (let i = 0; i < total; i++) {
      browserSink(makeEntry({ msg: `entry-${i}` }));
    }

    // All entries (including over-capacity ones) were notified
    expect(received).toHaveLength(total);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Sink selection: typeof window → browser-sink, else → node-sink
// ═══════════════════════════════════════════════════════════════════════════

describe("Sink selection (sink.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("returns node-sink when window is not defined", async () => {
    // Default vitest environment is node — window is undefined
    vi.stubGlobal("window", undefined);
    const { getDefaultSink } = await import("../sink.js");
    const { nodeSink } = await import("../node-sink.js");
    expect(getDefaultSink()).toBe(nodeSink);
  });

  it("returns browser-sink when window is defined", async () => {
    vi.stubGlobal("window", {});
    const { getDefaultSink } = await import("../sink.js");
    const { browserSink } = await import("../browser-sink.js");
    expect(getDefaultSink()).toBe(browserSink);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Environment-variable config initialization
// ═══════════════════════════════════════════════════════════════════════════

describe("initConfigFromEnv", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("reads PI_WEB_LOG_LEVEL from env and applies it", async () => {
    if (globalThis.process?.env) {
      globalThis.process.env["PI_WEB_LOG_LEVEL"] = "warn";
    }

    try {
      const { initConfigFromEnv, getRuntimeConfig } = await import("../config.js");
      initConfigFromEnv();
      expect(getRuntimeConfig().level).toBe("warn");
    } finally {
      if (globalThis.process?.env) {
        delete globalThis.process.env["PI_WEB_LOG_LEVEL"];
      }
    }
  });

  it("reads PI_WEB_LOG_ENABLED=false and disables logging", async () => {
    if (globalThis.process?.env) {
      globalThis.process.env["PI_WEB_LOG_ENABLED"] = "false";
    }
    try {
      const { initConfigFromEnv, getRuntimeConfig, configureLogger } = await import("../config.js");
      // First reset to enabled
      configureLogger({ enabled: true });
      initConfigFromEnv();
      expect(getRuntimeConfig().enabled).toBe(false);
    } finally {
      if (globalThis.process?.env) {
        delete globalThis.process.env["PI_WEB_LOG_ENABLED"];
      }
    }
  });

  it("reads PI_WEB_LOG_NAMESPACES as comma-separated and applies namespace config", async () => {
    if (globalThis.process?.env) {
      globalThis.process.env["PI_WEB_LOG_NAMESPACES"] = "agent,ext";
    }
    try {
      const { initConfigFromEnv, getRuntimeConfig, configureLogger } = await import("../config.js");
      configureLogger({ namespaces: {} });
      initConfigFromEnv();
      const cfg = getRuntimeConfig();
      expect(cfg.namespaces).toBeDefined();
      expect(cfg.namespaces?.["agent"]).toBe(true);
      expect(cfg.namespaces?.["ext"]).toBe(true);
    } finally {
      if (globalThis.process?.env) {
        delete globalThis.process.env["PI_WEB_LOG_NAMESPACES"];
      }
    }
  });

  it("does not throw when process is not available (browser-like env)", async () => {
    const { initConfigFromEnv } = await import("../config.js");
    const savedProcess = (globalThis as Record<string, unknown>)["process"];
    (globalThis as Record<string, unknown>)["process"] = undefined;
    try {
      expect(() => initConfigFromEnv()).not.toThrow();
    } finally {
      (globalThis as Record<string, unknown>)["process"] = savedProcess;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. createLogger uses default environment sink (not no-op) when no sink injected
// ═══════════════════════════════════════════════════════════════════════════

describe("createLogger default sink integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("when window undefined, createLogger without explicit sink writes to stderr", async () => {
    vi.stubGlobal("window", undefined);
    const stderrSpy = vi.spyOn(globalThis.process.stderr, "write").mockImplementation(() => true);
    try {
      const { createLogger } = await import("../create-logger.js");
      const logger = createLogger({ namespace: "default:sink:test" });
      logger.info("default sink test");
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
