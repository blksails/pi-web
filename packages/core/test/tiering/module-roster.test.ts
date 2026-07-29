import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_EDGES,
  MODULE_ROSTER,
  ROSTER_OVERRIDES,
  isReverseEdge,
  layerOf,
  moduleNameOf,
} from "./module-roster.js";
import { PACKAGE_ROOTS, assertEveryRootContributed } from "./package-roots.js";

/** 单元:模块层归属名册(spec: kernel-boundary-decoupling 任务 1.1;跨包由 core-package-extraction 任务 2.2 改)。 */

/** 各包根 `src/` 下的顶层模块名并集 —— 名册按**层**归类,不区分模块住在哪个包。 */
function topLevelModules(): { readonly names: ReadonlySet<string>; readonly counts: Map<string, number> } {
  const names = new Set<string>();
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
    for (const name of entries) names.add(name);
  }
  return { names, counts };
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

  it("★ 层归属 ⟹ 物理归位:名册判 neutral/core 的模块必须真在内核包里(R1.1)", () => {
    // 这条是 R1.1「内核包包含名册全部 neutral 与 core 模块」的**机械判据**。
    //
    // ★ 它很容易被写成重言式。防重言的关键在于:判据的两端来自**两个独立事实源** ——
    //   左边是名册(人写的层归属声明),右边是磁盘(实际在哪个包)。改任何一边而不改另一边都会报红。
    //   若哪天有人"为了让守卫过"去改名册,那属于改声明,会出现在 diff 里被 review 看到。
    //
    // ★ 为什么必须有:后续两个提取 spec 要搬 runner 与 adapters。搬错包(把一个 core 模块
    //   带去 runner 包)在类型层完全可能通过 —— 源码直连 + 跨包导入使它照样能编译、能跑测试,
    //   只是内核包悄悄少了一块。没有这条断言,那种错误要到消费方装包时才暴露。
    const roots = new Map(
      PACKAGE_ROOTS.map((r) => {
        const srcDir = path.join(r.dir, "src");
        const names = fs.existsSync(srcDir)
          ? fs
              .readdirSync(srcDir, { withFileTypes: true })
              .filter((e) => e.isDirectory() || e.name.endsWith(".ts"))
              .map((e) => (e.isDirectory() ? e.name : e.name.slice(0, -3)))
          : [];
        return [r.name, new Set(names)];
      }),
    );
    const inCore = roots.get("core")!;
    expect(inCore.size, "core/src 扫到 0 个模块 —— 空扫的绿与真正的绿无法区分").toBeGreaterThan(0);

    // ① 名册判 neutral/core 的,必须在 core 包里。
    const misplaced = Object.entries(MODULE_ROSTER)
      .filter(([name, layer]) => (layer === "core" || layer === "neutral") && !inCore.has(name))
      .map(([name, layer]) => `${name}(${layer}) 不在 core 包`);

    // ② 反向:落在 core 包里的模块,层归属必须是 neutral/core。
    //    查询要经 layerOf(name, "core") 以套用按包覆写 —— `index` 在两个包里是两个不同的东西。
    const strays = [...inCore]
      .filter((name) => {
        const layer = layerOf(name, "core");
        return layer !== "core" && layer !== "neutral";
      })
      .map((name) => `${name}(${layerOf(name, "core")}) 落在 core 包里`);

    expect(
      [...misplaced, ...strays],
      `模块的**层归属**与**物理归位**不一致:\n` +
        [...misplaced, ...strays].map((m) => `  ${m}\n`).join("") +
        `二者必须同时成立 —— 要么把模块搬到对的包,要么改名册的层归属(那是一次有意的声明改动)。`,
    ).toEqual([]);
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
