#!/usr/bin/env node
/**
 * 汇总净收益裁定所需的全部实测数值（spec shared-runtime-payload 任务 9.1）。
 *
 * ★ 本脚本存在的理由：裁定所依据的每一个数字都必须**可由仓库中的脚本重新产出**。
 *   手写进 JSON 的数字无法审计，也无法在 dist 变大后复跑——那等于把验收标准写死在
 *   一次性的终端输出里。
 *
 * 输入：
 *   - `evidence/measure-before.json` / `evidence/measure-after.json`
 *     （由 `scripts/measure-payload-baseline.mjs --repeat N` 产出，含每轮原始值）
 *   - 两侧 `npm pack` 解出的包目录（本脚本自行打包并 `du -sm`，与 `.app` 同口径）
 *
 * 输出：`evidence/measure-summary.json`，供 `scripts/payload-verdict.mjs` 裁定。
 *
 * 用法：
 *   node scripts/payload-summary.mjs --before-repo <改造前的 worktree 路径>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EV = join(ROOT, ".kiro/specs/shared-runtime-payload/evidence");

let beforeRepo;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--before-repo") beforeRepo = process.argv[++i];
}
if (!beforeRepo) {
  console.error("用法: --before-repo <改造前提交的 worktree 路径>");
  process.exit(1);
}

/** 与 `.app` 同口径的磁盘占用：`du -sm`（块占用），不与 npm 报告的字节和混用。 */
const duMB = (p) => Number(execFileSync("du", ["-sm", p], { encoding: "utf8" }).trim().split(/\s+/)[0]);

/** `npm pack` → 解包 → `du -sm`，得到「npm 安装后包目录」的真实磁盘占用。 */
function npmPackageDiskMB(repoDir) {
  const dest = mkdtempSync(join(tmpdir(), "pi-web-pack-"));
  try {
    execFileSync("npm", ["pack", "--pack-destination", dest], { cwd: repoDir, stdio: "pipe" });
    const tgz = readdirSync(dest).find((f) => f.endsWith(".tgz"));
    execFileSync("tar", ["xzf", join(dest, tgz), "-C", dest]);
    return duMB(join(dest, "package"));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

const before = JSON.parse(readFileSync(join(EV, "measure-before.json"), "utf8"));
const after = JSON.parse(readFileSync(join(EV, "measure-after.json"), "utf8"));

const beforeAppMB = duMB(before.app);
const afterAppMB = duMB(after.app);
const beforeNpmMB = npmPackageDiskMB(beforeRepo);
const afterNpmMB = npmPackageDiskMB(ROOT);
const runtimeMB = Math.round(after.runtimeMB);

const summary = {
  measuredAt: new Date().toISOString().slice(0, 10),
  platform: "macOS 24.6.0 / Apple Silicon (aarch64-apple-darwin)",
  provenance: {
    script: "scripts/payload-summary.mjs",
    coldStart: "scripts/measure-payload-baseline.mjs --repeat 5（原始每轮值见 measure-{before,after}.json 与 .log）",
    disk: "du -sm（.app 与 npm pack 解出的包目录同口径）",
    beforeRef: "98e7e94（含第一层剪枝），在临时 worktree 中以同一工具链重建 .app",
  },
  before: {
    appMB: beforeAppMB,
    dmgMB: before.dmgMB,
    npmPackageMB: beforeNpmMB,
    runtimeMB: 0,
    desktopOnlyDiskMB: beforeAppMB,
    cliOnlyDiskMB: beforeNpmMB,
    bothInstalledDiskMB: beforeAppMB + beforeNpmMB,
    steadyColdStartMedianMs: before.steady.median,
    steadyColdStartRunsMs: before.steady.runs,
  },
  after: {
    appMB: afterAppMB,
    dmgMB: after.dmgMB,
    npmPackageMB: afterNpmMB,
    runtimeMB,
    desktopOnlyDiskMB: afterAppMB + runtimeMB,
    cliOnlyDiskMB: afterNpmMB + runtimeMB,
    // 两者都装时共享同一份运行时，故只计一次——这正是本改造的全部收益来源。
    bothInstalledDiskMB: afterAppMB + afterNpmMB + runtimeMB,
    steadyColdStartMedianMs: after.steady.median,
    steadyColdStartRunsMs: after.steady.runs,
    firstColdStartMs: after.firstColdStartMs,
  },
};

writeFileSync(join(EV, "measure-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[payload-summary] 已写入 ${join(EV, "measure-summary.json")}`);
console.log(
  `  .app ${beforeAppMB}→${afterAppMB} MB / dmg ${before.dmgMB}→${after.dmgMB} MB / npm ${beforeNpmMB}→${afterNpmMB} MB / 运行时 ${runtimeMB} MB`,
);
console.log(
  `  稳态中位数 ${before.steady.median}→${after.steady.median} ms（各 ${before.steady.runs.length} 轮）`,
);
