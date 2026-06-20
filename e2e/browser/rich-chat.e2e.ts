import { test, expect } from "@playwright/test";

/**
 * Rich-chat (PiChat) browser e2e — full closed loop against the real Next
 * server with the deterministic offline stub agent (PI_WEB_STUB_AGENT=1).
 *
 * Covers (requirements.md):
 *  - Req 11.3 — app renders <PiChat> as the default chat surface and completes
 *               one basic conversation (input → send → streamed reply).
 *  - Req 3.2  — image attachment becomes a chip and is sent with the prompt
 *               (images/ImageContent base64) — exercised via the hidden file input.
 *  - Req 4 (incl. 4.1/4.2/4.3/4.5) — model data comes from get_available_models
 *               grouped by provider; searching filters; selecting a model switches
 *               the session model via setModel. PiChat eagerly loads models on
 *               session-ready, so the selector RENDERS and is driven through the
 *               real UI (trigger → panel → provider groups → search → select), with
 *               the REST boundary (GET /models, POST /model) corroborating the data.
 *  - Req 10.2 — clicking a suggestion bubble (from get_commands) fills the input.
 *  - Req 8.4  — fork / get_fork_messages unavailable in the stub → branch controls
 *               are hidden and the conversation stays linear (degraded, not blocked).
 *
 * The stub pauses each turn awaiting the extension-UI (permission) answer, so we
 * answer the dialog to let the assistant finish streaming.
 */

const SOURCE = "./examples/hello-agent";

