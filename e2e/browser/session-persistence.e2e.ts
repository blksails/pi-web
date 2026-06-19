import { test, expect } from "@playwright/test";

/**
 * Session persistence + URL cold-resume browser e2e.
 *
 * Runs on BOTH the `fs` and `sqlite` projects (see playwright.config.ts), so the
 * persist → URL → cold-resume → continue loop is verified on each backend with
 * the deterministic offline stub agent (PI_WEB_STUB_AGENT=1).
 *
 * Flow (requirements.md):
 *  - 2.1  new session reflects /session/:id in the URL
 *  - 1.x  one full turn persists (user + assistant) to the configured backend
 *  - 3.1  after deleting the in-memory session, opening /session/:id cold-resumes
 *  - 4.1  the resumed history (user "hello" + assistant reply) renders
 *  - 3.3  sending again continues the conversation with history intact
 *
 * The on-disk artifact assertion (Req 5.1/5.2) is covered by the node-e2e suite
 * (which reads the SessionEntryStore directly); a successful cold-resume here is
 * itself proof the conversation was persisted (otherwise there is nothing to load).
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
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);
  return id;
}

/** Send a prompt and answer the stub's permission dialog to finish the turn. */
async function sendAndFinishTurn(
  page: import("@playwright/test").Page,
  message: string,
): Promise<void> {
  await page.locator("[data-pi-input-textarea]").fill(message);
  await page.locator('[data-pi-submit-state="send"]').click();
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(
    page.locator("[data-pi-interaction-resolved]"),
  ).toBeVisible();
}

test("persist → URL → cold-resume → continue", async ({ page }) => {
  const id = await startSession(page);

  // Req 2.1 — new session reflects /session/:id in the URL.
  await expect(page).toHaveURL(new RegExp(`/session/${id}$`));

  // One full turn (the stub pauses awaiting the permission answer).
  await sendAndFinishTurn(page, "hello");
  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Continuing");

  // Delete the in-memory session to force the cold-resume path.
  const del = await page.request.delete(`/api/sessions/${id}`);
  expect(del.ok()).toBeTruthy();

  // Req 3.1 / 4.1 — reopening the URL cold-resumes and renders history.
  await page.goto(`/session/${id}`);
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(messages).toContainText("hello"); // user history
  await expect(messages).toContainText("Continuing"); // assistant history

  // Req 3.3 / 4.3 — continue the conversation; history stays intact.
  await sendAndFinishTurn(page, "again");
  await expect(messages).toContainText("again");
  await expect(messages).toContainText("hello");
});
