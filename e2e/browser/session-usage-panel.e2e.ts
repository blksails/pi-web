import { test, expect } from "@playwright/test";

/**
 * session-usage-panel browser e2e — full closed loop against the real Next
 * server with the deterministic offline stub agent (PI_WEB_STUB_AGENT=1).
 *
 * Covers (requirements.md):
 *  - 1.1 / 2.1 — 富版 PiChat 渲染内核自有用量区(data-pi-session-stats),展示
 *                messages / tool calls / tokens / cost 四项字段。
 *  - 3.1       — 完成一轮会话后用量随 stats 帧刷新(messages 计数增长)。
 *  - 6.2 / 6.3 — 在隔离 build(PI_WEB_DIST_DIR)+ external server 模式下验收。
 *
 * 用量区是内核自有(非 webext slot),挂在主列、与顶部 webext statusBar 物理分离。
 * 该面板的实时刷新来自 SSE control 的 stats 帧(usePiControls.stats)。
 */

const SOURCE = "./examples/hello-agent";

async function startSession(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
}

// 用量条随输入 dock 渲染,仅在会话态出现 → 先发一轮 prompt 进入会话态。
async function enterConversation(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.locator("[data-pi-input-textarea]").fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("Hello");
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(interaction).toBeHidden();
}

test("usage panel: 渲染用量区与四项字段 (1.1/2.1)", async ({ page }) => {
  await startSession(page);
  await enterConversation(page);

  // 内核自有用量区可见(随输入 dock)。
  const region = page.locator("[data-pi-session-stats-region]");
  await expect(region).toBeVisible();
  const panel = page.locator("[data-pi-session-stats]");
  await expect(panel).toBeVisible();

  // 四项字段存在。
  await expect(page.locator('[data-pi-stat="messages"]')).toBeVisible();
  await expect(page.locator('[data-pi-stat="toolCalls"]')).toBeVisible();
  await expect(page.locator('[data-pi-stat="tokens"]')).toBeVisible();
  await expect(page.locator('[data-pi-stat="cost"]')).toBeVisible();
});

test("usage panel: 一轮会话结束触发 stats 重新拉取并反映在面板 (3.1)", async ({
  page,
}) => {
  await startSession(page);

  // 监听「一轮结束后」的 stats 重新拉取(REST GET /stats)。
  // 注:确定性 stub 的 stats 为定值,故验证"刷新路径被触发"而非数值增长。
  const refetch = page.waitForRequest(
    (req) =>
      /\/api\/sessions\/[^/]+\/stats(\?|$)/.test(req.url()) &&
      req.method() === "GET",
    { timeout: 20_000 },
  );

  // 进入会话态:用量条随 dock 出现,且一轮结束触发 stats 重新拉取。
  await enterConversation(page);

  await refetch;

  // 面板反映 stub 用量值(刷新路径生效)。
  const messagesStat = page.locator('[data-pi-stat="messages"]');
  await expect(messagesStat).toBeVisible();
  await expect(messagesStat).toHaveText("2"); // stub get_session_stats totalMessages
  await expect(page.locator('[data-pi-stat="tokens"]')).toHaveText("20");
});
