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

  it("两个 extId 注册同一 type 互不覆盖(命名空间隔离)", () => {
    const r = createRendererRegistry();
    r.registerDataPartRenderer("data-card", Dummy, "ext-a");
    r.registerDataPartRenderer("data-card", Dummy2, "ext-b");
    // 后注册的扩展优先(ext-b),但 ext-a 仍保留:清掉 ext-b 后回到 ext-a。
    expect(r.resolveDataPartRenderer("data-card")).toBe(Dummy2);
    r.clearExtension("ext-b");
    expect(r.resolveDataPartRenderer("data-card")).toBe(Dummy);
  });

  it("扩展声明优先于宿主默认", () => {
    const r = createRendererRegistry();
    r.registerDataPartRenderer("data-card", Dummy); // 宿主默认
    r.registerDataPartRenderer("data-card", Dummy2, "ext-a"); // 扩展
    expect(r.resolveDataPartRenderer("data-card")).toBe(Dummy2);
    r.clearExtension("ext-a");
    expect(r.resolveDataPartRenderer("data-card")).toBe(Dummy); // 回退宿主默认
  });

  it("clearExtension 只清该扩展;reset 清空整表", () => {
    const r = createRendererRegistry();
    r.registerToolRenderer("t", Dummy, "ext-a");
    r.registerToolRenderer("u", Dummy2, "ext-b");
    r.clearExtension("ext-a");
    expect(r.resolveToolRenderer("t")).toBeUndefined();
    expect(r.resolveToolRenderer("u")).toBe(Dummy2);
    r.reset();
    expect(r.resolveToolRenderer("u")).toBeUndefined();
  });
});
