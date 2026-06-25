import { test, expect } from "@playwright/test";

/**
 * builtin-plugin-command 浏览器 e2e:内置斜杠命令层。
 *
 * 验证 harness 内置命令 `/plugin` 与 agent 命令合流到面板、带「内置」徽标(source=builtin),
 * 且选中后执行 harness 逻辑(打开管理面板)——**不填输入框、不发提示给 LLM**。
 * 复用 stub agent 装配(无 LLM)。
 */
test("内置 /plugin:面板出现 + builtin 徽标 + 选中开面板且不发提示", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/plugin");

  // /plugin 出现在命令面板,来源=builtin,带「内置」徽标。
  const item = page.locator('[data-pi-command-item="plugin"]');
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("data-pi-command-source", "builtin");
  await expect(item.locator("[data-pi-command-builtin-badge]")).toBeVisible();

  // 选中内置命令 → 执行 harness 逻辑(开管理面板),不把 "/plugin " 填回输入框。
  await item.click();
  await expect(page.locator('[data-testid="plugin-panel"]')).toBeVisible();
  await expect(input).toHaveValue("");

  // 不应产生含 "/plugin" 的用户消息(分派而非 prompt)。
  await expect(page.getByText("/plugin", { exact: false })).toHaveCount(0);
});
