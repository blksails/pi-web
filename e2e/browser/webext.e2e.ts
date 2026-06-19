import { test, expect } from "@playwright/test";

/**
 * agent-web-extension 浏览器 e2e(任务 7.3):
 * 选择携带 `.pi/web` 的示例 agent source → 会话激活 → 该 source 的 UI 扩展(构建期集成,
 * webext-registry)经 <PiChat> 渲染其 Tier1 区域插槽(panelRight / headerCenter)。
 * 复用与 custom-agent / cli-fallback 相同的页面 + API 装配(stub agent,无 LLM)。
 */
test("webext layout: 选 source 后扩展区域插槽在浏览器内渲染", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-layout-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();

  // Tier1:扩展声明的 panelRight 与 headerCenter 内容出现在 chat 内。
  await expect(page.locator("[data-pi-ext-panel-right]")).toBeVisible();
  await expect(page.getByTestId("layout-panel")).toContainText("领域检视面板");
  await expect(page.getByTestId("layout-header")).toContainText("Layout Agent");
});

test("webext background: 选 source 后自定义背景渲染在消息层之下", async ({ page }) => {
  await page.goto("/");
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-background-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  // Tier1 background:扩展极光背景层挂在 data-pi-chat-background 之下。
  const bg = page.locator("[data-pi-chat-background] .pw-webext-background-aurora");
  await expect(bg).toBeAttached();
  await expect(page.locator(".pw-webext-background-blob-a")).toBeAttached();

  // 回归守卫:背景层用 -z-10,其容器必须建立独立 stacking context(isolation:isolate),
  // 否则负 z-index 逃逸到根上下文、被 app-shell 不透明壳底(bg-background)遮挡 →
  // 极光在 DOM 中存在却视觉上不可见(本守卫即针对该已修复 bug)。
  const containerIsolation = await page
    .locator("[data-pi-chat-background]")
    .evaluate((el) => {
      const parent = el.parentElement;
      return parent ? getComputedStyle(parent).isolation : "no-parent";
    });
  expect(containerIsolation).toBe("isolate");
});

test("webext declarative: 纯声明 source 不渲染扩展区域(零 bundle, 回退默认)", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-declarative-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  // 声明式仅 theme/layout,无 slot 组件 → 无扩展面板。
  await expect(page.locator("[data-pi-ext-panel-right]")).toHaveCount(0);
  // 但默认聊天界面仍可用。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
});
