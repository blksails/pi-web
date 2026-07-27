/**
 * 依赖方向守卫(desktop-online-source-runnable 任务 6.1)。
 *
 * P1(desktop-hybrid-agent-sources)的范围铁律:`@pi-clouds/registry-client` **不得进入**
 * `packages/server/src`。本特性把「判别 + 索引」下沉进包内、「安装」留在应用层正是为了守住它。
 *
 * ★ 这条铁律靠人自觉守不住 —— 它没有编译期强制:该包经 vitest/tsconfig/esbuild 三处别名
 *   指向兄弟仓源码,包内误加一行 import 后 typecheck 与单测**都会照常通过**,直到某天
 *   `pnpm dev:server` 启动即 MODULE_NOT_FOUND(本特性实施期真实踩到过)。故必须有守卫用例。
 *
 * ★ 守卫必须能真的失败:下方「自检」用例先证明检测函数对一段含该 import 的样本文本会判违规,
 *   否则一个恒真的重言式守卫比没有守卫更危险(会给人虚假的安全感)。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const FORBIDDEN = "@pi-clouds/registry-client";

/**
 * 判定一段源码是否**真实** import 了禁用包(注释中的提及不算)。
 *
 * 先剥块注释与行注释,再匹配 import/export/require 语句 —— 本仓多处注释刻意提到该包名
 * (说明为何不依赖它),朴素 grep 会把它们误判为违规。
 */
export function hasForbiddenImport(code: string): boolean {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const pattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:import|export)[\s\S]{0,200}?from\s*["']${FORBIDDEN}(?:/[^"']*)?["']` +
      String.raw`|require\(\s*["']${FORBIDDEN}(?:/[^"']*)?["']\s*\)` +
      String.raw`|import\(\s*["']${FORBIDDEN}(?:/[^"']*)?["']\s*\)`,
  );
  return pattern.test(stripped);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("依赖方向守卫 — registry-client 不得进入 packages/server/src", () => {
  it("检测函数自身有效(不是恒真的重言式)", () => {
    // 正样本:真实 import 必须被判违规。
    expect(hasForbiddenImport(`import { verifyIntegrity } from "${FORBIDDEN}";`)).toBe(true);
    expect(hasForbiddenImport(`import x from "${FORBIDDEN}/testing";`)).toBe(true);
    expect(hasForbiddenImport(`const m = require("${FORBIDDEN}");`)).toBe(true);
    expect(hasForbiddenImport(`await import("${FORBIDDEN}");`)).toBe(true);
    expect(
      hasForbiddenImport(`export { computeIntegrity } from "${FORBIDDEN}";`),
    ).toBe(true);

    // 负样本:注释中的提及不算违规(本仓多处这样解释「为何不依赖它」)。
    expect(hasForbiddenImport(`// 不依赖 ${FORBIDDEN}:手写 fetch\n`)).toBe(false);
    expect(hasForbiddenImport(`/**\n * 见 ${FORBIDDEN} 的说明。\n */\n`)).toBe(false);
  });

  it("packages/server/src 全树零违规", () => {
    const offenders = walk(SRC).filter((f) => hasForbiddenImport(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
