import { describe, it, expect } from "vitest";
import { createUiComponentRegistry } from "../../src/components/ui-component-registry.js";

const Dummy = () => null;
const Other = () => null;

describe("UiComponentRegistry", () => {
  it("注册并解析组件", () => {
    const reg = createUiComponentRegistry();
    reg.registerUiComponent("metric", Dummy);
    expect(reg.resolveUiComponent("metric")).toBe(Dummy);
  });

  it("未注册返回 undefined", () => {
    const reg = createUiComponentRegistry();
    expect(reg.resolveUiComponent("nope")).toBeUndefined();
  });

  it("覆盖语义:最后写入胜出", () => {
    const reg = createUiComponentRegistry();
    reg.registerUiComponent("x", Dummy);
    reg.registerUiComponent("x", Other);
    expect(reg.resolveUiComponent("x")).toBe(Other);
  });

  it("list 返回已排序名", () => {
    const reg = createUiComponentRegistry();
    reg.registerUiComponent("b", Dummy);
    reg.registerUiComponent("a", Dummy);
    expect(reg.list()).toEqual(["a", "b"]);
  });

  it("reset 清空", () => {
    const reg = createUiComponentRegistry();
    reg.registerUiComponent("x", Dummy);
    reg.reset();
    expect(reg.resolveUiComponent("x")).toBeUndefined();
  });

  it("工厂实例相互隔离", () => {
    const a = createUiComponentRegistry();
    const b = createUiComponentRegistry();
    a.registerUiComponent("x", Dummy);
    expect(b.resolveUiComponent("x")).toBeUndefined();
  });
});
