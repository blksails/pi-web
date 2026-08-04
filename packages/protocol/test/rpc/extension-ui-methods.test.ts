/**
 * extension-ui method 二分守卫(spec session-meta-index, 任务 1.1 / Req 7.2)。
 *
 * 判据取自 **schema 本身**:从 `RpcExtensionUIRequestSchema` 的判别分支反推 method 全集,
 * 再与两份人工清单做差集。故新增一个 method 分支而忘记归类时本测试必红 ——
 * 这正是「挂起表非空 ≠ 在等用户」那条风险的长期防线。
 *
 * ★ 刻意**不**写成 `expect(INTERACTIVE).toEqual(["select",...])` 那种常量比常量的重言式:
 *   那种断言在 schema 新增分支时不会有任何反应。
 */
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_EXTENSION_UI_METHODS,
  PUSH_EXTENSION_UI_METHODS,
  RpcExtensionUIRequestSchema,
  isInteractiveExtensionUIMethod,
} from "../../src/rpc/extension-ui.js";

/** 从 schema 判别分支反推 method 全集(不硬编码)。 */
function methodsFromSchema(): string[] {
  return RpcExtensionUIRequestSchema.options.map((branch) => {
    const shape = branch.shape as { method: { value: string } };
    return shape.method.value;
  });
}

describe("extension-ui method 二分", () => {
  it("schema 分支的 method 全集被两份清单穷尽覆盖", () => {
    const all = new Set(methodsFromSchema());
    const classified = new Set<string>([
      ...INTERACTIVE_EXTENSION_UI_METHODS,
      ...PUSH_EXTENSION_UI_METHODS,
    ]);
    const unclassified = [...all].filter((m) => !classified.has(m));
    const phantom = [...classified].filter((m) => !all.has(m));
    expect(unclassified, "schema 有此 method 但未归类").toEqual([]);
    expect(phantom, "清单中的 method 在 schema 里不存在").toEqual([]);
  });

  it("交互类与推送类互斥", () => {
    const overlap = INTERACTIVE_EXTENSION_UI_METHODS.filter((m) =>
      (PUSH_EXTENSION_UI_METHODS as readonly string[]).includes(m),
    );
    expect(overlap).toEqual([]);
  });

  it("守卫具备判别力:漏登记一个 method 会被检出", () => {
    // 模拟「新增 schema 分支但忘记归类」:从已分类集合中抽掉一个,差集必须非空。
    const all = new Set(methodsFromSchema());
    const incomplete = new Set<string>([
      ...INTERACTIVE_EXTENSION_UI_METHODS.slice(1),
      ...PUSH_EXTENSION_UI_METHODS,
    ]);
    const unclassified = [...all].filter((m) => !incomplete.has(m));
    expect(unclassified.length).toBeGreaterThan(0);
  });

  it("isInteractiveExtensionUIMethod 按二分判定,未知 method 归非交互", () => {
    for (const m of INTERACTIVE_EXTENSION_UI_METHODS) {
      expect(isInteractiveExtensionUIMethod(m)).toBe(true);
    }
    for (const m of PUSH_EXTENSION_UI_METHODS) {
      expect(isInteractiveExtensionUIMethod(m)).toBe(false);
    }
    expect(isInteractiveExtensionUIMethod("someFutureMethod")).toBe(false);
  });
});
