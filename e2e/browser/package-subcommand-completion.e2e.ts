import { test, expect } from "@playwright/test";

/**
 * agent-plugin-commands 浏览器 e2e — `/agent` 与 `/plugin` 的子命令/参数分阶段补全
 * (.kiro/specs/agent-plugin-commands 任务 4.2;迁自 install-subcommand-completion.e2e)。
 * 补全为只读取数(install-sources/extensions/agent-sources 均为 GET),不触发任何安装,
 * 故复用既有 FS server(project "fs"),不需要专用放行 env。
 *
 * 会话源用 `./examples`(通用 CLI 模式,其 cwd 下含多个可作为 `local:` 源的子目录)。
 * 覆盖:
 *  - R1 `/agent ` → 三子动作候选(install/uninstall/list),各带中文说明,stage=subcommand。
 *  - R2 `/plugin ` → 四子动作候选(多出 update),两条命令候选互不混入。
 *  - R3 `/agent install <query>` → 本地源候选,选中填 `local:<rel>`。
 *  - R4 `/agent uninstall ` → 已装 agent 候选(隔离环境下通常为空 → 空态收敛不崩)。
 *  - R5 命令名阶段不再出现已摘除的 `/install`。
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

test("agent: '/agent ' 展示三子动作候选并带中文说明(R1)", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/agent ");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute("data-pi-command-stage", "subcommand");
  await expect(palette).toHaveCSS("position", "fixed");

  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="uninstall"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="list"]')).toBeVisible();
  // agent 侧没有 update 通道。
  await expect(page.locator('[data-pi-command-item="update"]')).toHaveCount(0);
  // 说明取自 i18n 字典(默认 locale=zh),不再是 `<argKind>` 占位符。
  await expect(palette).toContainText("安装 agent 源");
});

test("plugin: '/plugin ' 展示四子动作候选(含 update)(R2)", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/plugin ");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="uninstall"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="list"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="update"]')).toBeVisible();
  await expect(palette).toContainText("plugin");
});

test("agent: 选中 install(非终态)只填入不发送,进入参数阶段", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/agent ");
  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();

  await page.locator('[data-pi-command-item="install"]').click();
  await expect(input).toHaveValue("/agent install ");
  await expect(page.locator("[data-pi-message-user]")).toHaveCount(0);
});

test("agent: '/agent install <query>' 补全 cwd 本地源 local:<dir>,stage=arg(R3)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  // 用 query 过滤到 hello-agent(确定性,避开候选上限与 readdir 顺序)。
  await input.fill("/agent install hello");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute("data-pi-command-stage", "arg");
  const item = page.locator('[data-pi-command-item="./hello-agent"]');
  await expect(item).toBeVisible();

  await item.click();
  await expect(input).toHaveValue("/agent install local:./hello-agent ");
});

test("agent: '/agent uninstall ' 参数位只取 agent 源候选,空态收敛不崩(R4)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/agent uninstall ");

  const palette = page.locator("[data-pi-command-palette]");
  const items = page.locator("[data-pi-command-item]");

  // 隔离 agentDir 下通常无已登记 agent 源 → 空态收敛(浮层关闭),不崩、输入框仍可编辑;
  // 若环境恰好有候选,则候选可见且插入文本不含类别参数(命令名已锁定通道)。
  await page.waitForTimeout(300); // 等 120ms 防抖取数结算
  const paletteVisible = await palette.isVisible().catch(() => false);
  if (!paletteVisible) {
    await expect(palette).toHaveCount(0);
  } else if ((await items.count()) > 0) {
    await items.first().click();
    await expect(input).not.toHaveValue(/--kind/);
  }
  await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled();
});

test("摘除回归:命令名阶段不再出现 /install(R5)", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/inst");

  await page.waitForTimeout(300);
  // 拆分后没有名为 install 的命令词条;/agent、/plugin 才是入口。
  await expect(page.locator('[data-pi-command-item="install"]')).toHaveCount(0);
});
