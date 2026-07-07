/**
 * agent-declared-routes task 3.1:PiSession 路由表缓存与同步配对。
 *
 * 覆盖:
 * - Req 2.5:agentRoutes 只读访问器(无声明→空数组;声明帧按会话缓存,含就绪门前时序)。
 * - Req 3.2:invokeAgentRoute 发请求帧→结果帧按 id 配对 resolve(同一异步周期收敛)。
 * - Req 3.4:超时 reject(AgentRouteTimeoutError,代码默认 20s,不读 env);迟到结果按未知 id 丢弃。
 * - Req 5.1:请求受理不依赖就绪/busy 态(active 即转发)。
 * - Req 5.3:并发多请求各自独立配对,不串扰。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSession } from "../../src/session/pi-session.js";
import { AgentRouteTimeoutError } from "../../src/session/session.errors.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function newSession(ch: MockChannel, opts?: { readinessHandshake?: boolean }): PiSession {
  return new PiSession({
    id: "s1",
    resolved: makeResolved(),
    channel: ch,
    idleMs: 0,
    ...(opts ?? {}),
  });
}

/** 取出最近一条 piweb_agent_route_request 请求行(解析后)。 */
function lastRouteRequest(ch: MockChannel): { id: string; [k: string]: unknown } {
  const line = [...ch.sent]
    .reverse()
    .find((l) => l.includes("piweb_agent_route_request"));
  expect(line).toBeDefined();
  return JSON.parse(line as string) as { id: string; [k: string]: unknown };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PiSession.agentRoutes(声明帧缓存)", () => {
  it("默认无声明 → 空数组(Req 2.5)", () => {
    const s = newSession(new MockChannel());
    expect(s.agentRoutes).toEqual([]);
  });

  it("装配期 agent_routes 帧 → 就绪门前(lifecycle=initializing)即缓存(Req 2.5)", () => {
    const ch = new MockChannel();
    const s = newSession(ch, { readinessHandshake: true });
    // 就绪探针尚未收敛:业务就绪态仍为 initializing(声明帧早于就绪门)。
    expect(s.lifecycle).toBe("initializing");
    ch.emitLine(
      JSON.stringify({
        type: "agent_routes",
        routes: [
          { name: "canvas-snapshot", methods: ["GET"], description: "快照" },
          { name: "submit", methods: ["GET", "POST"] },
        ],
      }),
    );
    // 同步断言:缓存发生于就绪收敛之前。
    expect(s.lifecycle).toBe("initializing");
    expect(s.agentRoutes).toEqual([
      { name: "canvas-snapshot", methods: ["GET"], description: "快照" },
      { name: "submit", methods: ["GET", "POST"] },
    ]);
  });

  it("非法 agent_routes 帧(二次 zod 校验失败)丢弃,缓存不变", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(
      JSON.stringify({
        type: "agent_routes",
        routes: [{ name: "ok", methods: ["GET"] }],
      }),
    );
    // methods 含白名单外值 → 整帧丢弃(不部分采纳)。
    ch.emitLine(
      JSON.stringify({
        type: "agent_routes",
        routes: [{ name: "bad", methods: ["DELETE"] }],
      }),
    );
    // routes 非数组 → 丢弃。
    ch.emitLine(JSON.stringify({ type: "agent_routes", routes: { nope: true } }));
    expect(s.agentRoutes).toEqual([{ name: "ok", methods: ["GET"] }]);
  });

  it("后到声明帧覆盖前值(热重载重声明语义)", () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    ch.emitLine(
      JSON.stringify({ type: "agent_routes", routes: [{ name: "a", methods: ["GET"] }] }),
    );
    ch.emitLine(
      JSON.stringify({ type: "agent_routes", routes: [{ name: "b", methods: ["POST"] }] }),
    );
    expect(s.agentRoutes).toEqual([{ name: "b", methods: ["POST"] }]);
  });
});

