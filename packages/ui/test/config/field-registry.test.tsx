import { describe, it, expect } from "vitest";
import type { FieldDescriptor } from "@blksails/protocol";
import {
  createFieldRegistry,
  type FieldRendererComponent,
} from "../../src/config/field-registry.js";

const Dummy: FieldRendererComponent = () => null;
const Other: FieldRendererComponent = () => null;

function desc(over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { key: "k", kind: "string", label: "K", required: false, ...over };
}

describe("field-registry", () => {
  it("按 kind 解析,未注册返回 undefined", () => {
    const r = createFieldRegistry();
    expect(r.resolve(desc())).toBeUndefined();
    r.registerByKind("string", Dummy);
    expect(r.resolve(desc())).toBe(Dummy);
  });

  it("fieldKey 覆盖优先于 kind", () => {
    const r = createFieldRegistry();
    r.registerByKind("string", Dummy);
    r.registerByKey("special", Other);
    expect(r.resolve(desc({ key: "special" }))).toBe(Other);
  });

  it("widget 命中 byKey 注册", () => {
    const r = createFieldRegistry();
    r.registerByKey("fancy", Other);
    expect(r.resolve(desc({ widget: "fancy" }))).toBe(Other);
  });

  it("工厂实例隔离", () => {
    const a = createFieldRegistry();
    const b = createFieldRegistry();
    a.registerByKind("string", Dummy);
    expect(b.resolve(desc())).toBeUndefined();
  });
});
