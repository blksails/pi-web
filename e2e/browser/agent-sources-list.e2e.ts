import { test, expect } from "@playwright/test";

/**
 * Agent Sources List 浏览器 e2e(agent-sources-list)。
 *
 * 覆盖关键用户路径(requirements.md):
 *  - 6.4  前端门控关闭(默认 build 未开 NEXT_PUBLIC_PI_WEB_SOURCE_PICKER)→ 不渲染源列表,
 *         仅手输框;手输仍可正常创建会话(兜底入口)。
 *  - 5.1/5.2  门控开启(专用 build:NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1 + PI_WEB_SOURCES_ROOT)
 *         → 源列表渲染;点击列表项即以其 source 创建会话并进入活动会话。
 *
 * 注:NEXT_PUBLIC_PI_WEB_SOURCE_PICKER 构建期内联,默认 e2e build 关闭;开启路径需以
 * `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1` 重新构建并配 `PI_WEB_SOURCES_ROOT`(external server),
 * 运行时以 `PI_WEB_E2E_SOURCE_PICKER=1` 标记触发本套开启态断言。默认构建下仅验证关闭态。
 */

const MANUAL_SOURCE = "./examples/hello-agent";
const pickerEnabled = process.env.PI_WEB_E2E_SOURCE_PICKER === "1";

test.describe("Agent Sources List", () => {
  test("门控关闭(默认 build):不显示源列表,手输仍可创建会话(Req 6.4)", async ({
    page,
  }) => {
    test.skip(pickerEnabled, "开启态构建下跳过关闭态断言");
    await page.goto("/");
    await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
    // 门控关闭 → 无源列表区。
    await expect(page.locator("[data-agent-source-list]")).toHaveCount(0);
    // 手输兜底仍可用。
    await page.locator("[data-agent-source-input]").fill(MANUAL_SOURCE);
    await page.locator("[data-agent-source-submit]").click();
    await expect(page.locator("[data-session-active]")).toBeVisible();
    await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  });

  test("门控开启:源列表渲染,点击项创建会话(Req 5.1/5.2)", async ({ page }) => {
    test.skip(!pickerEnabled, "需 NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1 专用 build");
    await page.goto("/");
    await expect(page.locator("[data-agent-source-picker]")).toBeVisible();

    // 源列表渲染并含至少一项(PI_WEB_SOURCES_ROOT 指向 examples/,应扫出若干源)。
    const list = page.locator("[data-agent-source-list]");
    await expect(list).toBeVisible();
    const items = page.locator("[data-agent-source-item]");
    await expect(items.first()).toBeVisible();

    // 点击首个源项 → 以其 source 创建会话并进入活动会话。
    await items.first().scrollIntoViewIfNeeded();
    await items.first().click();
    await expect(page.locator("[data-session-active]")).toBeVisible();
    await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  });
});
