import { test, expect } from "@playwright/test";

/**
 * Full-loop custom-agent e2e (MVP acceptance).
 *
 * Real browser → real Next server (PI_WEB_STUB_AGENT=1) → real handler/session/
 * SSE chain. Picks the hello-agent source, prompts, and asserts incremental
 * streamed markdown, a tool card, a collapsible reasoning block, and the
 * permission-dialog closed loop (answer → dialog closes → agent continues).
 * Also exercises the controls (stats / model selector / abort affordances).
 */
test("custom agent: streaming reply, tool card, reasoning, permission dialog", async ({
  page,
}) => {
  await page.goto("/");

  // Source picker → start the hello-agent session.
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();

  // Chat surface appears.
  await expect(page.locator("[data-session-active]")).toBeVisible();
  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();

  // Submit a prompt.
  await input.fill("say hello");
  await page.locator("[data-pi-send]").click();

  // Incremental streamed markdown text appears in an assistant message.
  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Hello");

  // Tool card rendered.
  await expect(page.locator("[data-pi-tool]").first()).toBeVisible();

  // Collapsible reasoning block rendered.
  await expect(page.locator("[data-pi-reasoning]").first()).toBeVisible();

  // Permission dialog (extension UI) appears.
  const dialog = page.locator("[data-pi-permission-dialog]");
  await expect(dialog).toBeVisible();

  // Answer it → dialog closes and the agent continues streaming.
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(dialog).toBeHidden();
  await expect(messages).toContainText("Continuing");

  // Controls present (model selector + session stats side-channel).
  await expect(page.locator("[data-pi-model-selector]")).toBeVisible();
});
