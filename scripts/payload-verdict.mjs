#!/usr/bin/env node
/**
 * 净收益裁定（spec shared-runtime-payload 任务 9.2，Req 12.4–12.7 / 10.2）。
 *
 * 本 spec 的取舍是**不对称的**：下载体积一律下降，但单产品的磁盘占用会上升（载荷与
 * 解包副本各存一份）。净节省只发生在「CLI 与桌面版都装」的场景。
 *
 * 四条阈值任一不达标 ⇒ 判定净收益不成立 ⇒ **停止并交回决策者**，而非默认继续。
 * 不接受「压缩后理论上更小」一类论证：全部数值必须来自 `evidence/measure-summary.json`
 * 的实测。
 *
 * 用法：`node scripts/payload-verdict.mjs [summary.json]`
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const summaryPath = resolve(
  process.argv[2] ?? join(ROOT, ".kiro/specs/shared-runtime-payload/evidence/measure-summary.json"),
);
const s = JSON.parse(readFileSync(summaryPath, "utf8"));

/** 阈值。改动它们等于改动本 spec 的验收标准，须回到 requirements。 */
export const THRESHOLDS = {
  minDmgDropPct: 25,
  maxSingleProductDiskIncreaseMB: 20,
  minBothInstalledSavingMB: 50,
  maxSteadyColdStartIncreaseMs: 200,
};

const dmgDropPct = ((s.before.dmgMB - s.after.dmgMB) / s.before.dmgMB) * 100;
const desktopOnlyDelta = s.after.desktopOnlyDiskMB - s.before.desktopOnlyDiskMB;
const cliOnlyDelta = s.after.cliOnlyDiskMB - s.before.cliOnlyDiskMB;
const bothSaving = s.before.bothInstalledDiskMB - s.after.bothInstalledDiskMB;
const steadyDelta = s.after.steadyColdStartMedianMs - s.before.steadyColdStartMedianMs;

const checks = [
  {
    name: "安装包下载体积降幅",
    actual: `${dmgDropPct.toFixed(1)}%（${s.before.dmgMB} → ${s.after.dmgMB} MB）`,
    pass: dmgDropPct >= THRESHOLDS.minDmgDropPct,
    want: `≥ ${THRESHOLDS.minDmgDropPct}%`,
    req: "12.4",
  },
  {
    name: "仅装桌面版的磁盘增量",
    actual: `${desktopOnlyDelta >= 0 ? "+" : ""}${desktopOnlyDelta} MB`,
    pass: desktopOnlyDelta <= THRESHOLDS.maxSingleProductDiskIncreaseMB,
    want: `≤ +${THRESHOLDS.maxSingleProductDiskIncreaseMB} MB`,
    req: "12.5",
  },
  {
    name: "仅装 CLI 的磁盘增量",
    actual: `${cliOnlyDelta >= 0 ? "+" : ""}${cliOnlyDelta} MB`,
    pass: cliOnlyDelta <= THRESHOLDS.maxSingleProductDiskIncreaseMB,
    want: `≤ +${THRESHOLDS.maxSingleProductDiskIncreaseMB} MB`,
    req: "12.5",
  },
  {
    name: "两者都装的磁盘净节省",
    actual: `${bothSaving} MB（${s.before.bothInstalledDiskMB} → ${s.after.bothInstalledDiskMB} MB）`,
    pass: bothSaving >= THRESHOLDS.minBothInstalledSavingMB,
    want: `≥ ${THRESHOLDS.minBothInstalledSavingMB} MB`,
    req: "12.6",
  },
  {
    name: "稳态冷启动增量（中位数）",
    actual: `${steadyDelta >= 0 ? "+" : ""}${steadyDelta} ms`,
    pass: steadyDelta <= THRESHOLDS.maxSteadyColdStartIncreaseMs,
    want: `≤ +${THRESHOLDS.maxSteadyColdStartIncreaseMs} ms`,
    req: "10.2",
  },
];

console.log(`净收益裁定（数据源：${summaryPath}）\n`);
for (const c of checks) {
  console.log(`${c.pass ? "✓" : "✗"} ${c.name.padEnd(18)} ${c.actual.padEnd(34)} 要求 ${c.want}  [Req ${c.req}]`);
}

const failed = checks.filter((c) => !c.pass);
console.log();
if (failed.length > 0) {
  console.log("裁定：**净收益不成立**。按 Req 12.7，改造应停止并交回决策者重新裁定。");
  console.log(`未达标项：${failed.map((c) => c.name).join("、")}`);
  process.exit(1);
}
console.log("裁定：四条阈值全部达标，净收益成立，改造继续。");
console.log(`附：首次启动（含解包）${s.after.firstColdStartMs} ms，仅发生一次；解包出的共享运行时 ${s.after.runtimeMB} MB。`);
