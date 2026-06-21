import { test, expect } from "@playwright/test";

/**
 * completion-provider-framework 浏览器 e2e。
 *
 * 对真实 Next server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。验证 core 触发符
 * 补全:在会话输入框键入 `@` → 弹出按 kind 分区的文件候选浮层 → 选中后输入框被插入
 * `@file:<相对路径>` token。会话 cwd = 选中的 agent 源目录(hello-agent 含 index.ts)。
 */
async function selectSource(
  page: import("@playwright/test").Page,
  source: string,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

test("completion: 键入 @ 弹出文件候选并插入 @file: token", async ({ page }) => {
  await selectSource(page, "./examples/hello-agent");

  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();

  // 键入 @ + 查询;core 补全浮层经通用端点拉取 cwd 文件候选。
  await input.click();
  await input.fill("@index");

  const popover = page.locator("[data-pi-completion-popover]");
  await expect(popover).toBeVisible();

  // 分区渲染:file 分组在场。
  await expect(popover.locator('[data-pi-completion-group="file"]')).toBeVisible();

  // 命中 index.ts 候选(hello-agent cwd 根文件),且标注 kind=file。
  const item = popover.locator('[data-pi-completion-item="index.ts"]');
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("data-kind", "file");

  // 选中 → 输入框插入带类型回环 token。
  await item.click();
  await expect(input).toHaveValue(/@file:index\.ts\s/);
  await expect(popover).toBeHidden();
});

test("completion: 纯文本输入不弹补全浮层(收敛)", async ({ page }) => {
  await selectSource(page, "./examples/hello-agent");
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("just plain text");
  await expect(page.locator("[data-pi-completion-popover]")).toHaveCount(0);
});
