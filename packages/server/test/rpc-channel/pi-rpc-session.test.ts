/**
 * PiRpcSession 单元测试(spec e2b-sandbox-transport,Req 1.2/1.3/7.1/7.5)。
 *
 * 用一个可编程的 mock `RpcTransport` 精确注入 stdout 行、触发 exit/spawn,并捕获
 * `send` 写出的帧,以传输无关的方式覆盖会话核心的分帧分发、命令 id 匹配、退出拒绝、
 * 关闭语义与 health 透传——不起任何子进程/沙盒。
 */
import { describe, it, expect, vi } from "vitest";
import { PiRpcSession } from "../../src/rpc-channel/pi-rpc-session.js";
import { ChannelClosedError } from "../../src/rpc-channel/pi-rpc-process.errors.js";
import type { RpcTransport } from "../../src/rpc-channel/transport.js";
import type { ExitInfo } from "../../src/rpc-channel/pi-rpc-process.js";
import type { ChannelHealth } from "../../src/rpc-channel/pi-rpc-channel.js";

/** 可编程 mock 传输:测试可注入行、触发 exit/spawn,并读回 send 的帧。 */
class MockTransport implements RpcTransport {
  sent: string[] = [];
  #lineCbs = new Set<(line: string) => void>();
  #stderrCbs = new Set<(chunk: string) => void>();
  #exitCbs = new Set<(info: ExitInfo) => void>();
  #spawnCbs = new Set<() => void>();
  #health: ChannelHealth = { alive: true, exitCode: null, signal: null };
  closed = false;

  send(line: string): void {
    this.sent.push(line);
  }
  onLine(cb: (line: string) => void) {
    this.#lineCbs.add(cb);
    return () => this.#lineCbs.delete(cb);
  }
  onStderr(cb: (chunk: string) => void) {
    this.#stderrCbs.add(cb);
    return () => this.#stderrCbs.delete(cb);
  }
  onExit(cb: (info: ExitInfo) => void) {
    this.#exitCbs.add(cb);
    return () => this.#exitCbs.delete(cb);
  }
  onSpawn(cb: () => void) {
    this.#spawnCbs.add(cb);
    return () => this.#spawnCbs.delete(cb);
  }
  async close(): Promise<void> {
    this.closed = true;
    this.#health = { alive: false, exitCode: 0, signal: null };
  }
  health(): ChannelHealth {
    return this.#health;
  }

  // ── 测试驱动接口 ──
  emitLine(line: string): void {
    for (const cb of this.#lineCbs) cb(line);
  }
  emitStderr(chunk: string): void {
    for (const cb of this.#stderrCbs) cb(chunk);
  }
  emitExit(info: ExitInfo): void {
    for (const cb of this.#exitCbs) cb(info);
  }
  emitSpawn(): void {
    for (const cb of this.#spawnCbs) cb();
  }

  /** 从最近一条 send 出的命令帧取 id(用于回注匹配 response)。 */
  lastCommandId(): string {
    return parseFrame(this.sent[this.sent.length - 1]).id as string;
  }
}

/** 解析一条已 send 的帧(断言其存在,满足 noUncheckedIndexedAccess)。 */
function parseFrame(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) throw new Error("expected a sent frame but got none");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("PiRpcSession — 分帧分发 (Req 1.2)", () => {
  it("收到匹配 id 的 response 帧兑现对应命令 Promise", async () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const p = s.prompt("hello");
    const id = t.lastCommandId();
    t.emitLine(JSON.stringify({ type: "response", id, success: true }));
    await expect(p).resolves.toMatchObject({ id, success: true });
  });

  it("event 帧广播给 onEvent 监听器", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const seen: unknown[] = [];
    s.onEvent((e) => seen.push(e));
    t.emitLine(JSON.stringify({ type: "event", event: "agent_start" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "event", event: "agent_start" });
  });

  it("非 response/event 帧通知 onExtensionUIRequest 监听器", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const reqs: unknown[] = [];
    s.onExtensionUIRequest((r) => reqs.push(r));
    t.emitLine(JSON.stringify({ type: "extension_ui_request", requestId: "r1" }));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ requestId: "r1" });
  });

  it("非 JSON 行被静默忽略,不抛出", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const seen: unknown[] = [];
    s.onEvent((e) => seen.push(e));
    expect(() => t.emitLine("not-json{{{")).not.toThrow();
    expect(seen).toHaveLength(0);
  });

  it("孤儿 response(无对应待决)被忽略,不抛出", () => {
    const t = new MockTransport();
    new PiRpcSession(t); // 构造即注册分发监听器(测其副作用)
    expect(() =>
      t.emitLine(JSON.stringify({ type: "response", id: "nope", success: true })),
    ).not.toThrow();
  });
});

describe("PiRpcSession — 命令封装 (Req 1.3)", () => {
  it("命令方法生成唯一 id 并经 transport.send 写出", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    void s.prompt("a");
    void s.abort();
    expect(t.sent).toHaveLength(2);
    const m0 = parseFrame(t.sent[0]);
    const m1 = parseFrame(t.sent[1]);
    expect(m0.type).toBe("prompt");
    expect(m1.type).toBe("abort");
    expect(m0.id).not.toBe(m1.id); // 唯一
  });

  it("setModel 携带 provider/modelId 负载", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    void s.setModel("anthropic", "claude-opus-4-8");
    const m = parseFrame(t.sent[0]);
    expect(m).toMatchObject({
      type: "set_model",
      provider: "anthropic",
      modelId: "claude-opus-4-8",
    });
  });

  it("respondExtensionUI 为 fire-and-forget(不登记待决)", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    s.respondExtensionUI("req-1", { ok: true } as never);
    const m = parseFrame(t.sent[0]);
    expect(m).toMatchObject({ type: "respond_extension_ui", requestId: "req-1" });
  });
});

describe("PiRpcSession — 退出与关闭 (Req 1.2/1.3)", () => {
  it("传输 onExit 后全部待决命令被 ChannelClosedError 拒绝", async () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const p1 = s.prompt("a");
    const p2 = s.getState();
    t.emitExit({ code: 1, signal: null });
    await expect(p1).rejects.toBeInstanceOf(ChannelClosedError);
    await expect(p2).rejects.toBeInstanceOf(ChannelClosedError);
  });

  it("退出信息广播给 onExit 监听器", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const infos: ExitInfo[] = [];
    s.onExit((i) => infos.push(i));
    t.emitExit({ code: 137, signal: "SIGKILL" });
    expect(infos).toEqual([{ code: 137, signal: "SIGKILL" }]);
  });

  it("close() 后新命令立即被拒绝", async () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    await s.close();
    expect(t.closed).toBe(true);
    await expect(s.prompt("late")).rejects.toBeInstanceOf(ChannelClosedError);
  });

  it("传输 onSpawn 触发 onRestart 监听器", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const fn = vi.fn();
    s.onRestart(fn);
    t.emitSpawn();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("PiRpcSession — 监听器透传 (Req 1.1)", () => {
  it("onStderr 透传传输 stderr 块", () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    const chunks: string[] = [];
    s.onStderr((c) => chunks.push(c));
    t.emitStderr("boom\n");
    expect(chunks).toEqual(["boom\n"]);
  });

  it("health() 透传传输健康状态", async () => {
    const t = new MockTransport();
    const s = new PiRpcSession(t);
    expect(s.health().alive).toBe(true);
    await s.close();
    expect(s.health().alive).toBe(false);
  });
});
