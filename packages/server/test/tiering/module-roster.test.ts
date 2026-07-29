import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_EDGES,
  MODULE_ROSTER,
  isReverseEdge,
  layerOf,
  moduleNameOf,
} from "./module-roster.js";

/** 单元:模块层归属名册(spec: kernel-boundary-decoupling,任务 1.1)。 */

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

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
  it("覆盖 src/ 下每个顶层模块,无遗漏", () => {
    const actual = fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.name.endsWith(".ts"))
      .map((e) => (e.isDirectory() ? e.name : e.name.slice(0, -3)))
      .sort();
    const missing = actual.filter((m) => MODULE_ROSTER[m] === undefined);

    expect(
      missing,
      `以下模块未归类:${missing.join(", ")}。新增 src/ 顶层模块时必须在 MODULE_ROSTER 中表态。`,
    ).toEqual([]);
  });

  it("名册不含已不存在的模块(防重构后腐烂)", () => {
    const actual = new Set(
      fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() || e.name.endsWith(".ts"))
        .map((e) => (e.isDirectory() ? e.name : e.name.slice(0, -3))),
    );
    // `template-name` 由任务 2.1 迁入,在此之前尚不存在,故豁免。
    const stale = Object.keys(MODULE_ROSTER).filter(
      (m) => !actual.has(m) && m !== "template-name",
    );

    expect(stale, `名册里有已不存在的模块:${stale.join(", ")}`).toEqual([]);
  });

  it("每条豁免都写了理由 —— 没有理由的豁免和漏网的违规长得一样", () => {
    for (const edge of ALLOWED_EDGES) {
      expect(edge.why.length, `${edge.from} → ${edge.to} 缺理由`).toBeGreaterThan(20);
    }
  });
});
