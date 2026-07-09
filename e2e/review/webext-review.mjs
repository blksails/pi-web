/**
 * 检阅 · webext 多源批量验收(docs/webext-检阅-清单.md 的自动化版)。
 *
 * 对每个示例 source 走「最简首次步骤」:选源 → 会话激活 → 采集清单里那几段 evaluate 脚本
 * 的返回值,与清单的期望逐条比对。产出证据表 + 截图,供人工复核。
 *
 * 用法:node e2e/review/webext-review.mjs [baseUrl]
 * 前置:服务已在跑(生产产物或 dev server),真实 runner。
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = join(process.cwd(), ".kiro/specs/vite-spa-migration/evidence");
mkdirSync(SHOTS, { recursive: true });

/** 清单 §1 的验收要点,只取「首屏可见 ✅」那几个 —— 需驱动一轮的留给人工。 */
const SOURCES = [
  {
    name: "webext-layout-agent",
    tier: "Tier1 区域插槽 + 比例切换",
    expect: (r) => r.panelRight && r.footer && r.ratio === "3:7" && r.asideWidth === "70%",
    describe: (r) =>
      `panelRight=${r.panelRight} footer=${r.footer} ratio=${r.ratio} asideWidth=${r.asideWidth}`,
  },
  {
    name: "webext-slots-agent",
    tier: "Tier1 18 保留插槽全集",
    expect: (r) => r.extCount === 15 && r.background,
    describe: (r) => `extCount=${r.extCount}(期望 15) background-fixture=${r.background}`,
  },
  {
    name: "webext-background-agent",
    tier: "Tier1 自定义背景(空态)",
    expect: (r) => r.empty === "true" && r.saturate.includes("0.72") && r.glow === "0",
    describe: (r) => `empty=${r.empty} saturate=${r.saturate} blob=${r.blobOpacity} glow=${r.glow}`,
  },
  {
    name: "webext-declarative-agent",
    tier: "纯声明(theme/layout/empty)",
    expect: (r) => r.extCount === 1 && !r.panelRight && r.primary === "262 83% 58%" && r.wide,
    describe: (r) =>
      `extCount=${r.extCount} panelRight=${r.panelRight} primary="${r.primary}" wide=${r.wide} title="${r.title}"`,
  },
  {
    name: "webext-artifact-agent",
    tier: "Tier4 artifact iframe(门控 ON)",
    expect: (r) => r.artifact,
    describe: (r) => `iframe[data-pi-artifact]=${r.artifact} (base-url 已配 → 期望 true)`,
  },
  {
    name: "webext-contrib-agent",
    tier: "Tier3 ui-rpc 贡献点",
    expect: (r) => r.sessionActive,
    describe: (r) => `sessionActive=${r.sessionActive} extCount=${r.extCount}(贡献点需空闲控制流,人工验)`,
  },
  {
    name: "webext-renderer-agent",
    tier: "自定义工具渲染器",
    expect: (r) => r.sessionActive,
    describe: (r) => `sessionActive=${r.sessionActive}(echo 富卡片需驱动一轮,人工验)`,
  },
];

const PROBE = () => {
  const s = new Set();
  for (const el of document.querySelectorAll("*"))
    for (const a of el.attributes) if (a.name.startsWith("data-pi-ext")) s.add(a.name);
  const aside = document.querySelector("[data-pi-chat-aside]");
  const bgA = document.querySelector(".pw-webext-background-aurora");
  const bgB = document.querySelector(".pw-webext-background-blob-a");
  const bgG = document.querySelector(".pw-webext-background-glow");
  const theme = document.querySelector("[data-pi-ext-theme]");
  return {
    url: location.pathname,
    extCount: s.size,
    sessionActive: !!document.querySelector("[data-session-active]"),
    panelRight: !!document.querySelector("[data-pi-ext-panel-right]"),
    footer: !!document.querySelector("[data-pi-ext-footer]"),
    ratio: document.querySelector("[data-pi-panel-ratio]")?.getAttribute("data-pi-panel-ratio") ?? null,
    asideWidth: aside ? aside.style.width : null,
    background: !!document.querySelector('[data-testid="slot-background"]'),
    artifact: !!document.querySelector("[data-pi-artifact]"),
    empty: document.querySelector("[data-pi-chat-empty]")?.getAttribute("data-pi-chat-empty") ?? null,
    saturate: bgA ? getComputedStyle(bgA).filter : "",
    blobOpacity: bgB ? getComputedStyle(bgB).opacity : "",
    glow: bgG ? getComputedStyle(bgG).opacity : "",
    primary: theme ? getComputedStyle(theme).getPropertyValue("--primary").trim() : "",
    wide: !!document.querySelector("[data-pi-chat-pro] .max-w-5xl"),
    title: document.title,
  };
};

const browser = await chromium.launch();
const rows = [];
const cspViolations = [];

for (const src of SOURCES) {
  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to execute/i.test(t))
      cspViolations.push(`${src.name}: ${t.slice(0, 90)}`);
  });

  let result, error;
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-agent-source-picker]", { timeout: 20_000 });
    await page.fill("[data-agent-source-input]", `./examples/${src.name}`);
    await page.click("[data-agent-source-submit]");
    await page.waitForSelector("[data-session-active]", { timeout: 40_000 });
    await page.waitForTimeout(1200); // 让扩展 applyExtension 落地
    result = await page.evaluate(PROBE);
    await page.screenshot({ path: join(SHOTS, `review-${src.name}.png`), fullPage: false });
  } catch (err) {
    error = err instanceof Error ? err.message.split("\n")[0] : String(err);
  }
  await page.close();

  rows.push({ src, result, error });
}

await browser.close();

console.log("\n════════ 检阅 · webext 多源验收(新宿主) ════════");
console.log(`baseUrl: ${BASE}\n`);
let pass = 0,
  fail = 0;
for (const { src, result, error } of rows) {
  if (error) {
    console.log(`❌ ${src.name}\n   ${src.tier}\n   激活失败: ${error}`);
    fail++;
    continue;
  }
  const ok = src.expect(result);
  console.log(`${ok ? "✅" : "❌"} ${src.name}`);
  console.log(`   ${src.tier}`);
  console.log(`   ${src.describe(result)}`);
  console.log(`   url=${result.url}`);
  ok ? pass++ : fail++;
}

console.log(`\nCSP 违规: ${cspViolations.length ? cspViolations : "(none)"}`);
console.log(`截图: ${SHOTS}`);
console.log(`\n结果: ${pass} 通过 / ${fail} 未达标 (共 ${rows.length})`);
process.exit(fail === 0 ? 0 : 1);
