/**
 * P0 spike 端到端验证:起 spike server → Chromium 打开 → 读断言结果。
 *
 * 失败判据(任一即 no-go):
 *   - 出现 CSP violation(尤其 script-src 拒绝 eval/inline)
 *   - #status[data-state] !== "ok"
 *   - 页面 console error
 */
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;

const server = spawn("node", ["server.mjs"], {
  cwd: import.meta.dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server 启动超时")), 10_000);
  server.stdout.on("data", (b) => {
    if (b.toString().includes("spike server on")) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
const cspViolations = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
// CSP 违规在 Chromium 里以 console error 形式出现,额外用 CDP 精确捕获。
const cdp = await page.context().newCDPSession(page);
await cdp.send("Log.enable");
cdp.on("Log.entryAdded", ({ entry }) => {
  if (entry.source === "security" || /Content Security Policy/i.test(entry.text)) {
    cspViolations.push(entry.text);
  }
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => document.getElementById("status")?.dataset.state !== "pending",
  { timeout: 10_000 },
).catch(() => {});

const state = await page.getAttribute("#status", "data-state");
const diag = await page.textContent("#diag");
const cardVisible = await page.locator('[data-testid="metric-card"]').count();

console.log("\n──────── P0 spike 结果 ────────");
console.log("status:", state);
console.log("diag:", diag);
console.log("metric-card 节点数:", cardVisible);
console.log("CSP violations:", cspViolations.length ? cspViolations : "(none)");
console.log("console errors:", consoleErrors.length ? consoleErrors : "(none)");

const ok =
  state === "ok" &&
  cardVisible === 1 &&
  cspViolations.length === 0 &&
  consoleErrors.length === 0;
console.log("\nVERDICT:", ok ? "GO ✅" : "NO-GO ❌");

await browser.close();
server.kill("SIGTERM");
process.exit(ok ? 0 : 1);
