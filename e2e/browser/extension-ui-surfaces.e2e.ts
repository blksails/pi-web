import { test, expect } from "@playwright/test";

/**
 * Extension-UI ambient surfaces browser e2e — full closed loop against the real
 * pi-web server with the deterministic offline stub agent (PI_WEB_STUB_AGENT=1).
 *
 * Covers (requirements.md):
 *  - Req 1.1 — notify → a notification toast appears in [data-pi-notifications].
 *  - Req 2.1 — setStatus → a status item appears in [data-pi-status-bar].
 *  - Req 3.1 — setWidget → a widget line appears in [data-pi-widgets] (aboveEditor).
 *  - Req 4.1 — setTitle → the extension header title [data-pi-extension-title].
 *  - Req 5.1 — set_editor_text → the input textarea is written with the text.
 *  - Req 6.2 — the push surfaces NEVER block the interactive confirm dialog: the
 *              same turn also emits a confirm frame, the permission dialog stays
 *              visible and answerable, and the conversation continues.
 *
 * Sentinel gating: these push frames are emitted by the stub ONLY when the prompt
 * text contains the `ext-ui` sentinel (lib/app/stub-agent-process.mjs), so the
 * other e2e specs are unaffected.
 *
 * Timing note: notification toasts auto-dismiss (~5s). We therefore assert the
 * toast FIRST, immediately after send, before any other (slower) assertion runs.
 */

const SOURCE = "./examples/hello-agent";

async function startSession(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  const text = await page.locator("[data-session-id]").textContent();
  const sessionId = (text ?? "").replace("session: ", "").trim();
  expect(sessionId.length).toBeGreaterThan(0);
  return sessionId;
}

test("extension-ui: sentinel prompt pushes ambient surfaces without blocking the confirm dialog (Req 1.1/2.1/3.1/4.1/5.1/6.2)", async ({
  page,
}) => {
  await startSession(page);

  // Send a sentinel prompt (`ext-ui`) so the stub emits the five push frames
  // before the confirm frame.
  await page.locator("[data-pi-input-textarea]").fill("trigger ext-ui surfaces");
  await page.locator('[data-pi-submit-state="send"]').click();

  // Req 1.1 — assert the toast FIRST (it auto-dismisses ~5s).
  await expect(
    page.locator("[data-pi-notifications]"),
  ).toContainText("Build complete");

  // Req 2.1 — status item.
  await expect(page.locator("[data-pi-status-bar]")).toContainText(
    "main-branch",
  );

  // Req 3.1 — widget line (aboveEditor placement).
  await expect(page.locator("[data-pi-widgets]")).toContainText(
    "Widget line alpha",
  );

  // Req 4.1 — extension header title.
  await expect(page.locator("[data-pi-extension-title]")).toContainText(
    "Stub Extension Title",
  );

  // Req 5.1 — set_editor_text overwrites the (now empty, post-send) input.
  await expect(page.locator("[data-pi-input-textarea]")).toHaveValue(
    "prefilled-by-extension",
  );

  // Req 6.2 — the interactive confirm card is NOT blocked by the pushes: it
  // remains visible and answerable, and the conversation continues afterwards.
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(interaction).toBeHidden();
  await expect(page.locator("[data-pi-interaction-resolved]")).toBeVisible();
  await expect(page.locator("[data-pi-chat-messages]")).toContainText(
    "Continuing",
  );
});
