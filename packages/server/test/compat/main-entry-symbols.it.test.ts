import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

/**
 * 兼容层主入口的**符号集合守卫**(spec: core-package-extraction,任务 5.2;R2.2 / R2.4)。
 *
 * 内核提取把主 barrel 从"逐条 re-export 25 个本地模块"改成"转发内核包 + 本地装配/adapters
 * 符号"。这次改动对既有消费方必须**完全不可见** —— 该包已发布上游,跨仓静默不匹配的代价极高。
 * 本测试把上一步用过的一次性 `diff` 固化成常驻闸门。
 *
 * ★ 基准以**文件形式入库**(`main-entry-symbols.txt`),不是运行时快照。区别很实在:
 *   改动基准必须是有意动作,会出现在 diff 里、会被 review 看到。这正是 R2.4
 *   「刻意不导出的缺口不得顺手补全」的执行方式 —— 补全会让符号数增加,本测试立刻转红。
 *
 * ★ 归 **it 档**而非快档:它要 `jiti` 加载真实主入口,会连带拉起 pi SDK 的传递依赖。
 *   放进快档会把整条快车道拖慢,而快档的价值就在于 10 秒预算。
 */

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = path.join(pkgDir, "test/compat/main-entry-symbols.txt");

describe("兼容层主入口 —— 导出符号集合逐字不变", () => {
  it("与入库基准逐字相同(多一个少一个都算破坏)", async () => {
    const jiti = createJiti(import.meta.url);
    const mod = (await jiti.import(path.join(pkgDir, "src/index.ts"))) as Record<string, unknown>;
    const actual = Object.keys(mod).sort();
    const expected = fs.readFileSync(baselinePath, "utf8").trim().split("\n");

    const added = actual.filter((s) => !expected.includes(s));
    const removed = expected.filter((s) => !actual.includes(s));

    expect(
      { added, removed },
      `主入口导出面变了。这是**跨仓可见**的破坏性改动,不能靠改基准了事:\n` +
        (added.length ? `  新增:${added.join(", ")}\n` : "") +
        (removed.length ? `  消失:${removed.join(", ")}\n` : "") +
        `· 「消失」= 既有消费方直接编译失败。\n` +
        `· 「新增」多半是"顺手补全"了一个刻意留的缺口(R2.4)——那些缺口是为挡依赖污染有意为之的。\n` +
        `确实需要改导出面时,同步更新 ${path.relative(pkgDir, baselinePath)}(会出现在 diff 里)。`,
    ).toEqual({ added: [], removed: [] });
  });

  it("基准文件本身非空且无重复(防基准被清空后本守卫空转)", () => {
    const lines = fs.readFileSync(baselinePath, "utf8").trim().split("\n");
    // ★ 一个被清空的基准会让上面那条断言"恒真"——空扫式失效,与真正通过长得一模一样。
    expect(lines.length).toBeGreaterThan(300);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
