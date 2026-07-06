/**
 * capability 类型同源防漂移(canvas-actions-m2 · task 3.3;design「类型单源=schema z.infer」)。
 *
 * tool-kit 的 `CanvasCapability`(zod `CanvasCapabilitySchema` 推断)与 canvas-kit 的
 * `CanvasCapability`(结构接口)同名异包——两侧无包依赖边(canvas-kit 零 @blksails 硬线),
 * 靠本测的**编译期结构断言**锁死形状一致:任一侧字段增删 / 可选性变更即触发 typecheck 红。
 *
 * ⚠ 两侧刻意存在**唯一**合法差异:canvas-kit 接口全 `readonly`(ReadonlyArray + readonly 字段),
 * tool-kit 的 zod 推断为可变。故「双向可赋值」在深 readonly 维度不成立(readonly→mutable 不可赋),
 * 属设计张力(kit 只读契约 vs schema 可变)。归一化 readonly 后两者必须**结构完全相等**——
 * 这才是真正的字段/可选性防漂移;单向可赋值(mutable→readonly)另附一条,证 schema 值可直接喂 kit。
 *
 * 运行期 schema.parse 样例断言收尾(证样例同时满足 zod 校验 + 两侧接口;不作唯一断言)。
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  CanvasCapabilitySchema,
  type CanvasCapability as SchemaCapability,
} from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import type { CanvasCapability as KitCapability } from "@blksails/pi-web-canvas-kit";

/** 深度去 readonly(ReadonlyArray→Array + -readonly 字段):归一后比对形状,滤掉刻意的只读差异。 */
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

describe("CanvasCapability 类型同源(tool-kit schema ↔ canvas-kit interface)", () => {
  it("归一 readonly 后结构完全相等 + schema→kit 单向可赋值(编译期;漂移即 typecheck 红)", () => {
    // 归一化后双向严格结构相等(字段集 / 可选性 / 元素形状任一漂移即红)。
    expectTypeOf<Mutable<SchemaCapability>>().toEqualTypeOf<Mutable<KitCapability>>();
    // schema 推断值可直接喂 canvas-kit 接口(mutable → readonly,深层成立)。
    const fromSchema: SchemaCapability = {
      models: [{ id: "m", label: "M", sizes: ["1024x1024"] }],
      sizes: [{ label: "1:1", size: "1024x1024" }],
      actions: ["edit"],
    };
    const asKit: KitCapability = fromSchema;
    expectTypeOf(asKit).toMatchTypeOf<KitCapability>();

    // 运行期形状断言(样例同时满足 zod 校验 + 两侧接口)。
    const parsed = CanvasCapabilitySchema.parse(asKit);
    expect(parsed.models[0]?.id).toBe("m");
    expect(parsed.sizes[0]?.size).toBe("1024x1024");
    expect(parsed.actions).toEqual(["edit"]);
  });
});
