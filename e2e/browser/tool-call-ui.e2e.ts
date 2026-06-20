import { test, expect } from "@playwright/test";

/**
 * 工具调用 UI 重构(tool-call-ui-redesign)浏览器验收。
 *
 * 真实浏览器 → 真实 Next server(PI_WEB_STUB_AGENT=1)→ 真实 handler/session/SSE 链。
 * stub agent 每轮发一个 `echo` 工具(tool_execution_start → _end,即完成态)。
 *
 * 覆盖本次重构的新行为:
 *  - 完成态(end)默认展开 + 状态徽章 Completed(Req 2.3 / 3.1)
 *  - 头部折叠触发器:点击在展开/折叠间切换明细可见性(Req 3.4)
 *  - webext 自定义工具渲染器经注册表覆盖默认工具卡(Req 5.2 / 6.2 / 6.3)
 */

async function startSession(
  page: import("@playwright/test").Page,
  source: string,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();
  await input.fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();
}

test("工具卡:完成态默认展开 + 状态徽章 + 折叠/展开交互", async ({ page }) => {
  await startSession(page, "./examples/hello-agent");

  const card = page.locator("[data-pi-tool]").first();
  await expect(card).toBeVisible();

  // 走到完成态:phase=end,Completed 徽章。
  await expect(card).toHaveAttribute("data-pi-tool-phase", "end");
  await expect(card.locator("[data-pi-tool-status]")).toContainText("Completed");

  // 完成态默认展开:明细区挂载可见。
  await expect(card.locator("[data-pi-tool-detail]")).toHaveCount(1);

  // 头部折叠触发器:点击 → 明细卸载(折叠)。
  const toggle = card.getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator("[data-pi-tool-detail]")).toHaveCount(0);

  // 再次点击 → 重新展开。
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("[data-pi-tool-detail]")).toHaveCount(1);
});

test("工具卡:webext 自定义渲染器经注册表覆盖默认工具卡", async ({ page }) => {
  await startSession(page, "./examples/webext-renderer-agent");

  // echo 工具由扩展声明的自定义渲染器渲染(registry 命中)。
  await expect(page.getByTestId("echo-tool-card").first()).toBeVisible();

  // 默认工具卡未对 echo 渲染 —— 注册表渲染器覆盖了默认 PiToolPart。
  await expect(page.locator("[data-pi-tool]")).toHaveCount(0);
});
