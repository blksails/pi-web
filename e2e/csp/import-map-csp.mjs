/**
 * 生产 CSP 下的 import map 放行验证(spec vite-spa-migration 任务 11.4,Req 7.5/4.1)。
 *
 * 为什么需要单独一个检查:现有浏览器 e2e 里的 webext 全部经**构建期注册表**
 * (`lib/app/webext-registry.ts` 静态 import)直接打进宿主 bundle,**不经 import map**。
 * 只有「运行时安装」的代码 webext 才走 import map,而那条路径的 e2e 夹具在仓库里未接线。
 * 故 import map 是否被 CSP 拦截,现有套件**测不到**。
 *
 * 本检查直接盯住浏览器:
 *   - 收集 CSP 违规(Chromium 以 console error 报告 "Refused to execute inline script")
 *   - 断言 import map 已被应用(`document.querySelector` + 解析结果)
 *
 * 用法:
 *   node e2e/csp/import-map-csp.mjs <baseUrl>        期望:无违规
 *   PI_WEB_CSP_EXPECT_VIOLATION=1 node ... <baseUrl>  期望:有违规(反证)
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const EXPECT_VIOLATION = process.env.PI_WEB_CSP_EXPECT_VIOLATION === "1";

const browser = await chromium.launch();
const page = await browser.newPage();

const cspErrors = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to execute/i.test(t)) cspErrors.push(t);
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const importMapPresent = await page.evaluate(
  () => document.querySelector('script[type="importmap"]') !== null,
);

/**
 * import map 被**应用**的证据:解析一个裸 specifier。
 * `import.meta.resolve` 在页面上下文不可用,故退而求其次 —— 若 import map 未生效,
 * 动态 import 裸名会抛 "Failed to resolve module specifier";生效则抛网络/其它错误。
 */
const resolveOutcome = await page.evaluate(async () => {
  try {
    await import("react");
    return "imported";
  } catch (err) {
    return String(err && err.message ? err.message : err);
  }
});
const specifierResolved = !/Failed to resolve module specifier/i.test(resolveOutcome);

console.log("──────── import map × 生产 CSP ────────");
console.log("baseUrl:", BASE);
console.log("importmap 标签存在:", importMapPresent);
console.log("裸 specifier 'react' 可解析:", specifierResolved, `(${resolveOutcome.slice(0, 80)})`);
console.log("CSP 违规:", cspErrors.length ? cspErrors : "(none)");

await browser.close();

const ok = EXPECT_VIOLATION
  ? cspErrors.length > 0 || !specifierResolved
  : cspErrors.length === 0 && importMapPresent && specifierResolved;

console.log(
  `\nVERDICT: ${ok ? "PASS" : "FAIL"} (期望${EXPECT_VIOLATION ? "有" : "无"}违规)`,
);
process.exit(ok ? 0 : 1);
