import { test, expect } from "@playwright/test";

/**
 * Tier5 声明式 documentTitle 浏览器 e2e:
 * agent source 载入后宿主把浏览器标签页标题(document.title)同步为
 *   1) 扩展显式声明的 config.documentTitle(slots-agent → "Slots Agent · pi-web"),
 *   2) 未声明时回落到 source 派生名(layout-agent → "webext-layout-agent"),
 * 并在回选源页(SessionView 卸载)时还原为载入前的宿主默认标题("pi-web")。
 * 复用与其它 webext spec 相同的页面 + stub agent 装配(无 LLM)。
 */

test("documentTitle 显式声明:slots source 载入后标签页标题取 config.documentTitle", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  // 基线:选源页继承 layout.tsx 的静态 metadata 标题。
  await expect(page).toHaveTitle("pi-web");

  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-slots-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page).toHaveTitle("Slots Agent · pi-web");
});

test("documentTitle 默认回落:未声明的 source 载入后标题取 source 派生名", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-layout-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  // layout-agent 的 config 未声明 documentTitle → 回落到末段路径名。
  await expect(page).toHaveTitle("webext-layout-agent");
});

test("documentTitle 还原:回选源页后标签页标题复位为宿主默认", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-slots-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page).toHaveTitle("Slots Agent · pi-web");

  // "New session" → onReset:SessionView 卸载,effect cleanup 还原载入前标题。
  await page.getByRole("button", { name: "New session" }).click();
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await expect(page).toHaveTitle("pi-web");
});
