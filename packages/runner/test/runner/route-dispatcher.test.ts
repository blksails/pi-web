/**
 * 单元:createRouteDispatcher(agent-declared-routes 的纯派发器)。
 * 脱离 FrameChannel/stdio 直接测请求→结果归一化(SRP/DIP 收口的收益)。
 */
import { describe, it, expect, vi } from "vitest";
import type { AgentRouteRequestFrame } from "@blksails/pi-web-protocol";
import { createRouteDispatcher } from "../../src/runner/route-dispatcher.js";
import type { NormalizedAgentRouteDecl } from "../../src/runner/agent-loader.js";

function req(over: Partial<AgentRouteRequestFrame> = {}): AgentRouteRequestFrame {
  return {
    type: "piweb_agent_route_request",
    id: "r-1",
    name: "gallery-stats",
    method: "GET",
    query: {},
    ...over,
  } as AgentRouteRequestFrame;
}

const decl = (
  over: Partial<NormalizedAgentRouteDecl>,
): NormalizedAgentRouteDecl =>
  ({ name: "x", methods: ["GET"], handler: () => ({}), ...over }) as NormalizedAgentRouteDecl;

describe("createRouteDispatcher", () => {
  it("命中 → ok:true;handler 收到 name/method/query/body", async () => {
    const handler = vi.fn(async (r: unknown) => ({ echoed: r }));
    const d = createRouteDispatcher([decl({ name: "echo", methods: ["POST"], handler })]);
    const out = await d.dispatch(
      req({ id: "r-77", name: "echo", method: "POST", query: { a: "1" }, body: { hi: "x" } }),
    );
    expect(handler).toHaveBeenCalledWith({
      name: "echo",
      method: "POST",
      query: { a: "1" },
      body: { hi: "x" },
    });
    expect(out).toEqual({
      type: "piweb_agent_route_result",
      id: "r-77",
      ok: true,
      result: { echoed: { name: "echo", method: "POST", query: { a: "1" }, body: { hi: "x" } } },
    });
  });

  it("GET 无 body → handler 入参不含 body 键", async () => {
    const handler = vi.fn((_r: unknown) => ({ n: 3 }));
    const d = createRouteDispatcher([decl({ name: "gallery-stats", handler })]);
    await d.dispatch(req({ name: "gallery-stats", query: { limit: "5" } }));
    const arg = handler.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(arg, "body")).toBe(false);
  });

  it("value 为 undefined → ok:true 不含 result 键", async () => {
    const d = createRouteDispatcher([decl({ name: "void-route", handler: () => undefined })]);
    const out = await d.dispatch(req({ id: "r-v", name: "void-route" }));
    expect(out).toEqual({ type: "piweb_agent_route_result", id: "r-v", ok: true });
    expect(Object.prototype.hasOwnProperty.call(out, "result")).toBe(false);
  });

  it("name 未注册 → route_not_registered", async () => {
    const d = createRouteDispatcher([decl({ name: "known" })]);
    const out = await d.dispatch(req({ id: "r-404", name: "nope" }));
    expect(out).toMatchObject({
      id: "r-404",
      ok: false,
      error: { code: "route_not_registered", message: expect.stringContaining("nope") },
    });
  });

  it("handler 同步/异步抛错 → handler_error(取 Error.message)", async () => {
    const d = createRouteDispatcher([
      decl({ name: "boom", handler: () => { throw new Error("kaput"); } }),
      decl({ name: "boom-async", handler: async () => { throw new Error("async kaput"); } }),
    ]);
    expect(await d.dispatch(req({ id: "e1", name: "boom" }))).toMatchObject({
      id: "e1", ok: false, error: { code: "handler_error", message: "kaput" },
    });
    expect(await d.dispatch(req({ id: "e2", name: "boom-async" }))).toMatchObject({
      id: "e2", ok: false, error: { code: "handler_error", message: "async kaput" },
    });
  });

  it("返回值不可 JSON 序列化(循环引用)→ handler_error,不 reject", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const d = createRouteDispatcher([decl({ name: "circular", handler: () => circular })]);
    const out = await d.dispatch(req({ id: "c1", name: "circular" }));
    expect(out).toMatchObject({
      id: "c1",
      ok: false,
      error: { code: "handler_error", message: expect.stringContaining("not JSON-serializable") },
    });
  });
});
