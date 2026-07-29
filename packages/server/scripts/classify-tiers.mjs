#!/usr/bin/env node
/**
 * 产出 fast / fastMock / it / e2e 四档的归属清单(spec: test-tiering-fast-lane,任务 1.1)。
 *
 * 判据**不在本文件**,而是复用 `../core/test/tiering/tier-rules.ts` —— 与全量扫描守卫
 * (core 包的 `test/tiering/tier-guard.test.ts`)同一份实现。设计把 tier-rules 定为「分档判据的单一
 * 事实来源」,若此处再抄一份,归位清单与守卫就会各说各话。
 *
 * e2e 档**不由源文本推断**(整文件凭据门控写法任意,静态判不稳),由下方名册显式列出;
 * 名册的依据逐条记在 research.md §2.2(每个文件都核实过门控范围是整文件还是单个用例)。
 *
 * 用法:
 *   node scripts/classify-tiers.mjs            # 打印各档计数与总数校验
 *   node scripts/classify-tiers.mjs --list it  # 打印某一档的文件清单(每行一个)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);
const { classifyTestSource, E2E_ROSTER, RUNTIME_DETECTED_IT } = await jiti.import(
  path.join(pkgDir, "../core/test/tiering/tier-rules.ts"),
);



function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".test.ts")) out.push(path.relative(pkgDir, full));
  }
  return out;
}

const files = walk(path.join(pkgDir, "test")).sort();
const buckets = { fast: [], fastMock: [], it: [], e2e: [] };

for (const rel of files) {
  if (E2E_ROSTER.includes(rel)) {
    buckets.e2e.push(rel);
    continue;
  }
  if (RUNTIME_DETECTED_IT.includes(rel)) {
    buckets.it.push(rel);
    continue;
  }
  buckets[classifyTestSource(fs.readFileSync(path.join(pkgDir, rel), "utf8")).tier].push(rel);
}

const listArg = process.argv.indexOf("--list");
if (listArg !== -1) {
  const tier = process.argv[listArg + 1];
  if (!(tier in buckets)) {
    console.error(`未知档位 ${tier};可选:${Object.keys(buckets).join(" / ")}`);
    process.exit(2);
  }
  for (const f of buckets[tier]) console.log(f);
  process.exit(0);
}

const sum = Object.values(buckets).reduce((n, b) => n + b.length, 0);
for (const [tier, b] of Object.entries(buckets)) {
  console.log(`${tier.padEnd(9)} ${String(b.length).padStart(4)}`);
}
console.log(`${"合计".padEnd(8)} ${String(sum).padStart(4)}   实际测试文件数 ${files.length}`);
if (sum !== files.length) {
  console.error("✗ 归属之和与实际文件数不符 —— 有文件未被分类");
  process.exit(1);
}
console.log("✓ 每个文件恰好归入一档");
