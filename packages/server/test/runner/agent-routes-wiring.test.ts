/**
 * 单元:wireAgentRoutesBridge(agent-declared-routes, Task 2.2)。
 * 用注入的 stdin(EventEmitter)/stdout(捕获)验证:
 *  - 装配期声明帧形状(纯数据投影,handler 不出进程;空声明零帧)(Req 1.4)
 *  - 请求帧分发入参(name/method/query/body)(Req 3.1)
 *  - handler 抛错归一化 ok:false handler_error(Req 3.3)
 *  - name 未注册归一化 ok:false route_not_registered(Req 4.4)
 *  - 并发多请求独立配对回包,不排队(Req 5.3)
 *  - 非请求帧行放行、畸形帧放行、永不抛出到 runner 主流程(Req 3.5, 5.2)
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { wireAgentRoutesBridge } from "../../src/runner/agent-routes-wiring.js";
import type { NormalizedAgentRouteDecl } from "../../src/runner/agent-loader.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

type Harness = {
  stdin: EventEmitter;
  lines: string[];
  errors: string[];
  wiring: ReturnType<typeof wireAgentRoutesBridge>;
  feed: (obj: unknown) => void;
  feedRaw: (text: string) => void;
};

function makeHarness(routes: readonly NormalizedAgentRouteDecl[] | undefined): Harness {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  (stdin as unknown as { setEncoding: (e: string) => void }).setEncoding = () => {};
  const lines: string[] = [];
  const errors: string[] = [];
  const stdout = { write: (s: string) => (lines.push(s), true) };
  const stderr = { write: (s: string) => (errors.push(s), true) };
  const wiring = wireAgentRoutesBridge({
    sessionId: "s1",
    routes,
    stdin,
    stdout,
    stderr,
  });
  const feedRaw = (text: string): void => {
    stdin.emit("data", text);
  };
  const feed = (obj: unknown): void => {
    feedRaw(JSON.stringify(obj) + "\n");
  };
  return { stdin, lines, errors, wiring, feed, feedRaw };
}

function requestFrame(over: Partial<Record<string, unknown>> = {}): unknown {
  return {
    type: "piweb_agent_route_request",
    id: "req-1",
    name: "gallery-stats",
    method: "GET",
    query: {},
    ...over,
  };
}

/** 解析捕获行(每行一条 JSONL 帧)。 */
function parsed(lines: string[]): unknown[] {
  return lines.map((l) => {
    expect(l.endsWith("\n")).toBe(true);
    return JSON.parse(l);
  });
}

describe("wireAgentRoutesBridge — 装配期声明帧", () => {
  it("空声明(undefined):零帧、不装 reader", () => {
    const { lines, wiring } = makeHarness(undefined);
    expect(lines).toEqual([]);
    expect(wiring.installed).toBe(false);
  });

  it("空声明(空数组):零帧、不装 reader", () => {
    const { lines, wiring } = makeHarness([]);
    expect(lines).toEqual([]);
    expect(wiring.installed).toBe(false);
  });

  it("非空声明:单行 agent_routes 帧,纯数据投影(handler 不出进程)", () => {
    const { lines, wiring } = makeHarness([
      {
        name: "gallery-stats",
        methods: ["GET"],
        description: "画廊统计",
        handler: () => ({}),
      },
      { name: "echo", methods: ["GET", "POST"], handler: () => ({}) },
    ]);
    expect(wiring.installed).toBe(true);
    expect(lines).toHaveLength(1);
    expect(parsed(lines)[0]).toEqual({
      type: "agent_routes",
      routes: [
        { name: "gallery-stats", methods: ["GET"], description: "画廊统计" },
        { name: "echo", methods: ["GET", "POST"] },
      ],
    });
  });
});

