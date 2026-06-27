import { test, expect } from "@playwright/test";

/**
 * plugin-subcommand-completion 浏览器 e2e — /plugin 子命令/参数分阶段补全。
 *
 * 对真实 Next server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。会话源用 `./examples`
 * (general CLI 模式),其 cwd 下含多个可作为 install local: 源的子目录(各带 index.ts)。
 *
 * 覆盖(.kiro/specs/plugin-subcommand-completion):
 *  - R1 子命令补全:`/plugin ` → install/uninstall/list,fixed 锚定,选中不提交进入下阶段。
 *  - R3 install 本地目录:`/plugin install ` → cwd 子目录候选 local:<dir>,选中填充。
 *  - R2 uninstall:`/plugin uninstall ` 空态收敛不崩(隔离 agentDir 下 pi list 通常为空)。
 */

const SOURCE = "./examples";

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

test("plugin: '/plugin ' 展示子命令并 caret 锚定(R1)", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/plugin ");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  // 子命令阶段标记。
  await expect(palette).toHaveAttribute("data-pi-command-stage", "subcommand");
  // 与 @/`/` 一致:fixed 锚定。
  await expect(palette).toHaveCSS("position", "fixed");
  // 三个子命令候选。
  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="uninstall"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="list"]')).toBeVisible();
});

test("plugin: 选中 install(非终态)填 '/plugin install ' 不发送,进入参数阶段(R1.3)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/plugin ");
  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();

  await page.locator('[data-pi-command-item="install"]').click();
  await expect(input).toHaveValue("/plugin install ");
  // 未发送:会话仍空(无用户消息气泡)。
  await expect(page.locator("[data-pi-message-user]")).toHaveCount(0);
});

test("plugin: '/plugin install ' 补全 cwd 本地目录 local:<dir>(R3)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  // 用 query 过滤到 hello-agent(确定性,避开 30 候选上限与 readdir 顺序)。
  await input.fill("/plugin install hello");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute("data-pi-command-stage", "arg");
  // hello-agent 是 examples 下的可装目录(含 index.ts)。
  const item = page.locator('[data-pi-command-item="./hello-agent"]');
  await expect(item).toBeVisible();

  await item.click();
  await expect(input).toHaveValue("/plugin install local:./hello-agent ");
});

test("plugin: '/plugin uninstall ' 空态收敛不崩(R2.4)", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/plugin uninstall ");
  // 隔离 agentDir 下通常无已装扩展 → 浮层关闭(无候选);输入框仍可用、页面不崩。
  await expect(page.locator("[data-pi-command-palette]")).toHaveCount(0);
  await expect(input).toHaveValue("/plugin uninstall ");
});
