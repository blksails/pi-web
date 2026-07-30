import { test, expect } from "@playwright/test";

/**
 * agent-web-extension 浏览器 e2e(任务 7.3):
 * 选择携带 `.pi/web` 的示例 agent source → 会话激活 → 该 source 的 UI 扩展(构建期集成,
 * webext-registry)经 <PiChat> 渲染其 Tier1 区域插槽(sidebarLeft / headerCenter)。
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

  // Tier1:扩展声明的 sidebarLeft 与 headerCenter 内容出现在 chat 内。
  // ★ 原为 panelRight;该槽随 spec panes-only-right-panel 废弃,夹具改挂 sidebarLeft。
  // 守的仍是「声明即渲染」这同一件事 —— 容器断言 + 内容断言两条都在,保护面未缩。
  await expect(page.locator("[data-pi-ext-sidebar-left]")).toBeVisible();
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
  // 声明式仅 theme/layout,无 slot 组件 → 扩展不贡献任何面板内容。
  //
  // ★ 2026-07-30(spec host-builtin-panes):本断言原为面板容器 count 0。R1.1 正当推翻了它 ——
  // 宿主内置 pane 使面板在任何 agent 下都出现,包括零 bundle 的纯声明式扩展。故判据改为
  // 「面板里只有内置 pane,没有扩展槽渲染物」,原意(零 bundle 不产生扩展 UI)完整保留。
  await expect(page.locator("[data-panes-host]")).toHaveCount(1);
  await expect(page.locator("[data-panes-host] iframe")).toHaveCount(1);
  await expect(page.locator('iframe[title="会话信息"]')).toHaveCount(1);
  // 但默认聊天界面仍可用。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
});
