import { test, expect } from "@playwright/test";

/**
 * new-by-agent-source browser e2e — full closed loop against the real Next
 * server with the deterministic offline stub agent (PI_WEB_STUB_AGENT=1).
 *
 * Covers (requirements.md):
 *  - 1.1/1.2/1.3/1.4 — 顶栏 "New session" 用当前 agent source 同源新建:新 sessionId
 *                      (≠原)、URL→/session/:newId、源不变、可继续对话。
 *  - 2.1/2.2        — 「切换源」退回 AgentSourcePicker。
 *  - 4.2/4.3        — 隔离 build(PI_WEB_DIST_DIR)+ external server。
 */

const SOURCE = "./examples/hello-agent";

async function readSessionId(
  page: import("@playwright/test").Page,
): Promise<string> {
  const text = await page.locator("[data-session-id]").textContent();
  return (text ?? "").replace("session:", "").trim();
}

async function startSession(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  const id = await readSessionId(page);
  expect(id.length).toBeGreaterThan(0);
  return id;
}

test("New session 同源新建:新 sessionId、源不变、可继续对话 (1.1/1.2/1.3/1.4)", async ({
  page,
}) => {
  const firstId = await startSession(page);

  // 同源新建:点 "New session"(不回选择器),会话以新 id 重建。
  await page.locator("[data-new-session]").click();
  // 不退回选择器。
  await expect(page.locator("[data-agent-source-picker]")).toHaveCount(0);
  await expect(page.locator("[data-session-active]")).toBeVisible();

  // session id 变为新 id(≠原)。
  await expect
    .poll(async () => readSessionId(page), { timeout: 15_000 })
    .not.toBe(firstId);
  const secondId = await readSessionId(page);
  expect(secondId.length).toBeGreaterThan(0);

  // URL 同步到新会话。
  await expect(page).toHaveURL(new RegExp(`/session/${secondId}$`));

  // 源不变 + 可继续对话:新会话里发一轮 prompt 得到回复。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  await page.locator("[data-pi-input-textarea]").fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("Hello");
});

test("切换源:退回 agent 源选择器 (2.1/2.2)", async ({ page }) => {
  await startSession(page);
  await page.locator("[data-switch-source]").click();
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await expect(page.locator("[data-session-active]")).toHaveCount(0);
});
