import { describe, expect, it } from "vitest";
import { deepMergeJson } from "../../src/workspace/merge.js";

/**
 * host-contract-ports 任务 2.3 —— 深度合并语义(Req 2.3/2.4)。
 *
 * ★ 断言口径以既有 `config/config-codec.ts` 的 `deepMerge` 为权威:后续阶段 ConfigCodec
 * 会改建于 Workspace 之上,语义若有差,迁移时会以「配置莫名丢字段」的形态暴露。
 */

describe("深度合并(Req 2.3)", () => {
  it("嵌套对象递归合并,保留既有值中本次未涉及的字段", () => {
    const base = { a: { x: 1, y: 2 }, keep: "yes" };
    const incoming = { a: { y: 20, z: 30 } };
    expect(deepMergeJson(base, incoming)).toEqual({
      a: { x: 1, y: 20, z: 30 },
      keep: "yes",
    });
  });

  it("多层嵌套逐层递归", () => {
    const base = { l1: { l2: { l3: { a: 1, b: 2 } } } };
    const incoming = { l1: { l2: { l3: { b: 9 } } } };
    expect(deepMergeJson(base, incoming)).toEqual({
      l1: { l2: { l3: { a: 1, b: 9 } } },
    });
  });

  it("★ 数组整体替换,不逐元素合并也不拼接", () => {
    const base = { list: [1, 2, 3], nested: { arr: ["a", "b"] } };
    const incoming = { list: [9], nested: { arr: [] } };
    expect(deepMergeJson(base, incoming)).toEqual({
      list: [9],
      nested: { arr: [] },
    });
  });

  it("标量覆盖标量;类型不匹配时 incoming 整体胜出", () => {
    expect(deepMergeJson({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    // 对象 → 标量
    expect(deepMergeJson({ a: { x: 1 } }, { a: 5 })).toEqual({ a: 5 });
    // 标量 → 对象
    expect(deepMergeJson({ a: 5 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    // 数组 → 对象
    expect(deepMergeJson({ a: [1] }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
    // 对象 → 数组
    expect(deepMergeJson({ a: { x: 1 } }, { a: [1] })).toEqual({ a: [1] });
  });

  it("null 覆盖对象(null 不参与递归)", () => {
    expect(deepMergeJson({ a: { x: 1 } }, { a: null })).toEqual({ a: null });
    expect(deepMergeJson({ a: null }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
  });

  it("★ undefined 值同样写入,不被跳过 —— 与既有落盘器逐项一致", () => {
    // 既有实现遍历 Object.entries(incoming),对 undefined 执行 result[key] = undefined。
    // 看似"忽略未定义值"更干净,但那会改变语义:落盘时 JSON.stringify 丢弃 undefined 故
    // 磁盘态相同,差异只在内存态 —— 正因如此更须对齐,否则问题只在特定时序下显形。
    const merged = deepMergeJson({ a: 1 }, { a: undefined });
    expect("a" in merged).toBe(true);
    expect(merged.a).toBeUndefined();
  });

  it("空 incoming 不改变 base", () => {
    const base = { a: { x: 1 }, b: [1, 2] };
    expect(deepMergeJson(base, {})).toEqual(base);
  });
});

describe("纯函数性", () => {
  it("不修改任何入参", () => {
    const base = { a: { x: 1 }, list: [1] };
    const incoming = { a: { y: 2 } };
    const baseSnapshot = JSON.stringify(base);
    const incomingSnapshot = JSON.stringify(incoming);

    // 返回值类型是 Readonly,此处刻意绕过以证明「改结果不会波及入参」。
    const merged = deepMergeJson(base, incoming) as Record<string, unknown>;
    merged.a = { mutated: true };

    expect(JSON.stringify(base)).toBe(baseSnapshot);
    expect(JSON.stringify(incoming)).toBe(incomingSnapshot);
  });

  it("嵌套层也是新对象,不与 base 共享引用", () => {
    const inner = { x: 1 };
    const base = { a: inner };
    const merged = deepMergeJson(base, { a: { y: 2 } });
    expect(merged.a).not.toBe(inner);
    expect(inner).toEqual({ x: 1 });
  });
});
