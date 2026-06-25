#!/usr/bin/env node
/**
 * --watch 重载 e2e(spec pi-web-cli, Task 5.2 / Req 8.1, 8.2)。可重复,产出新鲜证据。
 *
 * 验证:CLI --watch 启动 → 激活会话(createSession 即 spawn runner 并注册 watcher)→
 * 修改 agent source 入口文件 → runner 因源码变化空闲重启。不依赖 LLM 凭据(只验机制)。
 *
 * 前置:`NEXT_DIST_DIR=.next-cli pnpm build:cli`(须含放开门控后的 hot-reload)。
 * 跑法:`NEXT_DIST_DIR=.next-cli node e2e/cli/cli-watch.mjs`。
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.NEXT_DIST_DIR ?? ".next-cli";
const BIN = join(ROOT, "bin", "pi-web.mjs");
const PORT = 3461;
const BASE = `http://127.0.0.1:${PORT}`;
const AGENT = join(ROOT, "examples", "hello-agent");
const ENTRY = join(AGENT, "index.ts");

const failures = [];
const check = (n, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${n}`);
  if (!ok) failures.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitReady(t) {
  const dl = Date.now() + t;
  return new Promise((res, rej) => {
    const tk = () => {
      const q = httpGet(`${BASE}/`, (r) => {
        r.resume();
        res();
      });
      q.on("error", () => (Date.now() > dl ? rej(new Error("就绪超时")) : setTimeout(tk, 300)));
    };
    tk();
  });
}
const waitFor = async (pred, ms) => {
  const dl = Date.now() + ms;
  while (Date.now() < dl) {
    if (pred()) return true;
    await sleep(300);
  }
  return false;
};

async function main() {
  const original = readFileSync(ENTRY, "utf8");
  let stderr = "";
  const cli = spawn("node", [BIN, AGENT, "--watch", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_DIST_DIR: DIST },
  });
  cli.stdout.on("data", (d) => process.stdout.write(d));
  cli.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  let browser;
  try {
    await waitReady(60_000);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Start session" }).click();
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 15_000 });
    check("会话激活(runner 子进程 spawn)", /\/session\//.test(page.url()));

    const watching = await waitFor(() => /\[runner-hot-reload\] watching/.test(stderr), 12_000);
    check("watcher 监视 agent source 目录(Req 8.1)", watching);

    // 修改 agent 入口触发热重载
    writeFileSync(ENTRY, original + `\n// watch-e2e marker\n`);
    const restarted = await waitFor(() => /restarting \d+ runner/.test(stderr), 12_000);
    check("源码变化触发 runner 重载(Req 8.2)", restarted);
  } catch (err) {
    check(`watch e2e: ${err.message}`, false);
  } finally {
    writeFileSync(ENTRY, original); // 还原被改文件
    if (browser) await browser.close();
    cli.kill("SIGINT");
    await sleep(500);
  }
  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
