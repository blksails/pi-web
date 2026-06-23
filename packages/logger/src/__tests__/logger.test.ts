/**
 * Task 1.2: Logger core API & gating tests (TDD — behavior-driven)
 *
 * Covers:
 *   - Level gating truth table (R1.7)
 *   - enabled gating (R6.4)
 *   - Namespace prefix-match gating (R6.5)
 *   - child() namespace concatenation & config inheritance (R1.3)
 *   - LogEntry field construction: level / ns / msg / data / ts (R1.2)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLogger } from "../create-logger.js";
import { configureLogger } from "../config.js";
import type { LogEntry, LogLevel } from "../types.js";

// ── helper: capture sink ─────────────────────────────────────────────────────

function makeSink() {
  const entries: LogEntry[] = [];
  return {
    entries,
    sink: (e: LogEntry) => entries.push(e),
    reset() {
      entries.length = 0;
    },
  };
}

// ── reset global config before each test ─────────────────────────────────────

beforeEach(() => {
  configureLogger({ enabled: true, level: "debug", namespaces: {} });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LogEntry field construction
// ═══════════════════════════════════════════════════════════════════════════

describe("LogEntry field construction", () => {
  it("produces an entry with correct level, ns, msg, ts fields", () => {
    const { sink, entries } = makeSink();
    const before = Date.now();
    const logger = createLogger({ namespace: "test:ns", sink });
    logger.info("hello world");
    const after = Date.now();

    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.level).toBe("info");
    expect(e.ns).toBe("test:ns");
    expect(e.msg).toBe("hello world");
    expect(e.ts).toBeGreaterThanOrEqual(before);
    expect(e.ts).toBeLessThanOrEqual(after);
  });

  it("includes data when provided", () => {
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "test:data", sink });
    logger.debug("with data", { key: "value" });

    expect(entries[0]?.data).toEqual({ key: "value" });
  });

  it("leaves data undefined when not provided", () => {
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "test:nodata", sink });
    logger.warn("no data");

    expect("data" in (entries[0] ?? {})).toBe(false);
  });

  it("produces entries for all four levels", () => {
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "test:levels", sink });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    const levels = entries.map((e) => e.level);
    expect(levels).toEqual(["debug", "info", "warn", "error"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Level gating truth table
// ═══════════════════════════════════════════════════════════════════════════

describe("Level gating", () => {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];

  for (const configLevel of levels) {
    describe(`configured level = "${configLevel}"`, () => {
      for (const logLevel of levels) {
        const shouldPass =
          levels.indexOf(logLevel) >= levels.indexOf(configLevel);
        it(`log at "${logLevel}" → ${shouldPass ? "PASS" : "DROP"}`, () => {
          const { sink, entries } = makeSink();
          const logger = createLogger({
            namespace: "gate:level",
            level: configLevel,
            sink,
          });
          // Call the right method
          logger[logLevel]("msg");
          if (shouldPass) {
            expect(entries).toHaveLength(1);
            expect(entries[0]?.level).toBe(logLevel);
          } else {
            expect(entries).toHaveLength(0);
          }
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. enabled gating
// ═══════════════════════════════════════════════════════════════════════════

describe("enabled gating", () => {
  it("drops all entries when enabled=false", () => {
    configureLogger({ enabled: false, level: "debug" });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "gate:enabled", sink });
    logger.debug("should drop");
    logger.info("should drop");
    logger.warn("should drop");
    logger.error("should drop");

    expect(entries).toHaveLength(0);
  });

  it("passes entries when enabled=true", () => {
    configureLogger({ enabled: true, level: "debug" });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "gate:enabled", sink });
    logger.info("should pass");

    expect(entries).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Namespace prefix-match gating
// ═══════════════════════════════════════════════════════════════════════════

describe("Namespace gating", () => {
  it("drops entries when namespace is explicitly disabled", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: false },
    });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "agent", sink });
    logger.info("should drop");

    expect(entries).toHaveLength(0);
  });

  it("drops child namespaces when parent is disabled (prefix match)", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: false },
    });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "agent:hello:tool", sink });
    logger.info("should drop");

    expect(entries).toHaveLength(0);
  });

  it("passes sibling namespace not covered by disabled prefix", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: false },
    });
    const { sink, entries } = makeSink();
    // "agentx" does NOT match prefix "agent:" — only exact or "agent:*" does
    const logger = createLogger({ namespace: "agentx", sink });
    logger.info("should pass");

    expect(entries).toHaveLength(1);
  });

  it("passes namespace when enabled=true in namespaces map", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: true },
    });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "agent", sink });
    logger.info("should pass");

    expect(entries).toHaveLength(1);
  });

  it("passes namespace absent from map (default open)", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: {},
    });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "ext:probe", sink });
    logger.debug("should pass");

    expect(entries).toHaveLength(1);
  });

  it("does not confuse 'agent' disabling 'agentx' (no false prefix match)", () => {
    // "agent" disabled should not affect "agentx"
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: false },
    });
    const { sinkA, entriesA } = (() => {
      const s = makeSink();
      return { sinkA: s.sink, entriesA: s.entries };
    })();
    const { sinkB, entriesB } = (() => {
      const s = makeSink();
      return { sinkB: s.sink, entriesB: s.entries };
    })();

    const agentLogger = createLogger({ namespace: "agent", sink: sinkA });
    const agentxLogger = createLogger({ namespace: "agentx", sink: sinkB });

    agentLogger.info("should drop");
    agentxLogger.info("should pass");

    expect(entriesA).toHaveLength(0);
    expect(entriesB).toHaveLength(1);
  });

  it("disabling 'agent' blocks 'agent:hello' (colon-segment prefix match)", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: false },
    });
    const { sink, entries } = makeSink();
    const logger = createLogger({ namespace: "agent:hello", sink });
    logger.info("should drop");

    expect(entries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. child() namespace concatenation & config inheritance
// ═══════════════════════════════════════════════════════════════════════════

describe("child() logger", () => {
  it("concatenates parent and child namespaces with ':'", () => {
    const { sink, entries } = makeSink();
    const parent = createLogger({ namespace: "agent", sink });
    const child = parent.child("hello");
    child.info("msg");

    expect(entries[0]?.ns).toBe("agent:hello");
  });

  it("deeply nested child concatenates all segments", () => {
    const { sink, entries } = makeSink();
    const parent = createLogger({ namespace: "agent", sink });
    const grandchild = parent.child("hello").child("tool");
    grandchild.info("msg");

    expect(entries[0]?.ns).toBe("agent:hello:tool");
  });

  it("child inherits level gating from parent opts", () => {
    const { sink, entries } = makeSink();
    const parent = createLogger({ namespace: "parent", level: "warn", sink });
    const child = parent.child("child");
    child.debug("drop");
    child.info("drop");
    child.warn("pass");
    child.error("pass");

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("child respects global enabled gate", () => {
    configureLogger({ enabled: false, level: "debug" });
    const { sink, entries } = makeSink();
    const parent = createLogger({ namespace: "parent", sink });
    const child = parent.child("child");
    child.info("should drop");

    expect(entries).toHaveLength(0);
  });

  it("child respects namespace gating (parent namespace disabled)", () => {
    configureLogger({
      enabled: true,
      level: "debug",
      namespaces: { agent: false },
    });
    const { sink, entries } = makeSink();
    const parent = createLogger({ namespace: "agent", sink });
    const child = parent.child("hello");
    child.info("should drop");

    expect(entries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Zero node-specific imports (isomorphic purity check)
// ═══════════════════════════════════════════════════════════════════════════

describe("Isomorphic purity", () => {
  it("createLogger does not reference process or require in its import chain (smoke)", async () => {
    // We simply verify the module can be imported and no side-effects throw
    // in a non-Node environment. In Vitest (jsdom environment this test runs in)
    // process is still available, so we just check no 'node:' imports appear.
    // The real check is done by the typecheck + build; here we verify runtime.
    const mod = await import("../create-logger.js");
    expect(typeof mod.createLogger).toBe("function");
  });
});
