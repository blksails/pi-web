import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_EDGES,
  type Layer,
  MODULE_ROSTER,
  ROSTER_OVERRIDES,
  isReverseEdge,
  layerOf,
  moduleNameOf,
} from "./module-roster.js";
import {
  PACKAGE_ROOTS,
  assertEveryRootContributed,
  type PackageRoot,
} from "./package-roots.js";

/**
 * 单元:模块层归属名册(spec: kernel-boundary-decoupling 任务 1.1;
 * 跨包由 core-package-extraction 任务 2.2 改;
 * 层⟹物理断言由 runner-package-extraction 任务 2.2 推广为映射表驱动)。
 */

/** 扫描各包根 `src/` 的顶层模块 —— 磁盘侧事实源,唯一一处 readdir。 */
function scanRoots(): {
  readonly byRoot: ReadonlyMap<string, ReadonlySet<string>>;
  readonly counts: ReadonlyMap<string, number>;
} {
  const byRoot = new Map<string, ReadonlySet<string>>();
  const counts = new Map<string, number>();
  for (const root of PACKAGE_ROOTS) {
    const srcDir = path.join(root.dir, "src");
    const entries = fs.existsSync(srcDir)
      ? fs
          .readdirSync(srcDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() || e.name.endsWith(".ts"))
          .map((e) => (e.isDirectory() ? e.name : e.name.slice(0, -3)))
      : [];
    counts.set(root.name, entries.length);
    byRoot.set(root.name, new Set(entries));
  }
  return { byRoot, counts };
}

/** 各包根 `src/` 下的顶层模块名并集 —— 名册按**层**归类,不区分模块住在哪个包。 */
function topLevelModules(): { readonly names: ReadonlySet<string>; readonly counts: ReadonlyMap<string, number> } {
  const { byRoot, counts } = scanRoots();
  const names = new Set<string>();
  for (const set of byRoot.values()) for (const name of set) names.add(name);
  return { names, counts };
}

/** 某层模块的物理归宿。 */
interface LayerPlacement {
  /** **最终**归宿的包根短名(须存在于 `PACKAGE_ROOTS`)。 */
  readonly root: string;
  /**
   * 过渡期的**暂存**包根短名 —— 模块还没搬到 `root` 时它此刻实际住在哪。
   *
   * ★ 只有当 `root` 在 `srcModules` 维度上仍是 `pendingContributions`(即该包根被要求
   *   **恰好 0 个模块**)时才允许出现,且守卫会当场核这一条。于是它与 2.1 的 pending 机制
   *   **同构**:搬迁一落地,`assertRootsContributed` 逼着删掉 pending 标记,本字段随即过期报红,
   *   判据自动恢复到「必须在 `root` 里」。**没有留下永久豁免的余地**。
   */
  readonly stagedIn?: string;
}

/**
 * **层 → 包根**映射表(design C5)。
 *
 * ★ 类型是 `Record<Layer, …>` 而非可选映射:新增一层必须在此表态,漏了当场类型错误。
 *   旧实现硬编码 `roots.get("core")`,runner 包成立后对 runner 层**恒真** ——
 *   那是「没装上的守卫报出的绿」,与真的没有违规长得一模一样。
 */
const LAYER_PLACEMENT: Readonly<Record<Layer, LayerPlacement>> = {
  neutral: { root: "core" },
  core: { root: "core" },
  // spec runner-package-extraction 任务 3.1 已把 runner 实现搬进新包,`stagedIn` 随之过期删除。
  runner: { root: "runner" },
  adapters: { root: "server" },
  assembly: { root: "server" },
};

/** 在 `srcModules` 维度上仍声明 pending(=必须恰好 0 个模块)的包根短名。 */
function pendingSrcModuleRoots(roots: readonly PackageRoot[] = PACKAGE_ROOTS): ReadonlySet<string> {
  return new Set(
    roots.filter((r) => (r.pendingContributions ?? []).includes("srcModules")).map((r) => r.name),
  );
}

/**
 * 某层模块**此刻**应当所在的包根 —— 目标包根不再 pending(=搬迁已落地)时自动回到最终归宿。
 *
 * ★ 判据的严格性是**自动恢复**的:过渡期只由 `pendingContributions` 一个开关托着,
 *   而那个开关本身是自毁的(搬进第一个文件就报红要求删掉)。因此不存在「忘了收紧」的状态。
 */
