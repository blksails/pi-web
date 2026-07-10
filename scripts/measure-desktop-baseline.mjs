#!/usr/bin/env node
/**
 * 桌面壳的内存 / 冷启动 / 包体实测（spec electron-to-tauri 任务 8.1，Req 11.1–11.4）。
 *
 * 迁移的**唯一动机**是「内存与启动开销」和「包体积」。本脚本产出两侧同口径的实测数值，
 * 供 Req 11.5 的阈值裁定使用。不接受「新方案理论上更轻」一类论证。
 *
 * 三项口径（两侧必须完全一致，否则对比无意义）：
 *
 * 1. **空闲常驻内存**：启动 → 后端就绪 → 空闲 `IDLE_MS` → 汇总**应用进程树全部进程**的 RSS。
 *    ★ Electron 是多进程（main + renderer + gpu + utility…），Tauri 是主进程 + WebView 进程。
 *      只测主进程会系统性低估 Electron，构成不公平对比。
 *
 * 2. **冷启动**：从进程 spawn 到 **后端首次响应 `GET /`**。
 *    ★ 该口径两侧完全一致，且不依赖 WebDriver（macOS 无 Tauri WebDriver）。
 *      它衡量的是「壳把后端拉起来并可用」的时间，即用户可交互前的必经路径。
 *
 * 3. **包体**：`.app` 目录的实际字节数，并单列随包 node 的贡献值（Tauri 侧）。
 *
 * 用法：
 *   node scripts/measure-desktop-baseline.mjs --shell <可执行文件路径> --label tauri [--app <.app 路径>]
 *   node scripts/measure-desktop-baseline.mjs --shell <electron 二进制> --label electron --app <.app>
 *   结果以 JSON 写入 --out（默认 stdout）。
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

/** 就绪后再静置多久才采样内存（让懒加载、GC 收敛）。 */
const IDLE_MS = 30_000;
const READY_TIMEOUT_MS = 90_000;

function parseArgs(argv) {
  const a = { shell: undefined, label: undefined, app: undefined, out: undefined, port: 35100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shell") a.shell = argv[++i];
    else if (argv[i] === "--label") a.label = argv[++i];
    else if (argv[i] === "--app") a.app = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--port") a.port = Number(argv[++i]);
  }
  if (!a.shell || !a.label) {
    console.error("用法: --shell <可执行文件> --label <tauri|electron> [--app <.app>] [--out <json>]");
    process.exit(1);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 目录/文件的实际字节数（`du -sk`，与 Finder 的「大小」口径一致）。 */
function sizeBytes(path) {
  if (!existsSync(path)) return null;
  const out = execFileSync("du", ["-sk", path], { encoding: "utf8" });
  return Number(out.trim().split(/\s+/)[0]) * 1024;
}

/** 递归收集 pid 的整棵进程树（含自身）。 */
function processTree(rootPid) {
  const out = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" });
  const children = new Map();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const [pid, ppid] = [Number(m[1]), Number(m[2])];
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const tree = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    tree.push(pid);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  return tree;
}

/**
 * 汇总进程树的 RSS（KB → 字节）。
 *
 * ★ 关键：必须覆盖整棵树。Electron 的渲染进程往往是内存大头，只测主进程会严重低估它。
 */
function treeRssBytes(rootPid) {
  const pids = processTree(rootPid);
  let total = 0;
  const detail = [];
  for (const pid of pids) {
    try {
      const out = execFileSync("ps", ["-o", "rss=,comm=", "-p", String(pid)], { encoding: "utf8" });
      const m = out.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const rss = Number(m[1]) * 1024;
      total += rss;
      detail.push({ pid, rss, comm: basename(m[2]) });
    } catch {
      /* 进程已退出 */
    }
  }
  return { total, count: detail.length, detail };
}

async function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      await sleep(50); // 高频轮询：冷启动测量的精度取决于此
    }
  }
  return false;
}

const mb = (n) => (n === null ? null : Number((n / 1048576).toFixed(1)));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.shell)) {
    console.error(`✗ 可执行文件不存在: ${args.shell}`);
    process.exit(1);
  }

  const result = { label: args.label, shell: args.shell, measuredAt: new Date().toISOString() };

  // ── 包体 ──
  if (args.app) {
    result.bundle = {
      appPath: args.app,
      appBytes: sizeBytes(args.app),
      appMB: mb(sizeBytes(args.app)),
    };
    // Tauri：随包 node 单列（Req 11.4）；Electron：Electron Framework 单列，二者可比。
    const sidecar = `${args.app}/Contents/MacOS/node`;
    const framework = `${args.app}/Contents/Frameworks/Electron Framework.framework`;
    if (existsSync(sidecar)) {
      result.bundle.sidecarNodeMB = mb(sizeBytes(sidecar));
    }
    if (existsSync(framework)) {
      result.bundle.electronFrameworkMB = mb(sizeBytes(framework));
    }
    const dist = existsSync(`${args.app}/Contents/Resources/dist`)
      ? `${args.app}/Contents/Resources/dist`
      : null;
    if (dist) result.bundle.bundledDistMB = mb(sizeBytes(dist));
  }

  // ── 冷启动 + 空闲内存 ──
  console.error(`[baseline] 启动 ${args.label}: ${args.shell}`);
  const t0 = process.hrtime.bigint();
  const proc = spawn(args.shell, [], {
    env: { ...process.env, PI_WEB_DESKTOP_PORT: String(args.port) },
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.stderr.on("data", () => {});

  try {
    const ready = await waitReady(args.port, READY_TIMEOUT_MS);
    if (!ready) {
      console.error("✗ 后端未在超时内就绪，无法测量");
      proc.kill("SIGTERM");
      process.exit(1);
    }
    const t1 = process.hrtime.bigint();
    result.coldStartMs = Number((t1 - t0) / 1_000_000n);
    console.error(`[baseline] 冷启动至后端可用: ${result.coldStartMs} ms`);

    console.error(`[baseline] 空闲 ${IDLE_MS / 1000}s 后采样进程树 RSS…`);
    await sleep(IDLE_MS);
    const rss = treeRssBytes(proc.pid);
    result.idleMemory = {
      totalBytes: rss.total,
      totalMB: mb(rss.total),
      processCount: rss.count,
      processes: rss.detail.map((d) => ({ comm: d.comm, rssMB: mb(d.rss) })),
    };
    console.error(
      `[baseline] 空闲常驻内存: ${result.idleMemory.totalMB} MB（${rss.count} 个进程）`,
    );
  } finally {
    proc.kill("SIGTERM");
    await sleep(3000);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
  }

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    writeFileSync(args.out, json + "\n");
    console.error(`[baseline] 已写入 ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