describe("PiSession.invokeAgentRoute(同步配对)", () => {
  it("发请求帧并按 id 配对结果帧 resolve(Req 3.2)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.invokeAgentRoute("canvas-snapshot", {
      method: "GET",
      query: { limit: "3" },
    });
    const sent = lastRouteRequest(ch);
    expect(sent).toMatchObject({
      type: "piweb_agent_route_request",
      name: "canvas-snapshot",
      method: "GET",
      query: { limit: "3" },
    });
    // GET 无 body:请求帧不携带 body 键。
    expect("body" in sent).toBe(false);
    ch.emitLine(
      JSON.stringify({
        type: "piweb_agent_route_result",
        id: sent.id,
        ok: true,
        result: { items: [1, 2, 3] },
      }),
    );
    await expect(p).resolves.toEqual({
      type: "piweb_agent_route_result",
      id: sent.id,
      ok: true,
      result: { items: [1, 2, 3] },
    });
  });

  it("POST body 透传;ok:false 以返回值表达(不 reject,→502 由 HTTP 层映射)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.invokeAgentRoute("submit", {
      method: "POST",
      query: {},
      body: { text: "hi" },
    });
    const sent = lastRouteRequest(ch);
    expect(sent).toMatchObject({ method: "POST", body: { text: "hi" } });
    ch.emitLine(
      JSON.stringify({
        type: "piweb_agent_route_result",
        id: sent.id,
        ok: false,
        error: { code: "handler_error", message: "boom" },
      }),
    );
    await expect(p).resolves.toMatchObject({
      ok: false,
      error: { code: "handler_error", message: "boom" },
    });
  });

  it("无结果帧时按超时 reject AgentRouteTimeoutError(Req 3.4)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await expect(
      s.invokeAgentRoute("slow", { method: "GET", query: {} }, 20),
    ).rejects.toBeInstanceOf(AgentRouteTimeoutError);
  });

  it("默认超时为代码内 20s(不读 env)", async () => {
    vi.useFakeTimers();
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.invokeAgentRoute("slow", { method: "GET", query: {} });
    const rejected = vi.fn();
    p.catch(rejected);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rejected).toHaveBeenCalledOnce();
    expect(rejected.mock.calls[0]?.[0]).toBeInstanceOf(AgentRouteTimeoutError);
  });

  it("未知/迟到 id 的结果帧安全丢弃(Req 3.4)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.invokeAgentRoute("r", { method: "GET", query: {} });
    const sent = lastRouteRequest(ch);
    // 未知 id → 丢弃不影响 pending。
    ch.emitLine(
      JSON.stringify({ type: "piweb_agent_route_result", id: "other", ok: true }),
    );
    // 畸形结果帧(缺 ok)→ 丢弃。
    ch.emitLine(
      JSON.stringify({ type: "piweb_agent_route_result", id: sent.id }),
    );
    // 正确帧 → resolve。
    ch.emitLine(
      JSON.stringify({ type: "piweb_agent_route_result", id: sent.id, ok: true, result: 1 }),
    );
    await expect(p).resolves.toMatchObject({ ok: true, result: 1 });
  });

  it("并发多请求各自独立配对不串扰(乱序回流,Req 5.3)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p1 = s.invokeAgentRoute("a", { method: "GET", query: { n: "1" } });
    const id1 = lastRouteRequest(ch).id;
    const p2 = s.invokeAgentRoute("b", { method: "GET", query: { n: "2" } });
    const id2 = lastRouteRequest(ch).id;
    expect(id1).not.toBe(id2);
    // 乱序回流:后发先回。
    ch.emitLine(
      JSON.stringify({ type: "piweb_agent_route_result", id: id2, ok: true, result: "B" }),
    );
    ch.emitLine(
      JSON.stringify({ type: "piweb_agent_route_result", id: id1, ok: true, result: "A" }),
    );
    await expect(p1).resolves.toMatchObject({ id: id1, result: "A" });
    await expect(p2).resolves.toMatchObject({ id: id2, result: "B" });
  });

  it("会话已停时 reject(不下发请求)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    await s.stop("idle");
    const sentBefore = ch.sent.length;
    await expect(
      s.invokeAgentRoute("r", { method: "GET", query: {} }),
    ).rejects.toBeInstanceOf(Error);
    expect(ch.sent.length).toBe(sentBefore);
  });

  it("会话收尾时 reject 所有在途请求(不悬挂)", async () => {
    const ch = new MockChannel();
    const s = newSession(ch);
    const p = s.invokeAgentRoute("r", { method: "GET", query: {} });
    const guarded = p.catch((e: unknown) => e);
    await s.stop("idle");
    await expect(guarded).resolves.toBeInstanceOf(Error);
  });
});
