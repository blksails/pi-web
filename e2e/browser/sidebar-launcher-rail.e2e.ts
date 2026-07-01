import { test, expect } from "@playwright/test";

/**
 * Sidebar Launcher Rail 浏览器 e2e(sidebar-launcher-rail)。
 *
 * 覆盖关键用户路径(requirements.md),开启态构建:
 *   NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1 + NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1 + PI_WEB_SOURCES_ROOT。
 *  - 1.1/2.2  会话中侧栏出现启动导航区;点新建聊天→回到源选择器。
 *  - 4.1/4.3/4.4  在 picker 收藏一个源→进入会话→导航区出现该锚点→点击锚点→会话激活。
 *  - 3.1  搜索入口点击→展开搜索输入。
 *
 * 门控关闭态由组件/单测覆盖(此构建恒开)。运行经 PI_WEB_E2E_LAUNCHER_RAIL=1 触发。
 */

const railEnabled = process.env.PI_WEB_E2E_LAUNCHER_RAIL === "1";

async function pickFirstSource(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await expect(page.locator("[data-agent-source-item]").first()).toBeVisible();
  await page.locator("[data-agent-source-item]").first().scrollIntoViewIfNeeded();
  await page.locator("[data-agent-source-item]").first().click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

test.describe("Sidebar Launcher Rail", () => {
  test.skip(!railEnabled, "需 NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1 专用 build");

  test("会话中侧栏出现导航区;新建聊天→弹出悬浮对话框→关闭(Req 1.1/2.2)", async ({
    page,
  }) => {
    await pickFirstSource(page);
    await expect(page.locator("[data-launcher-rail]")).toBeVisible();
    await expect(page.locator("[data-launcher-new-chat]")).toBeVisible();
    // 新建聊天 → 会话内悬浮源选择器对话框(不离开对话)。
    await page.locator("[data-launcher-new-chat]").click();
    await expect(page.locator("[data-agent-source-dialog]")).toBeVisible();
    // 会话仍在(对话框悬浮其上)。
    await expect(page.locator("[data-session-active]")).toBeVisible();
    // 关闭对话框(Radix 内置关闭 X,aria-label="Close")→ 回到会话。
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("[data-agent-source-dialog]")).toHaveCount(0);
    await expect(page.locator("[data-session-active]")).toBeVisible();
  });

  test("会话内经悬浮对话框选源→新建会话(Req 2.3)", async ({ page }) => {
    await pickFirstSource(page);
    await page.locator("[data-launcher-new-chat]").click();
    const dialog = page.locator("[data-agent-source-dialog]");
    await expect(dialog).toBeVisible();
    // 从对话框的源列表点一个源 → 新建会话(仍激活)。
    const item = dialog.locator("[data-agent-source-item]").first();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await expect(page.locator("[data-agent-source-dialog]")).toHaveCount(0);
    await expect(page.locator("[data-session-active]")).toBeVisible();
  });

  test("搜索入口点击展开搜索输入(Req 3.1)", async ({ page }) => {
    await pickFirstSource(page);
    await page.locator("[data-launcher-search]").click();
    await expect(page.locator("[data-launcher-search-input]")).toBeVisible();
  });

  test("在 picker 收藏一个源→导航区出现锚点→点击锚点→会话激活(Req 4.1/4.3/4.4)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
    const firstItem = page.locator("[data-agent-source-item]").first();
    await expect(firstItem).toBeVisible();
    const source = await firstItem.getAttribute("data-source");
    expect(source).toBeTruthy();

    // 确保该源处于「已收藏」态(对初始态无关:未收藏则点亮;避免复用存储的残留干扰)。
    const toggle = page.locator(`[data-agent-source-favorite-toggle][data-source="${source}"]`);
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute("data-favorited")) !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("data-favorited", "true");

    // 用该源开会话。
    await firstItem.scrollIntoViewIfNeeded();
    await firstItem.click();
    await expect(page.locator("[data-session-active]")).toBeVisible();

    // 导航区出现收藏锚点。
    const anchor = page.locator(`[data-launcher-favorite][data-source="${source}"]`);
    await expect(anchor).toBeVisible();

    // 点击锚点 → 以该源新建会话(仍激活)。
    await anchor.click();
    await expect(page.locator("[data-session-active]")).toBeVisible();
  });
});
