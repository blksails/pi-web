import { test, expect } from "@playwright/test";

/**
 * Theme toggle browser e2e (pi-chat-customization Req 2.1/2.2/10.2).
 *
 * 主题切换控件(data-pi-theme-toggle)放在会话头部、与"设置"并排,经 @blksails/ui
 * ThemeProvider 切换 <html> 的 `dark` 类。先创建会话进入会话态,再点击切换。
 */
const SOURCE = "./examples/hello-agent";

test("theme toggle switches html.dark class", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const html = page.locator("html");
  const toggle = page.locator("[data-pi-theme-toggle]");
  await expect(toggle).toBeVisible();

  // 初始 light:无 dark 类。
  await expect(html).not.toHaveClass(/\bdark\b/);

  // 点击 → dark。
  await toggle.click();
  await expect(html).toHaveClass(/\bdark\b/);

  // 再点击 → 回到 light。
  await toggle.click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});
