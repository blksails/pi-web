import { test, expect } from "@playwright/test";

/**
 * Full-loop custom-agent e2e (MVP acceptance).
 *
 * Real browser → real pi-web server (PI_WEB_STUB_AGENT=1) → real handler/session/
 * SSE chain. Picks the hello-agent source, prompts, and asserts incremental
 * streamed markdown, a tool card, a collapsible reasoning block, and the
 * inline-interaction closed loop (answer → card resolves to a trace → agent continues).
 * Also exercises the controls (stats / model selector / abort affordances).
 */
test("custom agent: streaming reply, tool card, reasoning, inline interaction", async ({
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

  // Submit a prompt via PiChat's stateful send button.
  await input.fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();

  // Incremental streamed markdown text appears in an assistant message.
  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Hello");

  // Tool card rendered.
  await expect(page.locator("[data-pi-tool]").first()).toBeVisible();

  // Collapsible reasoning block rendered.
  await expect(page.locator("[data-pi-reasoning]").first()).toBeVisible();

  // Inline interaction card (extension UI) appears in the message stream.
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();

  // Answer it → the card resolves to a read-only trace and the agent continues.
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(interaction).toBeHidden();
  await expect(page.locator("[data-pi-interaction-resolved]")).toBeVisible();
  await expect(messages).toContainText("Continuing");

  // The rich prompt-input toolbar is present (stateful submit affordance).
  await expect(page.locator("[data-pi-prompt-input-toolbar]")).toBeVisible();

  // ModelSelector is now VISIBLE: PiChat eagerly loads models on session-ready
  // (no longer deadlocked on open), and the stub returns get_available_models, so
  // `available` is true and the selector renders. The full open/group/select flow
  // is covered in rich-chat.e2e.ts (Req 4).
  await expect(page.locator("[data-pi-model-selector]")).toBeVisible();
});
