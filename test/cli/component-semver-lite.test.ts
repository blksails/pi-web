// @vitest-environment node
/**
 * semver-lite 单测(spec cli-component-add,任务 2.1,Req 4.4)。
 * 四种写法的进退位边界矩阵 + 不支持写法拒绝表。
 */
import { describe, expect, it } from "vitest";
import { parseRange, parseVersion, satisfies } from "@/server/cli/component/semver-lite";

function check(version: string, range: string): boolean {
  const parsed = parseRange(range);
  if ("error" in parsed) throw new Error(`range 应可解析: ${range}`);
  return satisfies(version, parsed);
}

describe("parseVersion", () => {
  it("解析 x.y.z 与 v 前缀", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("v0.10.0")).toEqual([0, 10, 0]);
  });
  it("拒绝二段、prerelease 与非数字", () => {
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3-beta.1")).toBeNull();
    expect(parseVersion("a.b.c")).toBeNull();
  });
});

describe("satisfies:四种写法边界矩阵", () => {
  it("精确:仅完全相等", () => {
    expect(check("1.2.3", "1.2.3")).toBe(true);
    expect(check("1.2.4", "1.2.3")).toBe(false);
    expect(check("v1.2.3", "1.2.3")).toBe(true);
  });
  it(">=:逐位比较(主/次/补丁位进退位)", () => {
    expect(check("1.2.3", ">=1.2.3")).toBe(true);
    expect(check("1.2.2", ">=1.2.3")).toBe(false);
    expect(check("1.3.0", ">=1.2.9")).toBe(true);
    expect(check("2.0.0", ">=1.9.9")).toBe(true);
    expect(check("0.9.9", ">=1.0.0")).toBe(false);
  });
  it("^:锁主版本;主版本 0 锁次版本", () => {
    expect(check("1.9.0", "^1.2.3")).toBe(true);
    expect(check("2.0.0", "^1.2.3")).toBe(false);
    expect(check("1.2.2", "^1.2.3")).toBe(false);
    expect(check("0.3.5", "^0.3.1")).toBe(true);
    expect(check("0.4.0", "^0.3.1")).toBe(false);
  });
  it("~:锁主次版本", () => {
    expect(check("1.2.9", "~1.2.3")).toBe(true);
    expect(check("1.3.0", "~1.2.3")).toBe(false);
    expect(check("1.2.2", "~1.2.3")).toBe(false);
  });
  it("version 不可解析视为不满足", () => {
    const range = parseRange(">=1.0.0");
    if ("error" in range) throw new Error("unreachable");
    expect(satisfies("not-a-version", range)).toBe(false);
  });
});

describe("parseRange:不支持写法拒绝表", () => {
  it.each(["<2.0.0", ">1.0.0", "1.x", "*", "1.2.3 - 2.0.0", "^1.2.3 || ^2.0.0", ">=1.0.0-beta", ""])(
    "拒绝 %j 并回传原文",
    (raw) => {
      const parsed = parseRange(raw);
      expect(parsed).toEqual({ error: "range_unsupported", raw });
    },
  );
});
