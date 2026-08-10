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
const removedManifestPath = path.join(pkgDir, "test/compat/main-entry-symbols.removed-5.1.txt");

describe("兼容层主入口 —— 导出符号集合逐字不变", () => {
  it("与入库基准逐字相同(多一个少一个都算破坏)", async () => {
    const jiti = createJiti(import.meta.url);
    const mod = (await jiti.import(path.join(pkgDir, "src/index.ts"))) as Record<string, unknown>;
    const actual = Object.keys(mod).sort();
    const expected = fs.readFileSync(baselinePath, "utf8").trim().split(/\r?\n/);

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
    const lines = fs.readFileSync(baselinePath, "utf8").trim().split(/\r?\n/);
    // ★ 一个被清空的基准会让上面那条断言"恒真"——空扫式失效,与真正通过长得一模一样。
    // 阈值随 adapters 提取(任务 5.1)自 300 下调至 200:主入口收窄后基准为 224 个符号。
    // 收窄前的 313 符号基准另存在 main-entry-symbols.before-adapters-extraction.txt。
    expect(lines.length).toBeGreaterThan(200);
    expect(new Set(lines).size).toBe(lines.length);
  });

  /**
   * ★ 移除清单与新基准的**互锁**(spec: adapters-package-extraction,任务 5.1;R3.2 / R3.3)。
   *
   * 上面两条只管「与新基准逐字相同」,它们对**基准是怎么变成现在这样的**一无所知 ——
   * 而这正是本轮唯一需要留痕的东西:「有意移除」与「不小心弄丢」在 diff 上长得一样。
   *
   * 故把移除清单变成**载荷**而非说明文字:清单里的每个符号都必须**确实不在**新基准上。
   * 于是清单不会腐烂 —— 谁把某个符号悄悄转发回主入口,这条立刻报红并指名道姓。
   */
  it("移除清单逐一枚举、且其中每个符号确实已不在主入口上", () => {
    const rows = fs
      .readFileSync(removedManifestPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("#"));
    const entries = rows.map((l) => {
      const [mod = "", symbol = "", kind = ""] = l.split("\t");
      return { mod, symbol, kind };
    });

    // 清单本身必须是逐一枚举(而非一句"移除了 N 个"),且格式完整。
    expect(entries.length).toBeGreaterThan(150);
    expect(entries.every((e) => e.mod && e.symbol && /^(value|type-only)$/.test(e.kind))).toBe(true);
    expect(new Set(entries.map((e) => e.symbol)).size).toBe(entries.length);

    // ★ 分类不得退化成一边倒:本次是 89 个运行期值 + 72 个纯类型。
    // 纯类型那 72 个**本守卫的基准看不见**(基准是 Object.keys 的产物,只有值)——
    // 这正是清单必须自带 kind 列的原因:只读基准会把契约损失低估掉四成多。
    const values = entries.filter((e) => e.kind === "value");
    expect(values.length).toBeGreaterThan(50);
    expect(entries.length - values.length).toBeGreaterThan(50);

    const baseline = new Set(fs.readFileSync(baselinePath, "utf8").trim().split(/\r?\n/));
    // 只有 value 行能与基准互锁 —— type-only 行在基准里从来没出现过,拿它对基准断言会是重言式。
    const resurrected = values.filter((e) => baseline.has(e.symbol));
    expect(
      resurrected.map((e) => `${e.mod}/${e.symbol}`),
      `移除清单里的符号又出现在主入口基准上了。要么是有人把 adapters 转发加了回来,\n` +
        `要么是同名符号从别处进了主入口 —— 两种都得先说清楚,再决定是改清单还是撤改动。`,
    ).toEqual([]);

    // 旧基准可考古,且确实是收窄前那份(它必须**包含**全部被移除符号)。
    const before = new Set(
      fs
        .readFileSync(path.join(pkgDir, "test/compat/main-entry-symbols.before-adapters-extraction.txt"), "utf8")
        .trim()
        .split(/\r?\n/),
    );
    expect(values.filter((e) => !before.has(e.symbol))).toEqual([]);
    expect(before.size).toBeGreaterThan(baseline.size);
  });
});