function expectedRootOf(
  layer: Layer,
  pending: ReadonlySet<string>,
  // ★ 可注入:搬迁落地后真实表里已没有任何 stagedIn,若只能读真实表,「过渡期判暂存包」
  //   这半条性质就再也测不到了 —— 而下一次搬迁又会用到它。注入让它继续被合成输入驱动。
  placement: Readonly<Record<Layer, LayerPlacement>> = LAYER_PLACEMENT,
): string {
  const place = placement[layer];
  return place.stagedIn !== undefined && pending.has(place.root) ? place.stagedIn : place.root;
}

/**
 * 断言映射表自身可解析,且没有**过期的**过渡期暂存声明。
 *
 * 注入 `placement` / `rootNames` / `pending` 是为了让本函数能被合成输入驱动 ——
 * 「搬迁完成后判据自动恢复严格」这条性质必须能被直接测到,而不是只能靠改真实磁盘来验。
 */
function assertPlacementTableSound(
  placement: Readonly<Record<Layer, LayerPlacement>>,
  rootNames: ReadonlySet<string>,
  pending: ReadonlySet<string>,
): void {
  for (const [layer, place] of Object.entries(placement) as [Layer, LayerPlacement][]) {
    if (!rootNames.has(place.root)) {
      throw new Error(`层 "${layer}" 映射到不存在的包根 "${place.root}"`);
    }
    if (place.stagedIn === undefined) continue;
    if (!rootNames.has(place.stagedIn)) {
      throw new Error(`层 "${layer}" 的暂存包根 "${place.stagedIn}" 不在 PACKAGE_ROOTS 中`);
    }
    if (!pending.has(place.root)) {
      throw new Error(
        `层 "${layer}" 仍声明暂存于 "${place.stagedIn}",但目标包根 "${place.root}" 的 ` +
          `srcModules 已不再 pending —— 搬迁已完成,暂存声明过期了。请删掉该层的 stagedIn,` +
          `让判据恢复到「必须在 ${place.root} 里」。留着它等于给这一层一条**永久豁免**。`,
      );
    }
  }
}

describe("layerOf —— 层归属查询", () => {
  it("名册中的模块返回其声明的层", () => {
    expect(layerOf("rpc-channel")).toBe("core");
    expect(layerOf("runner")).toBe("runner");
    expect(layerOf("auth")).toBe("adapters");
    expect(layerOf("source-key")).toBe("neutral");
  });

  it("未知模块抛错而非静默归类 —— 新增模块必须显式表态", () => {
    expect(() => layerOf("brand-new-module")).toThrowError(/未在 MODULE_ROSTER 中归类/);
  });
});

describe("isReverseEdge —— 跨层反向判定", () => {
  it("core 依赖 adapters 是反向", () => {
    expect(isReverseEdge("core", "adapters")).toBe(true);
  });

  it("adapters 依赖 core 是正向", () => {
    expect(isReverseEdge("adapters", "core")).toBe(false);
  });

  it("任何层依赖 neutral 都是正向", () => {
    for (const from of ["core", "runner", "adapters"] as const) {
      expect(isReverseEdge(from, "neutral"), `${from} → neutral`).toBe(false);
    }
  });

  it("runner 与 adapters 同序 —— 彼此之间的边也算反向", () => {
    expect(isReverseEdge("runner", "adapters")).toBe(true);
    expect(isReverseEdge("adapters", "runner")).toBe(true);
  });

  it("同层内部不算反向", () => {
    expect(isReverseEdge("core", "core")).toBe(false);
  });
});

describe("moduleNameOf —— 由路径取顶层模块名", () => {
  it("目录形态取首段", () => {
    expect(moduleNameOf("rpc-channel/template-resolve.ts")).toBe("rpc-channel");
  });

  it("顶层单文件去掉扩展名 —— .ts 与 .js 都要剥", () => {
    expect(moduleNameOf("source-key.ts")).toBe("source-key");
    // NodeNext 下 import specifier 写的是 .js,磁盘上是 .ts;只剥一种会查不到模块。
    expect(moduleNameOf("host-contract-version.js")).toBe("host-contract-version");
  });
});

