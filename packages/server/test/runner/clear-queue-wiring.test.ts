/**
 * message-queue-ui:wireClearQueueBridge — 第二 stdin reader 截获请求行 → 调 runtime.session.clearQueue()
 * → 写回结果行。含畸形/非本桥行忽略、clearQueue 抛错回空结果、cleanup 卸载。
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { wireClearQueueBridge } from "../../src/runner/clear-queue-wiring.js";

/** 可注入的假 stdin(EventEmitter 最小面)。 */
function makeFakeStdin() {
  const listeners = new Set<(chunk: string | Buffer) => void>();
  return {
    setEncoding: vi.fn(),
    on(_e: "data", cb: (chunk: string | Buffer) => void) {
      listeners.add(cb);
      return this;
    },
    off(_e: "data", cb: (chunk: string | Buffer) => void) {
      listeners.delete(cb);
      return this;
    },
    push(chunk: string) {
      for (const cb of listeners) cb(chunk);
    },
    get size() {
      return listeners.size;
    },
  };
}

function makeRuntime(
  clearQueue: () => { steering: string[]; followUp: string[] },
): AgentSessionRuntime {
  return {
    session: { clearQueue },
  } as unknown as AgentSessionRuntime;
}

describe("wireClearQueueBridge", () => {
  it("截获请求行 → 调 clearQueue → 写回同 id 结果行", () => {
    const stdin = makeFakeStdin();
    const out: string[] = [];
    const clearQueue = vi.fn(() => ({ steering: ["a"], followUp: ["b", "c"] }));
    const wiring = wireClearQueueBridge(makeRuntime(clearQueue), {
      sessionId: "s1",
      stdin,
      stdout: { write: (s: string) => out.push(s) },
    });
    expect(wiring.installed).toBe(true);

    stdin.push(JSON.stringify({ type: "piweb_clear_queue", id: "cq_1" }) + "\n");
    expect(clearQueue).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string)).toEqual({
      type: "piweb_clear_queue_result",
      id: "cq_1",
      steering: ["a"],
      followUp: ["b", "c"],
    });
  });

  it("忽略非本桥行(不调 clearQueue、不写回)", () => {
    const stdin = makeFakeStdin();
    const out: string[] = [];
    const clearQueue = vi.fn(() => ({ steering: [], followUp: [] }));
    wireClearQueueBridge(makeRuntime(clearQueue), {
      sessionId: "s1",
      stdin,
      stdout: { write: (s: string) => out.push(s) },
    });
    stdin.push(JSON.stringify({ type: "piweb_state_set", key: "k" }) + "\n");
    stdin.push("not-json\n");
    expect(clearQueue).not.toHaveBeenCalled();
    expect(out).toHaveLength(0);
  });

  it("clearQueue 抛错时回空结果行(不吞语义)", () => {
    const stdin = makeFakeStdin();
    const out: string[] = [];
    const stderr: string[] = [];
    wireClearQueueBridge(
      makeRuntime(() => {
        throw new Error("boom");
      }),
      {
        sessionId: "s1",
        stdin,
        stdout: { write: (s: string) => out.push(s) },
        stderr: { write: (s: string) => stderr.push(s) },
      },
    );
    stdin.push(JSON.stringify({ type: "piweb_clear_queue", id: "cq_2" }) + "\n");
    expect(JSON.parse(out[0] as string)).toEqual({
      type: "piweb_clear_queue_result",
      id: "cq_2",
      steering: [],
      followUp: [],
    });
    expect(stderr.join("")).toMatch(/clearQueue error/);
  });

  it("cleanup 卸载 stdin 读取器(幂等)", () => {
    const stdin = makeFakeStdin();
    const wiring = wireClearQueueBridge(makeRuntime(() => ({ steering: [], followUp: [] })), {
      sessionId: "s1",
      stdin,
      stdout: { write: () => undefined },
    });
    expect(stdin.size).toBe(1);
    wiring.cleanup();
    wiring.cleanup();
    expect(stdin.size).toBe(0);
  });
});
