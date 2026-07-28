import { test, expect } from "@playwright/test";

/**
 * 扩展设置的结构化表单 browser e2e(spec: extension-settings-schema-ui,任务 5.2;
 * Req 1.1 / 3.1 / 7.1)。
 *
 * 5.1 的 node e2e 已在**端点层**验证「装包 → 结构化 schema 抵达 / 未装 → 无」;本用例是其
 * **可视化补充**:确认那份 schema 真的驱动出了可交互的结构化表单(含动态键 map 条目控件),
 * 而不是回退成裸 JSON 文本框。
 *
 * 夹具由 `playwright.config.ts` 在隔离 agentDir 内种入(见其 extension-settings-schema-ui 段):
 * settings.json 的 `packages[]` + 包自带 `pi.settings` + schema 文件 + 已有一条 record 条目。
 *
 * 断言一律用仓库真实的 `data-pi-*` 属性(`data-pi-settings-nav` / `data-pi-config-file` /
 * `data-pi-record-entry` / `data-pi-field`),不猜 testid。
 */

const FAKE_EXT_ID = "pi-e2e-schema-ext";

test("扩展设置:已装包的自带 schema 渲染出结构化表单(含动态键 map 条目)", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

  // 进入「扩展」菜单项。
  const extNav = page.locator('[data-pi-settings-nav="extensions"]');
  await expect(extNav).toBeVisible();
  await extNav.click();

  // 该扩展的独立配置文件被渲染为一张卡片(configFiles 控件),而非裸 JSON 文本域。
  const fileCard = page.locator(`[data-pi-config-file="${FAKE_EXT_ID}.json"]`);
  await expect(fileCard).toBeVisible();

  // 结构化字段:schema 的 `apiBase` 应成为一个具名字段(有 schema 才会有 data-pi-field)。
  // 变异判据:若 schema 未抵达前端(回退裸 JSON),卡片内不会出现任何 data-pi-field → 转红。
  await expect(fileCard.locator("[data-pi-field]").first()).toBeVisible();

  // 动态键 map:record 型属性 `headers` 的已有条目渲染为条目控件。
  await expect(fileCard.locator('[data-pi-record-entry="X-E2E"]')).toBeVisible();
});

test("扩展设置:未安装的扩展不产生配置表单", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();
  await page.locator('[data-pi-settings-nav="extensions"]').click();

  // 只有 packages[] 内的扩展才被 install 门控放行;未装扩展不应出现任何卡片。
  // 变异判据:若门控失效(对未装扩展也解析 schema),此断言转红。
  await expect(page.locator('[data-pi-config-file="pi-not-installed-ext.json"]')).toHaveCount(0);
});
