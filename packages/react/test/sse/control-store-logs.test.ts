/**
 * Task 3.2 — control:"logs" frame routing tests.
 *
 * Verifies:
 *  - A control:"logs" frame received by ControlStore.applyControlFrame is forwarded
 *    to the registered onLogsFrame callback (logsStore.applyLogsFrame).
 *  - The logsStore grows by the expected number of entries.
 *  - Existing routes (notify/stats/queue/error/ui-rpc) are not affected (regression: 9.1).
 *  - When no onLogsFrame callback is registered, the frame is silently discarded.
 *  - The callback is deregistered by calling the returned cleanup function.
 */
import { describe, it, expect, vi } from "vitest";
import { ControlStore } from "../../src/sse/control-store.js";
import { createLogsStore } from "../../src/logging/logs-store.js";
import type { ControlPayload } from "@pi-web/protocol";
import type { LogEntry } from "@pi-web/logger";

// ── helpers ────────────────────────────────────────────────────────────────────

function makeLogEntry(id: string): LogEntry {
  return { id, level: "info", ns: "test:ns", msg: "test message", ts: Date.now() };
}

function makeLogsFrame(entries: LogEntry[]): ControlPayload {
  return { control: "logs", entries };
}

// ── control:"logs" routing ─────────────────────────────────────────────────────

describe("ControlStore — control:logs routing", () => {
  it("forwards entries to the registered onLogsFrame callback", () => {
    const store = new ControlStore();
    const received: LogEntry[][] = [];
    store.onLogsFrame((entries) => {
      received.push(entries);
    });

    const entries = [makeLogEntry("srv-1"), makeLogEntry("srv-2")];
    store.applyControlFrame(makeLogsFrame(entries));

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(2);
    expect(received[0]![0]!.id).toBe("srv-1");
    expect(received[0]![1]!.id).toBe("srv-2");
  });

  it("integrates with logsStore: logsStore grows after control:logs frame", () => {
    const controlStore = new ControlStore();
    const logsStore = createLogsStore();

    // Wire the two stores together (as connection.ts will do in task 3.4).
    controlStore.onLogsFrame((entries) => {
      logsStore.applyLogsFrame(entries);
    });

    expect(logsStore.getSnapshot().entries).toHaveLength(0);

    const entries = [makeLogEntry("n-1"), makeLogEntry("n-2"), makeLogEntry("n-3")];
    controlStore.applyControlFrame(makeLogsFrame(entries));

    expect(logsStore.getSnapshot().entries).toHaveLength(3);
    const ids = logsStore.getSnapshot().entries.map((e) => e.id);
    expect(ids).toContain("n-1");
    expect(ids).toContain("n-2");
    expect(ids).toContain("n-3");
  });

  it("logsStore deduplicates entries received from multiple frames", () => {
    const controlStore = new ControlStore();
    const logsStore = createLogsStore();
    controlStore.onLogsFrame((entries) => logsStore.applyLogsFrame(entries));

    const e = makeLogEntry("dup-1");
    controlStore.applyControlFrame(makeLogsFrame([e]));
    controlStore.applyControlFrame(makeLogsFrame([e])); // duplicate

    expect(logsStore.getSnapshot().entries).toHaveLength(1);
  });

  it("silently discards control:logs frame when no callback is registered", () => {
    const store = new ControlStore();
    // No onLogsFrame registered — must not throw.
    expect(() => {
      store.applyControlFrame(makeLogsFrame([makeLogEntry("x-1")]));
    }).not.toThrow();
  });

  it("stops forwarding after the cleanup function is called", () => {
    const store = new ControlStore();
    const cb = vi.fn();
    const cleanup = store.onLogsFrame(cb);

    store.applyControlFrame(makeLogsFrame([makeLogEntry("a-1")]));
    expect(cb).toHaveBeenCalledOnce();

    cleanup();
    store.applyControlFrame(makeLogsFrame([makeLogEntry("b-1")]));
    expect(cb).toHaveBeenCalledOnce(); // still just 1
  });
});

// ── regression: existing routes unaffected (Req 9.1) ─────────────────────────

describe("ControlStore — existing routes regression (9.1)", () => {
  it("queue frame still routes correctly alongside logs wiring", () => {
    const store = new ControlStore();
    store.onLogsFrame(() => undefined); // wire up logs callback

    const payload: ControlPayload = {
      control: "queue",
      steering: ["s1"],
      followUp: ["f1"],
    };
    store.applyControlFrame(payload);
    expect(store.getSnapshot().queue).toEqual({ steering: ["s1"], followUp: ["f1"] });
  });

  it("stats frame still routes correctly alongside logs wiring", () => {
    const store = new ControlStore();
    store.onLogsFrame(() => undefined);

    store.applyControlFrame({ control: "stats", stats: { tokensUsed: 42 } } as ControlPayload);
    expect(store.getSnapshot().stats).toEqual({ tokensUsed: 42 });
  });

  it("error frame still routes correctly alongside logs wiring", () => {
    const store = new ControlStore();
    store.onLogsFrame(() => undefined);

    store.applyControlFrame({ control: "error", message: "boom", code: "E1" });
    expect(store.getSnapshot().error).toEqual({ message: "boom", code: "E1" });
  });

  it("extension-ui frame still enqueues correctly alongside logs wiring", () => {
    const store = new ControlStore();
    store.onLogsFrame(() => undefined);

    store.applyControlFrame({
      control: "extension-ui",
      request: {
        type: "extension_ui_request",
        id: "req-1",
        method: "confirm",
        title: "ok?",
        message: "proceed",
      },
    });
    expect(store.getSnapshot().extensionUiQueue).toHaveLength(1);
    expect(store.getSnapshot().extensionUiQueue[0]!.id).toBe("req-1");
  });

  it("logs frame does NOT change the ControlSnapshot (no notify to subscribers)", () => {
    const store = new ControlStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.onLogsFrame(() => undefined);

    const snap1 = store.getSnapshot();
    store.applyControlFrame(makeLogsFrame([makeLogEntry("z-1")]));
    const snap2 = store.getSnapshot();

    // Snapshot reference must be stable — logs frame must not trigger a snapshot update.
    expect(snap1).toBe(snap2);
    expect(listener).not.toHaveBeenCalled();
  });
});
