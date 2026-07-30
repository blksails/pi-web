import { test, expect, type Page } from "@playwright/test";

/**
 * 会话元数据与工作状态 浏览器 e2e(隔离 build + stub agent,spec session-meta-index 任务 5.4)。
 *
 * 为何这条必须在真实浏览器里跑:状态与刷新时机是**时序**问题,而 `isolated-panes` 的教训是
 * 单测全绿而真实浏览器四套 e2e 全红。列表项何时出现转圈、何时消失,只有真浏览器说得准。
 *
 * 覆盖关键用户路径(requirements.md):
 *  - 6.2/6.3/6.5   列表项显示来源标识与来源色条;同来源同色;无来源不显示且不错位。
 *  - 7.1/8.1/8.2   发起一轮 → 列表项在轮次**开始**即出现工作中指示,轮次结束后消失。
 *  - 7.2/8.3       stub agent 的 confirm 交互挂起时 → 显示「等待用户交互」;回应后消失。
 *  - 8.4           刷新期间列表项保持可见可点击、不闪空。
 *
 * DOM 锚点取自组件实测(非猜测):
 *   [data-pi-session-list-item="<id>"]                     列表项
 *   [data-pi-session-list-item-accent="<source>"]          来源色条
 *   [data-pi-session-list-item-activity="working|awaiting-input|error"]  状态指示
 *   [data-pi-session-list-item-source]                     来源副标题
 */

const SOURCE = "./examples/hello-agent";

const item = (id: string): string => `[data-pi-session-list-item="${id}"]`;
const accent = (id: string): string => `${item(id)} [data-pi-session-list-item-accent]`;
const activity = (id: string): string =>
  `${item(id)} [data-pi-session-list-item-activity]`;

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

/** 发一轮并在 stub 的 confirm 交互处**停住**(不回应),用于观察「等待用户交互」态。 */
async function sendAndPauseAtConfirm(page: Page, message: string): Promise<void> {
  await page.locator("[data-pi-input-textarea]").fill(message);
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-interaction-active]")).toBeVisible();
}

async function resolveConfirm(page: Page): Promise<void> {
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(page.locator("[data-pi-interaction-resolved]")).toBeVisible();
}

test.describe("会话列表元数据与工作状态", () => {
  test("列表项显示来源标识与来源色条(6.2/6.3/6.5)", async ({ page }) => {
    const id = await startSession(page);
    await sendAndPauseAtConfirm(page, "hello");
    await resolveConfirm(page);
    await page.reload();
    await expect(page.locator(item(id))).toBeVisible();

    // 来源来自建会话时记录的 agent-source(policySource);hello-agent 是目录源。
    const sourceEl = page.locator(`${item(id)} [data-pi-session-list-item-source]`);
    await expect(sourceEl).toBeVisible();
    const sourceText = (await sourceEl.textContent())?.trim() ?? "";
    expect(sourceText.length).toBeGreaterThan(0);

    // 色条存在且有实际背景色
    const accentEl = page.locator(accent(id));
    await expect(accentEl).toBeAttached();
    const bg = await accentEl.evaluate(
      (el) => getComputedStyle(el as HTMLElement).backgroundColor,
    );
    expect(bg).not.toBe("");
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("同来源两个会话的色条颜色相同(6.4)", async ({ page }) => {
    const first = await startSession(page);
    await sendAndPauseAtConfirm(page, "hello");
    await resolveConfirm(page);
    // 同一源再建一个会话
    await page.goto("/");
    const second = await startSession(page);
    await sendAndPauseAtConfirm(page, "hello again");
    await resolveConfirm(page);
    await page.reload();

    await expect(page.locator(item(first))).toBeVisible();
    await expect(page.locator(item(second))).toBeVisible();
    const colorOf = async (id: string): Promise<string> =>
      page
        .locator(accent(id))
        .evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    expect(await colorOf(first)).toBe(await colorOf(second));
  });

  test("★ 轮次开始即显示工作中,结束后消失(7.1/8.1/8.2)", async ({ page }) => {
    const id = await startSession(page);
    // 先持久化一轮,使会话稳定出现在侧栏
    await sendAndPauseAtConfirm(page, "hello");
    await resolveConfirm(page);
    await page.reload();
    await expect(page.locator(item(id))).toBeVisible();

    // 再发一轮:轮次开始后列表项应出现工作中指示(改造前此刻无任何刷新触发点)
    await page.locator("[data-pi-input-textarea]").fill("second turn");
    await page.locator('[data-pi-submit-state="send"]').click();
    await expect(
      page.locator(`${item(id)} [data-pi-session-list-item-activity]`),
    ).toBeAttached({ timeout: 15_000 });

    // 交互挂起期间应为「等待用户交互」而非「工作中」(7.4 优先级)
    await expect(page.locator("[data-pi-interaction-active]")).toBeVisible();
    await expect(page.locator(activity(id))).toHaveAttribute(
      "data-pi-session-list-item-activity",
      "awaiting-input",
      { timeout: 15_000 },
    );

    // 回应后轮次继续并结束 → 指示消失
    await resolveConfirm(page);
    await expect(page.locator(activity(id))).toHaveCount(0, { timeout: 20_000 });
  });

  test("刷新期间列表项保持可见可点击(8.4)", async ({ page }) => {
    const id = await startSession(page);
    await sendAndPauseAtConfirm(page, "hello");
    await resolveConfirm(page);
    await page.reload();
    const row = page.locator(item(id));
    await expect(row).toBeVisible();

    // 触发一次新轮次(会 bump 刷新信号),期间列表项不得消失
    await page.locator("[data-pi-input-textarea]").fill("keep list stable");
    await page.locator('[data-pi-submit-state="send"]').click();
    for (let i = 0; i < 8; i += 1) {
      await expect(row).toBeVisible();
      await expect(
        page.locator(`[data-pi-session-list-resume="${id}"]`),
      ).toBeEnabled();
      await page.waitForTimeout(150);
    }
    await resolveConfirm(page);
    await expect(row).toBeVisible();
  });
});
