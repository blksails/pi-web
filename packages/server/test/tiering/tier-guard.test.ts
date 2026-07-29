import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_ROSTER,
  TIER_STRICTNESS,
  expectedTier,
  tierFromFilename,
  type TestTier,
} from "./tier-rules.js";

/**
 * 分档守卫(spec: test-tiering-fast-lane,任务 2.3)——全量扫描,断言**文件名声明的档位**
 * 与**源文本/名册判定的档位**一致。
 *
 * 本文件自身跑在 fast 档,故只读文件、不起子进程、不写盘。
 *
 * ★ 它拦的是「分档腐化」:改造前的状态就是活证据 —— 25 个真实起子进程的文件挂着
 *   `.integration` / `.e2e` 后缀却跑在 unit 档,靠注释与纪律维持了很久也没人发现。
 *   没有机械守卫,几周后就会回到那个状态。
 */

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testDir = path.join(pkgDir, "test");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".test.ts")) out.push(path.relative(pkgDir, full));
  }
  return out;
}

const files = walk(testDir).sort();

function describeMismatch(rel: string, declared: TestTier, expected: TestTier): string {
  const source = fs.readFileSync(path.join(pkgDir, rel), "utf8");
  const lines = source.split("\n");
  const hint = lines
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /child_process|mkdtemp|vi\.mock|@earendil-works|"e2b"|"pg"/.test(line))
    .slice(0, 3)
    .map(({ line, no }) => `      ${no}: ${line.trim().slice(0, 90)}`)
    .join("\n");
  return (
    `  ${rel}\n    声明=${declared} 判定=${expected}\n` +
    (hint ? `    相关行:\n${hint}\n` : "")
  );
}

describe("分档守卫 —— 文件名声明必须与判定一致", () => {
  it("没有文件把自己声明得比判定更宽松", () => {
    const offenders = files
      .map((rel) => {
        const declared = tierFromFilename(rel);
        const expected = expectedTier(rel, fs.readFileSync(path.join(pkgDir, rel), "utf8"));
        return { rel, declared, expected };
      })
      .filter(({ declared, expected }) => TIER_STRICTNESS[declared] < TIER_STRICTNESS[expected]);

    expect(
      offenders.length,
      `以下文件声明的档位比其实际依赖更宽松,会毒化快档:\n` +
        offenders.map((o) => describeMismatch(o.rel, o.declared, o.expected)).join("") +
        `修复方式:按判定档位给文件改名(*.it.test.ts / *.mock.test.ts),而不是放宽守卫。`,
    ).toBe(0);
  });

  it("没有文件靠 e2e 后缀悄悄退出默认路径", () => {
    // e2e 是唯一不进默认路径的档。过严声明本来无害(慢一点而已),唯独声明成 e2e 会让
    // 测试**静默消失** —— 测试消失比测试变红难发现得多,故这一档必须凭名册。
    const unlisted = files.filter(
      (rel) => tierFromFilename(rel) === "e2e" && !E2E_ROSTER.includes(rel),
    );

    expect(
      unlisted,
      `以下文件挂着 e2e 后缀但不在 E2E_ROSTER 名册里,会被默认测试路径跳过:\n` +
        unlisted.map((r) => `  ${r}\n`).join("") +
        `e2e 档的判据是「整文件被外部服务凭据门控」;若不是,请改回其它后缀。`,
    ).toEqual([]);
  });

  it("每个测试文件恰好归入一档,总数守恒", () => {
    const counts: Record<TestTier, number> = { fast: 0, fastMock: 0, it: 0, e2e: 0 };
    for (const rel of files) counts[tierFromFilename(rel)] += 1;
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);

    // 这条断言防的是「后缀笔误 → 文件静默失踪」。
    expect(sum, `四档计数之和 ${sum} 与实际测试文件数 ${files.length} 不符`).toBe(files.length);
    expect(files.length).toBeGreaterThan(0);
  });

  it("名册里的文件确实存在(防重命名后名册腐烂)", () => {
    const missing = [...E2E_ROSTER].filter((rel) => !fs.existsSync(path.join(pkgDir, rel)));
    expect(missing, `E2E_ROSTER 指向了不存在的文件:${missing.join(", ")}`).toEqual([]);
  });
});
