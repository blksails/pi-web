#!/usr/bin/env node
/**
 * 共享运行时的**并发首启**e2e（spec shared-runtime-payload 任务 7.1，Req 3.2/3.3/3.6）。
 *
 * 真实场景：用户同时启动 CLI 与桌面版，两者的载荷版本与摘要相同 ⇒ 争抢同一个运行时目录。
 *
 * ★ 锁协议只有**真并发**能证伪。单测里 mock 出来的「锁已存在」无法暴露 mkdir 的原子性、
 *   rename 的竞争、以及「取锁与首次检查之间他人已完成」这条窄窗口。
 *
 * 断言：
 *   - N 个进程全部退出码 0
 *   - **恰好一个** unpacked=true（其余复用其结果）
 *   - 最终只有一个运行时目录，且带完整性标记
 *   - 无 .staging-* / .lock-* / .trash-* 残留
 *
 * ★ 刻意把 `--lock-wait-ms` 压到 3s（远小于真实解包耗时 5-7s）。这不是为了跑得快，而是为了
 *   在本地复现 CI 上才暴露的缺陷：`lockWaitMs` 若被当成「解包总耗时的预算」，等待方就会在
 *   持有者**健康地正常解包**时集体 lock-timeout（Windows 上 Defender 扫 9284 个文件，解包
 *   耗时 129s > 120s 默认预算，三个等待方全部失败）。正确语义是「**无推进**的容忍窗口」：
 *   持锁方心跳刷新锁，等待方见到推进即重置期限。压低该值后，缺陷在 macOS 上也必然复现。
 *
 * 前置：`pnpm build:dist`（用真实载荷，覆盖真实解包耗时下的锁竞争）。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAYLOAD_DIR = join(ROOT, "payload");
const UNPACKER = join(PAYLOAD_DIR, "unpack.mjs");
const CONCURRENCY = 4;
const ROUNDS = 3;
/** 见文件头：刻意远小于真实解包耗时，使「无推进窗口」与「总耗时预算」的混淆必然暴露。 */
const LOCK_WAIT_MS = 3_000;

const fails = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) fails.push(name);
};

async function runOnce(runtimeRoot) {
  const { stdout } = await execFileAsync(process.execPath, [
    UNPACKER,
    "--payload-dir",
    PAYLOAD_DIR,
    "--runtime-root",
    runtimeRoot,
    "--lock-wait-ms",
    String(LOCK_WAIT_MS),
    "--json",
  ]);
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

async function round(n) {
  const runtimeRoot = mkdtempSync(join(tmpdir(), `pi-web-conc-${n}-`));
  try {
    const settled = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => runOnce(runtimeRoot)),
    );

    const rejected = settled.filter((s) => s.status === "rejected");
    check(`第 ${n} 轮：${CONCURRENCY} 个并发解包器全部成功`, rejected.length === 0);
    if (rejected.length) {
      for (const r of rejected) console.error("   ", r.reason?.message ?? r.reason);
      return;
    }

    const results = settled.map((s) => s.value);
    const unpackedCount = results.filter((r) => r.ok && r.unpacked).length;
    check(`第 ${n} 轮：恰好一个进程执行了解包（实际 ${unpackedCount}）`, unpackedCount === 1);

    const dirs = new Set(results.map((r) => r.runtimeDir));
    check(`第 ${n} 轮：全部解析到同一个运行时目录`, dirs.size === 1);

    const entries = readdirSync(runtimeRoot);
    const runtimeDirs = entries.filter((e) => !e.startsWith("."));
    check(`第 ${n} 轮：运行时根下只有一个运行时目录`, runtimeDirs.length === 1);
    check(
      `第 ${n} 轮：完整性标记存在`,
      runtimeDirs.length === 1 && existsSync(join(runtimeRoot, runtimeDirs[0], ".ok")),
    );

    const residue = entries.filter(
      (e) => e.startsWith(".staging-") || e.startsWith(".lock-") || e.startsWith(".trash-"),
    );
    check(`第 ${n} 轮：无 staging / lock / trash 残留（实际 ${residue.join(",") || "无"}）`, residue.length === 0);

    // 复用者必须真的拿到可用的入口，而不是一个「成功但指向空目录」的结果。
    const allEntriesExist = results.every((r) => existsSync(r.serverJs));
    check(`第 ${n} 轮：每个进程返回的入口都真实存在`, allEntriesExist);
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(UNPACKER)) {
    console.error(`✗ 缺少解包器：${UNPACKER}\n  请先执行：pnpm build:dist`);
    process.exit(1);
  }
  const mb = (statSync(join(PAYLOAD_DIR, "dist.tar.zst")).size / 1048576).toFixed(1);
  console.log(
    `并发首启：${CONCURRENCY} 进程 × ${ROUNDS} 轮（真实 ${mb}MB 载荷，lock-wait ${LOCK_WAIT_MS}ms ≪ 解包耗时）\n`,
  );
  for (let n = 1; n <= ROUNDS; n++) await round(n);

  console.log(fails.length ? `\nFAIL: ${fails.length} 项` : "\nPASS: 全部通过");
  process.exit(fails.length ? 1 : 0);
}
main();
