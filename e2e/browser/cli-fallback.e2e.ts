import { test, expect } from "@playwright/test";

/**
 * CLI-fallback e2e: a no-index directory resolves to general CLI mode and still
 * streams a reply in the browser, reusing the same page + API assembly as the
 * custom-agent path (Req 9 / 10.6).
 */
test("cli fallback: no-index dir streams a reply", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page
    .locator("[data-agent-source-input]")
    .fill("./e2e/fixtures/cli-project");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();

  await input.fill("hello cli");
  // PiChat's stateful send button (data-pi-submit-state="send"), replacing
  // the legacy <PiChat> data-pi-send affordance.
  await page.locator('[data-pi-submit-state="send"]').click();

  await expect(page.locator("[data-pi-chat-messages]")).toContainText("Hello");
});