async function startSession(page: import("@playwright/test").Page): Promise<string> {
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

test("rich chat: basic conversation streams a reply (Req 11.3)", async ({
  page,
}) => {
  await startSession(page);

  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();

  // Streamed markdown text from the stub appears in an assistant message.
  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Hello");

  // The stub pauses the turn awaiting the interaction answer → finish the loop.
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(interaction).toBeHidden();
  await expect(page.locator("[data-pi-interaction-resolved]")).toBeVisible();
  await expect(messages).toContainText("Continuing");
});

test("rich chat: model selector renders, groups by provider, searches, and selects (Req 4.1/4.2/4.3/4.5)", async ({
  page,
  request,
}) => {
  const sessionId = await startSession(page);

  // Req 4.1/4.5 — models come solely from get_available_models, grouped by provider.
  // Corroborate the data at the REST boundary first.
  const modelsRes = await request.get(`/api/sessions/${sessionId}/models`);
  expect(modelsRes.status()).toBe(200);
  const { models } = (await modelsRes.json()) as {
    models: ReadonlyArray<{ id: string; provider: string; name: string }>;
  };
  expect(models.length).toBeGreaterThanOrEqual(2);
  const providers = new Set(models.map((m) => m.provider));
  // Deterministic stub spans >= 2 providers so the selector can group.
  expect(providers.size).toBeGreaterThanOrEqual(2);
  expect(providers.has("anthropic")).toBe(true);
  expect(providers.has("openai")).toBe(true);

  // Req 4.4 (no longer degraded) — PiChat eagerly loads models on session-ready,
  // so `available` is true and the selector RENDERS in the default chat surface.
  const selector = page.locator("[data-pi-model-selector]");
  await expect(selector).toBeVisible();

  // Req 4.1 — open the selector; the panel appears.
  await page.locator("[data-pi-model-trigger]").click();
  const panel = page.locator("[data-pi-model-panel]");
  await expect(panel).toBeVisible();

  // Req 4.1 — models are grouped by provider; both stub providers are shown.
  const groups = panel.locator("[data-pi-model-group]");
  await expect(groups.filter({ hasText: "anthropic" })).toBeVisible();
  await expect(groups.filter({ hasText: "openai" })).toBeVisible();
  // All three stub models render as options.
  await expect(panel.locator('[role="option"]')).toHaveCount(models.length);

  // Req 4.2 — typing in the search box filters the list. "gpt" matches only the
  // openai stub model (stub-gpt); the anthropic group disappears.
  await page.locator("[data-pi-model-search]").fill("gpt");
  await expect(panel.locator('[role="option"]')).toHaveCount(1);
  await expect(panel.locator('[role="option"]').first()).toContainText("GPT");
  await expect(groups.filter({ hasText: "anthropic" })).toHaveCount(0);

  // Req 4.3 — selecting the model invokes setModel (POST /model) and closes the
  // panel; the trigger reflects the newly-selected model.
  const setModelReq = page.waitForRequest(
    (req) =>
      req.url().includes(`/api/sessions/${sessionId}/model`) &&
      req.method() === "POST",
  );
  await page.locator('[role="option"]').first().click();
  const req = await setModelReq;
  // The selected model is sent to setModel via the REST boundary.
  expect(req.postDataJSON()).toMatchObject({ modelId: "stub-gpt" });
  // Panel closes after selection (Req 4.3).
  await expect(panel).toBeHidden();
  // The trigger now shows the selected model label.
  await expect(page.locator("[data-pi-model-trigger]")).toContainText("GPT");
});

test("rich chat: suggestion bubble from get_commands fills the input (Req 10.2)", async ({
  page,
}) => {
  await startSession(page);

  // Req 10.1 — get_commands populates suggestion bubbles once the session is ready.
  const suggestions = page.locator("[data-pi-suggestions]");
  await expect(suggestions).toBeVisible();
  const bubble = suggestions.locator("button").first();
  await expect(bubble).toBeVisible();
  const label = (await bubble.textContent())?.trim() ?? "";
  expect(label.startsWith("/")).toBe(true);

  // Req 10.2 — command suggestions use mode "fill": clicking fills the input.
  await bubble.click();
  await expect(page.locator("[data-pi-input-textarea]")).toHaveValue(
    new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("rich chat: image attachment becomes a chip and is sent with the prompt (Req 3.2)", async ({
  page,
}) => {
  await startSession(page);

  // A tiny valid 1x1 PNG (transparent).
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
  const pngBuffer = Buffer.from(pngBase64, "base64");

  // Inject the image via the hidden file input on the attachments dropzone.
  await page.locator("[data-pi-attachments-input]").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });

  // Req 3.1/3.3 — the attachment shows as a chip with a remove button.
  const chip = page.locator("[data-pi-attachment-chip]").first();
  await expect(chip).toBeVisible();
  await expect(page.locator("[data-pi-attachment-remove]").first()).toBeVisible();

  // Req 12.1 — the chip shows a readable media-type label.
  await expect(chip.locator("[data-pi-attachment-type]")).toHaveText("图片");

  // Req 12.2 — hovering the thumbnail opens an enlarged preview; leaving closes it.
  await expect(page.locator("[data-pi-attachment-preview]")).toHaveCount(0);
  await chip.locator("[data-pi-attachment-thumb]").first().hover();
  await expect(page.locator("[data-pi-attachment-preview]")).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-pi-attachment-preview]")).toHaveCount(0);

  // Req 3.2 — submitting sends the prompt with the image. The stub streams its
  // reply (the image rides body.images → prompt.images); we observe the reply.
  await page.locator("[data-pi-input-textarea]").fill("describe this image");
  await page.locator('[data-pi-submit-state="send"]').click();

  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Hello");

  // After send the pending attachment list is cleared (Req 3.2 send semantics).
  await expect(page.locator("[data-pi-attachment-chip]")).toHaveCount(0);

  // Finish the paused turn.
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(interaction).toBeHidden();
});

test("rich chat: fork unavailable → branch controls hidden, conversation stays linear (Req 8.4)", async ({
  page,
}) => {
  await startSession(page);

  // Drive a turn so a message exists in the conversation.
  await page.locator("[data-pi-input-textarea]").fill("hello");
  await page.locator('[data-pi-submit-state="send"]').click();
  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Hello");
  await page.locator("[data-pi-confirm-ok]").click();

  // Req 8.4 — the stub does not support fork/get_fork_messages, so branch
  // switching controls (prev/next + "N / M") are not rendered and the
  // conversation degrades to linear without blocking.
  await expect(page.locator("[data-pi-branch]")).toHaveCount(0);
  await expect(page.locator("[data-pi-branch-prev]")).toHaveCount(0);
  await expect(page.locator("[data-pi-branch-next]")).toHaveCount(0);
  // The conversation is still present and usable.
  await expect(messages).toBeVisible();
});