describe("名册完整性", () => {
  it("覆盖各包 src/ 下每个顶层模块,无遗漏", () => {
    const { names } = topLevelModules();
    const missing = [...names].filter((m) => MODULE_ROSTER[m] === undefined).sort();

    expect(
      missing,
      `以下模块未归类:${missing.join(", ")}。新增 src/ 顶层模块时必须在 MODULE_ROSTER 中表态。`,
    ).toEqual([]);
  });

  it("名册不含已不存在的模块(防重构后腐烂)", () => {
    const { names } = topLevelModules();
    const stale = Object.keys(MODULE_ROSTER).filter((m) => !names.has(m));

    expect(stale, `名册里有已不存在的模块:${stale.join(", ")}`).toEqual([]);
  });

  it("每个包根都被真的扫到了(空扫会让上面两条断言双双失去意义)", () => {
    // ★ 名册完整性靠「磁盘上有什么」来判定。某个包根扫到 0 个模块时,
    //   「无遗漏」会因为无物可漏而通过 —— 那是最像绿的一种失效。
    const { counts } = topLevelModules();
    expect(() => assertEveryRootContributed(counts, "srcModules")).not.toThrow();
  });

  it("按包覆写只用于真实的同名冲突,且覆写目标确实存在于名册", () => {
    for (const [rootName, overrides] of Object.entries(ROSTER_OVERRIDES)) {
      expect(
        PACKAGE_ROOTS.some((r) => r.name === rootName),
        `覆写表里的包根 "${rootName}" 不在 PACKAGE_ROOTS 中`,
      ).toBe(true);
      for (const moduleName of Object.keys(overrides)) {
        // 覆写的前提是「这个名字在两个包里都存在但含义不同」;名字本身必须已在名册里。
        expect(
          MODULE_ROSTER[moduleName],
          `覆写了 "${moduleName}" 但它不在 MODULE_ROSTER 里 —— 覆写不是新增模块的后门`,
        ).toBeDefined();
      }
    }
  });

  it("★ 层归属 ⟹ 物理归位:每层模块必须真在该层对应的包里(R5.5,映射表驱动)", () => {
    // 这条是 R1.1 / R5.5「每一层的模块都在该层对应的包里」的**机械判据**。
    //
    // ★ 它很容易被写成重言式。防重言的关键在于:判据的两端来自**两个独立事实源** ——
    //   左边是 MODULE_ROSTER(人写的层归属声明),右边是磁盘(实际在哪个包)。
    //   改任何一边而不改另一边都会报红。若哪天有人"为了让守卫过"去改名册,
    //   那属于改声明,会出现在 diff 里被 review 看到。
    //   LAYER_PLACEMENT 不是第三个事实源,它只是把「层」翻译成「包根」的**词典**,
    //   两端仍分别落在名册与磁盘上。
    //
    // ★ 为什么必须是映射表:旧实现只查内核包,runner 包一成立,runner 层就再没有任何断言看着 ——
    //   恒真的断言与真的没有违规长得一模一样。搬错包(把一个 core 模块带去 runner 包)在类型层
    //   完全可能通过:源码直连 + 跨包导入使它照样能编译、能跑测试,只是内核包悄悄少了一块。
    const { byRoot, counts } = scanRoots();

    // ① 每个包根都真的被扫到了。空扫会让下面两个方向双双**无物可查**而通过。
    //    pending 的包根在此被反向要求「恰好 0 个」—— 任何时刻恰有一条约束生效。
    expect(() => assertEveryRootContributed(counts, "srcModules")).not.toThrow();

    // ② 映射表自身可解析,且过渡期暂存声明未过期。
    const pending = pendingSrcModuleRoots();
    expect(() =>
      assertPlacementTableSound(LAYER_PLACEMENT, new Set(byRoot.keys()), pending),
    ).not.toThrow();

    const want = (layer: Layer): string => expectedRootOf(layer, pending);

    // ③ 正向:名册判某层的模块,必须在该层对应的包根里。
    const misplaced = Object.entries(MODULE_ROSTER)
      .filter(([name, layer]) => !(byRoot.get(want(layer))?.has(name) ?? false))
      .map(([name, layer]) => `${name}(${layer}) 不在 ${want(layer)} 包`);

    // ④ 按包覆写也要自洽:覆写说"在包 X 里这个名字是层 L",那 L 就必须映射回 X,
    //    且该名字在 X 里确实存在 —— 否则覆写成了绕过映射表的后门。
    const inconsistentOverrides = Object.entries(ROSTER_OVERRIDES).flatMap(([rootName, ov]) =>
      Object.entries(ov).flatMap(([name, layer]) => {
        const target = want(layer);
        if (target !== rootName) return [`${name}(${layer}) 被覆写在 ${rootName} 包,但该层应归 ${target} 包`];
        if (!(byRoot.get(rootName)?.has(name) ?? false)) return [`${name} 被覆写在 ${rootName} 包,但那里没有这个模块`];
        return [];
      }),
    );

    // ⑤ 反向:落在某包根里的模块,其层归属映射回来必须还是这个包根。
    //    查询要经 layerOf(name, rootName) 以套用按包覆写 —— `index` 在两个包里是两个不同的东西。
    const strays = PACKAGE_ROOTS.flatMap((root) =>
      [...(byRoot.get(root.name) ?? [])]
        .filter((name) => want(layerOf(name, root.name)) !== root.name)
        .map((name) => `${name}(${layerOf(name, root.name)}) 落在 ${root.name} 包里`),
    );

    const violations = [...misplaced, ...inconsistentOverrides, ...strays];
    expect(
      violations,
      `模块的**层归属**与**物理归位**不一致:\n` +
        violations.map((m) => `  ${m}\n`).join("") +
        `二者必须同时成立 —— 要么把模块搬到对的包,要么改名册的层归属(那是一次有意的声明改动)。`,
    ).toEqual([]);
  });

  it("★ 过渡期暂存不是永久豁免:目标包根一停 pending,判据当场恢复严格", () => {
    // 这条盯的是上一条断言**唯一**的松动来源。runner 层的实现要到搬迁任务才进新包,
    // 在那之前「runner 层 ⇒ 在 runner 包」必然不成立;若把它整层跳过,断言就对 runner 恒真 ——
    // 正是本任务要根除的失效模式。故改用与 pending 机制同构的**暂存**:
    // 过渡期判「必须在暂存包」(仍是一条会响的约束),搬迁落地后自动判「必须在最终包」。
    const table = {
      neutral: { root: "core" },
      core: { root: "core" },
      runner: { root: "runner", stagedIn: "server" },
      adapters: { root: "server" },
      assembly: { root: "server" },
    } as const satisfies Readonly<Record<Layer, LayerPlacement>>;
    const rootNames = new Set(["core", "server", "runner"]);

    // 搬迁前:runner 包被要求为空,该层模块应当还在暂存包里。
    expect(expectedRootOf("runner", new Set(["runner"]), table)).toBe("server");
    // 搬迁后(pending 已被 assertRootsContributed 逼退):判据自己收紧,无需任何人记得改。
    expect(expectedRootOf("runner", new Set(), table)).toBe("runner");
    // 没有暂存声明的层不受影响。
    expect(expectedRootOf("core", new Set(["runner"]), table)).toBe("core");
    // ★ 真实表此刻已无任何暂存声明 —— 任务 3.1 搬完后判据就该无条件判最终包。
    expect(expectedRootOf("runner", new Set(["runner"]))).toBe("runner");

    // 而遗留的 stagedIn 会在同一时刻过期报红 —— 豁免只能靠让守卫变红来退场。
    expect(() => assertPlacementTableSound(table, rootNames, new Set(["runner"]))).not.toThrow();
    expect(() => assertPlacementTableSound(table, rootNames, new Set())).toThrowError(
      /暂存声明过期了.*请删掉该层的 stagedIn/s,
    );
    // 映射到不存在的包根同样报红 —— 否则表里一个笔误就让那一层无人看管。
    expect(() =>
      assertPlacementTableSound(table, new Set(["core", "server"]), new Set(["runner"])),
    ).toThrowError(/映射到不存在的包根 "runner"/);
  });

  it("覆写只对指定包根生效,不影响其它包根的查询", () => {
    // index 是唯一的同名冲突:core 的主入口 vs 兼容层的装配 barrel。
    expect(layerOf("index", "core")).toBe("core");
    expect(layerOf("index", "server")).toBe("assembly");
    expect(layerOf("index")).toBe("assembly");
  });

  it("每条豁免都写了理由 —— 没有理由的豁免和漏网的违规长得一样", () => {
    for (const edge of ALLOWED_EDGES) {
      expect(edge.why.length, `${edge.from} → ${edge.to} 缺理由`).toBeGreaterThan(20);
    }
  });
});
