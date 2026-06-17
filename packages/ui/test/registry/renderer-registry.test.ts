import { describe, it, expect } from "vitest";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";

function Dummy(): null {
  return null;
}
function Dummy2(): null {
  return null;
}

describe("renderer-registry", () => {
  it("注册后 resolve 命中", () => {
    const r = createRendererRegistry();
    r.registerToolRenderer("search", Dummy);
    r.registerDataPartRenderer("pi-plan", Dummy);
    expect(r.resolveToolRenderer("search")).toBe(Dummy);
    expect(r.resolveDataPartRenderer("pi-plan")).toBe(Dummy);
  });

  it("未注册返回 undefined(回退)", () => {
    const r = createRendererRegistry();
    expect(r.resolveToolRenderer("nope")).toBeUndefined();
    expect(r.resolveDataPartRenderer("nope")).toBeUndefined();
  });

  it("重复注册以最后者为准(覆盖语义)", () => {
    const r = createRendererRegistry();
    r.registerToolRenderer("search", Dummy);
    r.registerToolRenderer("search", Dummy2);
    expect(r.resolveToolRenderer("search")).toBe(Dummy2);
  });

  it("工厂实例彼此隔离", () => {
    const a = createRendererRegistry();
    const b = createRendererRegistry();
    a.registerToolRenderer("x", Dummy);
    expect(b.resolveToolRenderer("x")).toBeUndefined();
  });
});
