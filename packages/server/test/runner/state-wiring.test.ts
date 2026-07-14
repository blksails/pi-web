/**
 * 单元:wireStateBridge(state-injection-bridge, Task 2.1)。
 * 用注入的 stdin(EventEmitter)/stdout(捕获)/globalScope 验证三条边与降级。
 * (seam provider 直接断言;getSessionState 的解析在 tool-kit 包测覆盖。)
 */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  wireStateBridge,
  SESSION_STATE_SEAM_KEY,
} from "../../src/runner/state-wiring.js";
import { createInboundFrameRouter } from "../../src/runner/frame-channel/index.js";

interface SeamProvider {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  snapshot(): Readonly<Record<string, unknown>>;
}

function makeHarness() {
  const stdin = new EventEmitter() as EventEmitter & {
    setEncoding(e: string): void;
  };
  (stdin as unknown as { setEncoding: (e: string) => void }).setEncoding = () => {};
  const lines: string[] = [];
  const stdout = { write: (s: string) => (lines.push(s), true) };
  const stderr = { write: () => true };
  const globalScope: Record<string, unknown> = {};
  const channel = createInboundFrameRouter({ sessionId: "s1", stdin, stdout, stderr });
  const wiring = wireStateBridge(channel, {
    sessionId: "s1",
    stderr,
    globalScope,
  });
  const seam = (): SeamProvider => globalScope[SESSION_STATE_SEAM_KEY] as SeamProvider;
  return { stdin, lines, globalScope, wiring, seam };
}

describe("wireStateBridge", () => {
  it("seam 透出:provider 经 seam 读写权威态(2.2)", () => {
    const { wiring, seam } = makeHarness();
    expect(seam()).toBeDefined();
    wiring.store.set("count", 5);
    expect(seam().get("count")).toBe(5);
    seam().set("count", 9);
    expect(wiring.store.get("count")).toBe(9);
    expect(seam().snapshot()).toEqual({ count: 9 });
  });

  it("下行:store 变更写出完整 piweb_state stdout 行(3.1)", () => {
    const { lines, wiring } = makeHarness();
    wiring.store.set("mode", "edit");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0]!.trim())).toEqual({
      type: "piweb_state",
      key: "mode",
      value: "edit",
      rev: 0,
    });
    wiring.store.delete("mode");
    expect(JSON.parse(lines[1]!.trim())).toMatchObject({
      type: "piweb_state",
      key: "mode",
      deleted: true,
    });
  });

  it("写回:stdin 的 piweb_state_set 行改权威态并触发下行(4.1)", () => {
    const { stdin, lines, wiring, seam } = makeHarness();
    expect(wiring.installed).toBe(true);
    stdin.emit(
      "data",
      JSON.stringify({ type: "piweb_state_set", key: "k", value: 7 }) + "\n",
    );
    expect(wiring.store.get("k")).toBe(7);
    expect(seam().get("k")).toBe(7);
    expect(lines.some((l) => l.includes('"key":"k"') && l.includes('"value":7'))).toBe(true);
    stdin.emit(
      "data",
      JSON.stringify({ type: "piweb_state_delete", key: "k" }) + "\n",
    );
    expect(wiring.store.get("k")).toBeUndefined();
  });

  it("无关 stdin 行(pi 命令 / 非 JSON)被忽略,不影响状态(8.3)", () => {
    const { stdin, wiring } = makeHarness();
    stdin.emit("data", JSON.stringify({ type: "prompt", id: "c1", content: "hi" }) + "\n");
    stdin.emit("data", "not-json\n");
    expect(wiring.store.snapshot().size).toBe(0);
  });

  it("cleanup 取消订阅、卸载 stdin 监听、清 seam(幂等)", () => {
    const { stdin, lines, globalScope, wiring } = makeHarness();
    wiring.cleanup();
    expect(globalScope[SESSION_STATE_SEAM_KEY]).toBeUndefined();
    const before = lines.length;
    stdin.emit(
      "data",
      JSON.stringify({ type: "piweb_state_set", key: "z", value: 1 }) + "\n",
    );
    expect(wiring.store.get("z")).toBeUndefined();
    expect(lines.length).toBe(before);
    expect(() => wiring.cleanup()).not.toThrow();
  });
});
