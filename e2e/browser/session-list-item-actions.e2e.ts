import { test, expect, type Page } from "@playwright/test";

/**
 * 会话项管理 浏览器 e2e(隔离 build + stub agent，session-list-item-actions)。
 *
 * 覆盖关键用户路径(requirements.md):
 *  - 3.1/3.2/3.3  重命名:⋯ 菜单→重命名→内联输入提交→即时显示新名，刷新后仍为新名。
 *  - 4.1/4.3      收藏:⋯ 菜单→收藏→进入顶部「收藏」分区置顶。
 *  - 2.1/2.2/2.3  删除:⋯ 菜单→删除→二次确认→会话从侧栏消失，刷新后不再出现。
 *  - 2.5          删除当前会话→导航至新会话空态(源选择器)。
 *
 * 写操作默认启用(NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE 未设=开)，故默认 e2e build 即含写入口。
 */

const SOURCE = "./examples/hello-agent";

async function startSession(page: Page): Promise<string> {
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

async function sendAndFinishTurn(page: Page, message: string): Promise<void> {
  await page.locator("[data-pi-input-textarea]").fill(message);
  await page.locator('[data-pi-submit-state="send"]').click();
  // stub agent 仅首轮触发 confirm 交互;持久化一轮即足以让会话进盘。
  await expect(page.locator("[data-pi-interaction-active]")).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(page.locator("[data-pi-interaction-resolved]")).toBeVisible();
}

/**
 * 建会话 + 持久化一轮 + reload,使该会话稳定出现在侧栏(冷路径,规避 header 异步落盘竞态)。
 * 返回其 sessionId。reload 后仍为当前活跃会话。
 */
async function startPersistedSession(page: Page): Promise<string> {
  const id = await startSession(page);
  await sendAndFinishTurn(page, "hello");
  await page.reload();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(
    page.locator(`[data-pi-session-list-resume="${id}"]`),
  ).toBeVisible();
  return id;
}

/** 打开某会话项的 ⋯ 操作菜单。 */
async function openItemMenu(page: Page, id: string): Promise<void> {
  const row = page.locator(`[data-pi-session-list-item="${id}"]`);
  await row.hover();
  await page.locator(`[data-pi-session-item-menu="${id}"]`).click();
}

test("rename a listed session; new name persists across reload", async ({
  page,
}) => {
  const id = await startPersistedSession(page);

  const resume = page.locator(`[data-pi-session-list-resume="${id}"]`);
  await expect(resume).toBeVisible();

  await openItemMenu(page, id);
  await page.locator(`[data-pi-session-item-rename="${id}"]`).click();
  const input = page.locator(`[data-pi-session-item-rename-input="${id}"]`);
  await expect(input).toBeVisible();
  await input.fill("Renamed In E2E");
  await input.press("Enter");

  // 即时显示新名(乐观 + 刷新),刷新页面后仍为新名(持久化)。
  await expect(resume).toHaveText("Renamed In E2E");
  await page.reload();
  await expect(
    page.locator(`[data-pi-session-list-resume="${id}"]`),
  ).toHaveText("Renamed In E2E");
});

test("favorite a session pins it to the top favorites section", async ({
  page,
}) => {
  const id = await startPersistedSession(page);

  await openItemMenu(page, id);
  await page.locator(`[data-pi-session-item-favorite="${id}"]`).click();

  // 进入顶部收藏分区。
  await expect(
    page.locator(
      `[data-pi-session-list-favorites] [data-pi-session-list-resume="${id}"]`,
    ),
  ).toBeVisible();
});

test("delete a session via confirm removes it from the sidebar", async ({
  page,
}) => {
  // 建会话 A 并持久化;再建会话 B 作为当前会话,使侧栏(同 cwd)同时列出 A、B。
  const idA = await startSession(page);
  await sendAndFinishTurn(page, "hello");
  const idB = await startSession(page);
  await sendAndFinishTurn(page, "hi");
  await page.reload();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const rowA = page.locator(`[data-pi-session-list-resume="${idA}"]`);
  await expect(rowA).toBeVisible();

  // 删除非当前会话 A:⋯→删除→二次确认。
  await openItemMenu(page, idA);
  await page.locator(`[data-pi-session-item-delete="${idA}"]`).click();
  await page
    .locator(`[data-pi-session-item-delete-confirm-btn="${idA}"]`)
    .click();

  // A 从侧栏消失;当前会话 B 仍在。
  await expect(rowA).toHaveCount(0);
  await expect(
    page.locator(`[data-pi-session-list-resume="${idB}"]`),
  ).toBeVisible();

  // 刷新后 A 不再出现(物理删除)。
  await page.reload();
  await expect(
    page.locator(`[data-pi-session-list-resume="${idA}"]`),
  ).toHaveCount(0);
});

test("deleting the current session navigates to a fresh new-session state", async ({
  page,
}) => {
  const id = await startPersistedSession(page);

  await openItemMenu(page, id);
  await page.locator(`[data-pi-session-item-delete="${id}"]`).click();
  await page.locator(`[data-pi-session-item-delete-confirm-btn="${id}"]`).click();

  // 删当前会话 → 导航至新会话空态(源选择器)。
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
});
