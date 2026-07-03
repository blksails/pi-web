import { describe, it, expect } from "vitest";
import {
  getSurfaceRegistry,
  SURFACE_REGISTRY_SEAM_KEY,
  type SurfaceDispatch,
} from "../../src/surface/surface-registry.js";

const fakeDispatch = (tag: string): SurfaceDispatch => ({
  dispatch: async (action) => ({ domain: tag, action, ok: true, data: { tag } }),
});

describe("surfaceRegistry", () => {
  it("register 后 get 返回同一 entry", () => {
    const scope: Record<string, unknown> = {};
    const reg = getSurfaceRegistry(scope);
    const entry = fakeDispatch("demo");
    reg.register("demo", entry);
    expect(reg.get("demo")).toBe(entry);
  });

  it("未注册的 domain 返回 undefined", () => {
    const scope: Record<string, unknown> = {};
    expect(getSurfaceRegistry(scope).get("absent")).toBeUndefined();
  });

  it("同一 scope 内多次 getSurfaceRegistry 收敛到同一注册表(装配顺序无关)", () => {
    const scope: Record<string, unknown> = {};
    const a = getSurfaceRegistry(scope);
    const entry = fakeDispatch("demo");
    a.register("demo", entry);
    // 另一处(如 server wireSurfaceBridge)后读同一 seam
    const b = getSurfaceRegistry(scope);
    expect(b.get("demo")).toBe(entry);
    expect(scope[SURFACE_REGISTRY_SEAM_KEY]).toBeDefined();
  });

  it("不同 scope 相互隔离", () => {
    const scopeA: Record<string, unknown> = {};
    const scopeB: Record<string, unknown> = {};
    getSurfaceRegistry(scopeA).register("demo", fakeDispatch("a"));
    expect(getSurfaceRegistry(scopeB).get("demo")).toBeUndefined();
  });

  it("覆盖注册:同 domain 二次 register 覆盖前值", () => {
    const scope: Record<string, unknown> = {};
    const reg = getSurfaceRegistry(scope);
    const first = fakeDispatch("first");
    const second = fakeDispatch("second");
    reg.register("demo", first);
    reg.register("demo", second);
    expect(reg.get("demo")).toBe(second);
  });
});
