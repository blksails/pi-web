#!/usr/bin/env node
/**
 * CLI 启动链路 e2e 冒烟(spec pi-web-cli, Task 4.1 + 3.2)。可重复运行,产出新鲜证据。
 *
 * 前置:已构建自包含产物 —— `pnpm build:dist`。
 * 跑法:`node e2e/cli/cli-smoke.mjs`(或 `pnpm e2e:cli`)。
 *
 * 覆盖:
 *   - 产物完整性(server.mjs / runner-bootstrap / pi SDK cli.js / jiti)——P0(research §2.3)
 *   - 参数路径:--help/--version 零退出;未知参数非零退出且不启动(Req 5.1-5.3)
 *   - stub 启动 → 浏览器加载 → 默认 source 激活会话 → 发消息 → stub 流式回包(Req 7.2, 1.4, 3.1, 3.3)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.PI_WEB_DIST_DIR ?? "dist";
const BIN = join(ROOT, "bin", "pi-web.mjs");
const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const EVIDENCE = join(ROOT, ".kiro/specs/pi-web-cli/evidence/cli-smoke-repeatable.png");

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res, rej) => {
    const tick = () => {
      const req = httpGet(`${BASE}/`, (r) => {
        r.resume();
        res();
      });
      req.on("error", () =>
        Date.now() > deadline ? rej(new Error("就绪超时")) : setTimeout(tick, 300),
      );
    };
    tick();
  });
}

async function main() {
  // 1) 产物完整性(Task 3.2 / P0)
  // 产物根即 DIST(入口 server.mjs 在其下,不再有 standalone/ 子层)。
  const SA = join(ROOT, DIST);
  // 无符号链接产物:pi SDK / jiti 经 dereference 拷贝 hoist 到顶层 node_modules(见 pack-dist)。
  for (const f of [
    "server.mjs",
    "packages/server/runner-bootstrap.mjs",
    "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    "node_modules/jiti",
  ]) {
    check(`产物存在: ${f}`, existsSync(join(SA, f)));
  }
  if (!existsSync(join(SA, "server.mjs"))) {
    console.error("产物缺失,请先 `pnpm build:dist`");
    process.exit(1);
  }

  // 1b) 随包载荷(spec shared-runtime-payload)。npm 包分发的是它,不再是 dist/ 树。
  // ⚠ 本 e2e 仍走 CLI 解析顺序的第 ② 级(仓库内 dist/ 存在 ⇒ 不解包),
  //   故它**测不到解包路径** —— 那由 e2e/cli/cli-reloc.mjs 覆盖。
  const PAYLOAD = join(ROOT, "payload");
  for (const f of ["dist.tar.zst", "payload.json", "unpack.mjs"]) {
    check(`载荷存在: payload/${f}`, existsSync(join(PAYLOAD, f)));
  }

  // 2) 参数路径(Req 5.1-5.3)
  const help = spawnSync("node", [BIN, "--help"], { encoding: "utf8" });
  check("--help 退出0且含用法", help.status === 0 && /用法:/.test(help.stdout));
  const ver = spawnSync("node", [BIN, "--version"], { encoding: "utf8" });
  check("--version 退出0且含版本号", ver.status === 0 && /\d+\.\d+\.\d+/.test(ver.stdout));
  const bad = spawnSync("node", [BIN, "--bogus"], { encoding: "utf8" });
  check("未知参数 退出非0", bad.status !== 0);

  // 3) stub 启动 + 浏览器冒烟(Req 7.2)
  const cli = spawn("node", [BIN, "./examples/hello-agent", "--stub", "-p", String(PORT)], {
    cwd: ROOT,
    // 强开日志:建会话 500 时 handler 默认不打印根因,开日志才能看到服务端堆栈(诊断跨 OS)。
    env: { ...process.env, PI_WEB_DIST_DIR: DIST, PI_WEB_LOG_ENABLED: "1" },
    stdio: "inherit",
  });
  let browser;
  try {
    await waitReady(60_000);
    check("CLI 启动 standalone 并就绪(Req 3.1, 1.4)", true);
    browser = await chromium.launch();
    const page = await browser.newPage();
    // 失败诊断:收集浏览器控制台与页面异常(跨 OS 排查 autostart 不进会话用)。
    const consoleLogs = [];
    page.on("console", (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => consoleLogs.push(`[pageerror] ${e.message}`));
    page.on("requestfailed", (r) =>
      consoleLogs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText ?? ""}`),
    );
    page.on("response", async (r) => {
      if (r.status() >= 400 && /\/api\//.test(r.url())) {
        const t = await r.text().catch(() => "");
        consoleLogs.push(`[http ${r.status()}] ${r.url()} ${t.slice(0, 300)}`);
      }
    });
    globalThis.__consoleLogs = consoleLogs;
    globalThis.__page = page;
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // CLI 固定注入 PI_WEB_AUTOSTART=1 + 默认 source(bin/pi-web.mjs)→ 前端跳过选源页,
    // 直接用 defaultSource 建会话进入会话界面(见 docs/product/14-cli.md「直接进会话」)。
    // 故此处不点「Start session」选源按钮(autostart 下不存在),直接等待会话输入框出现。
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 20_000 });
    check("默认 agent source 自动激活会话(autostart, Req 3.2)", /\/session\//.test(page.url()));
    await page.fill("[data-pi-input-textarea]", "CLI smoke test");
    await page.getByRole("button", { name: "发送" }).click();
    await page.waitForFunction(
      () => /stub agent/i.test(document.body.innerText),
      { timeout: 15_000 },
    );
    check("收到 stub 流式回包(Req 7.2)", true);
    await page.screenshot({ path: EVIDENCE, fullPage: true });
    console.log(`证据截图: ${EVIDENCE}`);
    } catch (err) {
    check(`浏览器冒烟: ${err.message}`, false);
    // 失败诊断转储:URL + 控制台/页面错误 + body 片段 + 截图(供 CI artifact 上传)。
    try {
      const page = globalThis.__page;
      if (page) {
        console.error(`[diag] url=${page.url()}`);
        const body = await page.evaluate(() => document.body?.innerText?.slice(0, 800) ?? "");
        console.error(`[diag] body=${JSON.stringify(body)}`);
        await page.screenshot({ path: EVIDENCE, fullPage: true }).catch(() => {});
      }
      for (const l of (globalThis.__consoleLogs ?? []).slice(-40)) console.error(`[diag] ${l}`);
    } catch (e) {
      console.error(`[diag] dump 失败: ${e.message}`);
    }
  } finally {
    if (browser) await browser.close();
    cli.kill("SIGINT");
    await sleep(500);
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
