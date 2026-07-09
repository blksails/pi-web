#!/usr/bin/env node
/**
 * 共享运行时载荷改造的净收益实测（spec shared-runtime-payload 任务 9.1，Req 10.2–10.4 / 12.1–12.3）。
 *
 * 本 spec 的取舍是**不对称的**：下载体积一律下降，但单产品的磁盘占用会**上升**
 * （载荷与解包副本各存一份）。净节省只发生在「CLI 与桌面版都装」的场景。故必须实测三种
 * 安装场景，而不是只报一个好看的数字。
 *
 * 口径（与 `measure-desktop-baseline.mjs` 一致，两侧同脚本同口径）：
 *   - 冷启动 = 从 `spawn` 到**后端首次响应 `GET /`**
 *   - 包体   = `du -sk` 的实际字节数
 *   - dmg    = `hdiutil create -format UDZO`（与用户实际下载的形态一致）
 *
 * 用法：
 *   node scripts/measure-payload-baseline.mjs --app <path/to/pi-web.app> --label after [--out x.json]
 *   node scripts/measure-payload-baseline.mjs --app <old.app> --label before --no-unpack
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const READY_TIMEOUT_MS = 180_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { port: 35200, noUnpack: false, repeat: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") a.app = argv[++i];
    else if (argv[i] === "--label") a.label = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--port") a.port = Number(argv[++i]);
    else if (argv[i] === "--repeat") a.repeat = Number(argv[++i]);
    else if (argv[i] === "--no-unpack") a.noUnpack = true;
  }
  if (!a.app || !a.label) {
    console.error("用法: --app <.app> --label <before|after> [--no-unpack] [--repeat N] [--out json]");
    process.exit(1);
  }
  return a;
}

/**
 * 稳态冷启动必须重复测量取中位数。
 *
 * ★ 单次测量的噪声可达 ±400ms（页缓存冷热），足以淹没本改造的真实影响，甚至给出
 *   「改造后反而更快」这种与因果相悖的结论。Req 10.2 的 200ms 预算若用单次值裁定，
 *   等于掷硬币。原始每轮数值一并落盘，使裁定可复现、可审计。
 */
function median(sorted) {
  return sorted[Math.floor(sorted.length / 2)];
}

const bytes = (p) => (existsSync(p) ? Number(execFileSync("du", ["-sk", p], { encoding: "utf8" }).trim().split(/\s+/)[0]) * 1024 : 0);
const mb = (n) => Number((n / 1048576).toFixed(1));

async function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      await sleep(50);
    }
  }
  return false;
}

/** 启动一次 .app 内的二进制，返回冷启动至后端可用的毫秒数。 */
async function coldStart(appBin, port, env) {
  const t0 = process.hrtime.bigint();
  const proc = spawn(appBin, [], { env: { ...process.env, ...env, PI_WEB_DESKTOP_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", () => {});
  try {
    if (!(await waitReady(port, READY_TIMEOUT_MS))) throw new Error("后端未在超时内就绪");
    return Number((process.hrtime.bigint() - t0) / 1_000_000n);
  } finally {
    proc.kill("SIGTERM");
    await sleep(2500);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await sleep(500);
  }
}

/** dmg 体积：与用户实际下载的形态一致。 */
function dmgBytes(app, label) {
  const out = join(tmpdir(), `pi-web-measure-${label}-${process.pid}.dmg`);
  rmSync(out, { force: true });
  execFileSync("hdiutil", ["create", "-quiet", "-srcfolder", app, "-format", "UDZO", "-volname", `m${process.pid}`, out]);
  const size = Number(execFileSync("stat", ["-f%z", out], { encoding: "utf8" }).trim());
  rmSync(out, { force: true });
  return size;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appBin = join(args.app, "Contents/MacOS/pi-web");
  if (!existsSync(appBin)) {
    console.error(`✗ 找不到 ${appBin}`);
    process.exit(1);
  }

  const result = { label: args.label, app: args.app };

  result.appMB = mb(bytes(args.app));
  result.dmgMB = mb(dmgBytes(args.app, args.label));
  console.error(`[measure:${args.label}] .app ${result.appMB} MB → dmg ${result.dmgMB} MB`);

  /** 稳态冷启动重复 N 次，落盘每轮原始值 + 中位数（Req 10.2 的裁定依据）。 */
  async function steadyRuns(env, portFrom) {
    const runs = [];
    for (let i = 0; i < args.repeat; i++) {
      const ms = await coldStart(appBin, portFrom + i, env);
      runs.push(ms);
      console.error(`[measure:${args.label}] 稳态 #${i + 1}/${args.repeat} ${ms} ms`);
    }
    const sorted = [...runs].sort((a, b) => a - b);
    return { runs, min: sorted[0], median: median(sorted), max: sorted.at(-1) };
  }

  if (args.noUnpack) {
    // 改造前：无解包概念，所有启动走同一路径。
    result.runtimeMB = 0;
    result.steady = await steadyRuns({}, args.port);
    result.firstColdStartMs = null; // 无「首启解包」概念
  } else {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "pi-web-measure-rt-"));
    try {
      // 首启：运行时根为空 ⇒ 必然经历真实解包。仅此一次。
      result.firstColdStartMs = await coldStart(appBin, args.port, { PI_WEB_RUNTIME_ROOT: runtimeRoot });
      console.error(`[measure:${args.label}] 首启（含解包）${result.firstColdStartMs} ms`);

      result.runtimeMB = mb(bytes(runtimeRoot));
      console.error(`[measure:${args.label}] 解包出的运行时目录 ${result.runtimeMB} MB`);

      // 稳态：命中已解包目录。
      result.steady = await steadyRuns({ PI_WEB_RUNTIME_ROOT: runtimeRoot }, args.port + 1);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }
  console.error(
    `[measure:${args.label}] 稳态中位数 ${result.steady.median} ms（${args.repeat} 轮：${result.steady.runs.join(", ")}）`,
  );

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    writeFileSync(args.out, `${json}\n`);
    console.error(`[measure:${args.label}] 已写入 ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
