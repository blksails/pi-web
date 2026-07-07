/**
 * agent-declared-routes task 1.1:agent-routes 帧契约 schema。
 * 覆盖 Req 1.1(声明 DTO:name 必填/methods 白名单/description 可选)与
 * Req 7.1(三帧独立自建 JSONL 帧,type 判别互斥;SSE 帧 union 零触碰)。
 */
import { describe, expect, it } from "vitest";
import {
  AgentRouteDeclDtoSchema,
  AgentRoutesFrameSchema,
  AgentRouteRequestFrameSchema,
  AgentRouteResultFrameSchema,
} from "../../src/agent-routes/frames.js";

describe("AgentRouteDeclDtoSchema", () => {
  it("接受最小声明(name + methods)", () => {
    const d = { name: "canvas-snapshot", methods: ["GET"] };
    expect(AgentRouteDeclDtoSchema.parse(d)).toEqual(d);
  });

  it("接受含 description 的完整声明与 GET/POST 双方法", () => {
    const d = {
      name: "layer-ops",
      methods: ["GET", "POST"],
      description: "图层批量操作",
    };
    expect(AgentRouteDeclDtoSchema.parse(d)).toEqual(d);
  });

  it("拒绝空 name 与缺 name", () => {
    expect(
      AgentRouteDeclDtoSchema.safeParse({ name: "", methods: ["GET"] }).success,
    ).toBe(false);
    expect(AgentRouteDeclDtoSchema.safeParse({ methods: ["GET"] }).success).toBe(
      false,
    );
  });

  it("拒绝白名单外的方法与缺 methods", () => {
    expect(
      AgentRouteDeclDtoSchema.safeParse({ name: "x", methods: ["DELETE"] })
        .success,
    ).toBe(false);
    expect(AgentRouteDeclDtoSchema.safeParse({ name: "x" }).success).toBe(false);
  });
});

describe("AgentRoutesFrameSchema", () => {
  it("解析合法声明帧(含空 routes)", () => {
    const f = {
      type: "agent_routes",
      routes: [{ name: "canvas-snapshot", methods: ["GET"] }],
    };
    expect(AgentRoutesFrameSchema.parse(f)).toEqual(f);
    expect(
      AgentRoutesFrameSchema.parse({ type: "agent_routes", routes: [] }).routes,
    ).toEqual([]);
  });

  it("拒绝错误 type 与非法 routes 元素", () => {
    expect(
      AgentRoutesFrameSchema.safeParse({ type: "slash_completions", routes: [] })
        .success,
    ).toBe(false);
    expect(
      AgentRoutesFrameSchema.safeParse({
        type: "agent_routes",
        routes: [{ name: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("AgentRouteRequestFrameSchema", () => {
  it("解析 GET 请求帧(无 body)", () => {
    const f = {
      type: "piweb_agent_route_request",
      id: "req-1",
      name: "canvas-snapshot",
      method: "GET",
      query: { limit: "10" },
    };
    expect(AgentRouteRequestFrameSchema.parse(f)).toEqual(f);
  });

  it("解析 POST 请求帧(body 任意 JSON 值)", () => {
    const f = {
      type: "piweb_agent_route_request",
      id: "req-2",
      name: "layer-ops",
      method: "POST",
      query: {},
      body: { op: "move", ids: [1, 2] },
    };
    expect(AgentRouteRequestFrameSchema.parse(f)).toEqual(f);
  });

  it("拒绝空 id、白名单外方法与非 string 值的 query", () => {
    const base = {
      type: "piweb_agent_route_request",
      name: "x",
      method: "GET",
      query: {},
    };
    expect(
      AgentRouteRequestFrameSchema.safeParse({ ...base, id: "" }).success,
    ).toBe(false);
    expect(
      AgentRouteRequestFrameSchema.safeParse({
        ...base,
        id: "req-3",
        method: "DELETE",
      }).success,
    ).toBe(false);
    expect(
      AgentRouteRequestFrameSchema.safeParse({
        ...base,
        id: "req-4",
        query: { n: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("AgentRouteResultFrameSchema", () => {
  it("解析成功结果帧(result 任意 JSON 值)", () => {
    const f = {
      type: "piweb_agent_route_result",
      id: "req-1",
      ok: true,
      result: { layers: [] },
    };
    expect(AgentRouteResultFrameSchema.parse(f)).toEqual(f);
  });

  it("解析失败结果帧(error 含 code/message)", () => {
    const f = {
      type: "piweb_agent_route_result",
      id: "req-2",
      ok: false,
      error: { code: "handler_error", message: "boom" },
    };
    expect(AgentRouteResultFrameSchema.parse(f)).toEqual(f);
  });

  it("拒绝缺 ok、错误 type 与形状不全的 error", () => {
    expect(
      AgentRouteResultFrameSchema.safeParse({
        type: "piweb_agent_route_result",
        id: "req-5",
      }).success,
    ).toBe(false);
    expect(
      AgentRouteResultFrameSchema.safeParse({
        type: "agent_routes",
        id: "req-6",
        ok: true,
      }).success,
    ).toBe(false);
    expect(
      AgentRouteResultFrameSchema.safeParse({
        type: "piweb_agent_route_result",
        id: "req-7",
        ok: false,
        error: { code: "handler_error" },
      }).success,
    ).toBe(false);
  });
});