describe("wireAgentRoutesBridge — 请求帧分发", () => {
  it("命中 route → handler 收到 name/method/query/body → ok:true 结果帧按 id 配对", async () => {
    const handler = vi.fn(async (req: unknown) => ({ echoed: req }));
    const { lines, feed } = makeHarness([
      { name: "echo", methods: ["POST"], handler },
    ]);
    feed(
      requestFrame({
        id: "r-77",
        name: "echo",
        method: "POST",
        query: { a: "1", b: "two" },
        body: { hello: "world" },
      }),
    );
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      name: "echo",
      method: "POST",
      query: { a: "1", b: "two" },
      body: { hello: "world" },
    });
    const frames = parsed(lines);
    // lines[0] 是声明帧;lines[1] 是结果帧
    expect(frames[1]).toEqual({
      type: "piweb_agent_route_result",
      id: "r-77",
      ok: true,
      result: {
        echoed: {
          name: "echo",
          method: "POST",
          query: { a: "1", b: "two" },
          body: { hello: "world" },
        },
      },
    });
  });

  it("GET 无 body:handler 入参不含 body 键", async () => {
    const handler = vi.fn((_req: unknown) => ({ n: 3 }));
    const { feed } = makeHarness([
      { name: "gallery-stats", methods: ["GET"], handler },
    ]);
    feed(requestFrame({ query: { limit: "5" } }));
    await flush();
    const arg = handler.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toEqual({ name: "gallery-stats", method: "GET", query: { limit: "5" } });
    expect(Object.prototype.hasOwnProperty.call(arg, "body")).toBe(false);
  });

  it("handler 同步抛错 → ok:false handler_error,不抛出到主流程", async () => {
    const { lines, feed } = makeHarness([
      {
        name: "boom",
        methods: ["GET"],
        handler: () => {
          throw new Error("kaput");
        },
      },
    ]);
    feed(requestFrame({ id: "r-e1", name: "boom" }));
    await flush();
    const frames = parsed(lines);
    expect(frames[1]).toEqual({
      type: "piweb_agent_route_result",
      id: "r-e1",
      ok: false,
      error: { code: "handler_error", message: expect.stringContaining("kaput") },
    });
  });

  it("handler 异步 reject → ok:false handler_error", async () => {
    const { lines, feed } = makeHarness([
      {
        name: "boom-async",
        methods: ["GET"],
        handler: async () => {
          throw new Error("async kaput");
        },
      },
    ]);
    feed(requestFrame({ id: "r-e2", name: "boom-async" }));
    await flush();
    const frames = parsed(lines);
    expect(frames[1]).toEqual({
      type: "piweb_agent_route_result",
      id: "r-e2",
      ok: false,
      error: {
        code: "handler_error",
        message: expect.stringContaining("async kaput"),
      },
    });
  });

  it("name 未注册 → ok:false route_not_registered(防御路径)", async () => {
    const { lines, feed } = makeHarness([
      { name: "known", methods: ["GET"], handler: () => ({}) },
    ]);
    feed(requestFrame({ id: "r-404", name: "unknown-route" }));
    await flush();
    const frames = parsed(lines);
    expect(frames[1]).toEqual({
      type: "piweb_agent_route_result",
      id: "r-404",
      ok: false,
      error: {
        code: "route_not_registered",
        message: expect.stringContaining("unknown-route"),
      },
    });
  });

  it("handler 返回不可 JSON 序列化的值 → ok:false handler_error(不悬挂不抛出)", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { lines, feed } = makeHarness([
      { name: "circular", methods: ["GET"], handler: () => circular },
    ]);
    feed(requestFrame({ id: "r-c1", name: "circular" }));
    await flush();
    const frames = parsed(lines);
    expect(frames[1]).toMatchObject({
      type: "piweb_agent_route_result",
      id: "r-c1",
      ok: false,
      error: { code: "handler_error" },
    });
  });
});

describe("wireAgentRoutesBridge — 并发与放行", () => {
  it("并发多请求:各自独立配对回包,慢 handler 不阻塞快 handler(不排队)", async () => {
    let releaseSlow!: (v: unknown) => void;
    const slowGate = new Promise((r) => {
      releaseSlow = r;
    });
    const { lines, feed } = makeHarness([
      {
        name: "slow",
        methods: ["GET"],
        handler: async () => {
          await slowGate;
          return { kind: "slow" };
        },
      },
      { name: "fast", methods: ["GET"], handler: () => ({ kind: "fast" }) },
    ]);
    feed(requestFrame({ id: "r-slow", name: "slow" }));
    feed(requestFrame({ id: "r-fast", name: "fast" }));
    await flush();
    // slow 未放行时 fast 已独立回包(先到先回不成立——并发不排队)
    let frames = parsed(lines);
    expect(frames).toHaveLength(2); // 声明帧 + fast 结果
    expect(frames[1]).toEqual({
      type: "piweb_agent_route_result",
      id: "r-fast",
      ok: true,
      result: { kind: "fast" },
    });
    releaseSlow(undefined);
    await flush();
    frames = parsed(lines);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toEqual({
      type: "piweb_agent_route_result",
      id: "r-slow",
      ok: true,
      result: { kind: "slow" },
    });
  });

  it("非请求帧 JSON 行/非 JSON 行/畸形请求帧:放行不回包", async () => {
    const handler = vi.fn(() => ({}));
    const { lines, feed, feedRaw } = makeHarness([
      { name: "known", methods: ["GET"], handler },
    ]);
    feed({ type: "ui_rpc", request: { anything: true } }); // 他桥的行
    feed({ type: "piweb_clear_queue", id: "x" }); // 他桥的行
    feedRaw("not json at all\n"); // 非 JSON
    feed({ type: "piweb_agent_route_request", name: "known" }); // 畸形:缺 id/method/query
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1); // 仅装配期声明帧
  });

  it("跨 chunk 拆分的请求帧行:按 JSONL 边界重组后照常分发", async () => {
    const handler = vi.fn(() => ({ ok: 1 }));
    const { lines, feedRaw } = makeHarness([
      { name: "known", methods: ["GET"], handler },
    ]);
    const line =
      JSON.stringify(requestFrame({ id: "r-split", name: "known" })) + "\n";
    feedRaw(line.slice(0, 20));
    feedRaw(line.slice(20));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(parsed(lines)[1]).toMatchObject({ id: "r-split", ok: true });
  });

  it("cleanup 幂等移除 stdin 监听器:之后的请求帧不再分发", async () => {
    const handler = vi.fn(() => ({}));
    const { wiring, feed, lines } = makeHarness([
      { name: "known", methods: ["GET"], handler },
    ]);
    wiring.cleanup();
    wiring.cleanup(); // 幂等
    feed(requestFrame({ name: "known" }));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1); // 仅声明帧
  });
});
