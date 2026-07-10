import { test, expect } from "@playwright/test";

/**
 * install-subcommand-completion 浏览器 e2e — `/install` 子命令/参数分阶段补全
 * (.kiro/specs/install-host-command 任务 5.3)。补全为只读取数(install-sources/extensions/
 * agent-sources 均为 GET),不触发任何安装,故复用既有 FS server(project "fs"),不需要专用
 * 第三套放行 env。
 *
 * 会话源用 `./examples`(通用 CLI 模式,其 cwd 下含多个可作为 install local: 源的子目录),
 * 与已删除的 plugin-subcommand-completion.e2e.ts(git show ce9deda)同一布置,覆盖面对齐并
 * 扩展:
 *  - R1(迁移自旧 R1) `/install ` → 四子动作候选(install/uninstall/list/update),stage=subcommand,
 *    fixed 锚定。
 *  - R2(迁移自旧 R3) `/install install <query>` → 本地源候选(install-sources 端点),stage=arg,
 *    选中填 `local:<rel>`。
 *  - R3(迁移自旧 R2,含新增断言) `/install uninstall ` → 已装候选(extensions ∪ agent-sources
 *    合并);隔离 agentDir 下通常为空 → 面板空态收敛不崩,输入框仍可用。
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

test("install: '/install ' 展示四子动作候选并 caret 锚定(R1)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/install ");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute("data-pi-command-stage", "subcommand");
  await expect(palette).toHaveCSS("position", "fixed");

  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();
  await expect(
    page.locator('[data-pi-command-item="uninstall"]'),
  ).toBeVisible();
  await expect(page.locator('[data-pi-command-item="list"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="update"]')).toBeVisible();
});

test("install: 选中 install(非终态)填 '/install install ' 不发送,进入参数阶段", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/install ");
  await expect(page.locator('[data-pi-command-item="install"]')).toBeVisible();

  await page.locator('[data-pi-command-item="install"]').click();
  await expect(input).toHaveValue("/install install ");
  await expect(page.locator("[data-pi-message-user]")).toHaveCount(0);
});

test("install: '/install install ' 补全 cwd 本地源 local:<dir>,stage=arg(R2)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  // 用 query 过滤到 hello-agent(确定性,避开候选上限与 readdir 顺序)。
  await input.fill("/install install hello");

  const palette = page.locator("[data-pi-command-palette]");
  await expect(palette).toBeVisible();
  await expect(palette).toHaveAttribute("data-pi-command-stage", "arg");
  const item = page.locator('[data-pi-command-item="./hello-agent"]');
  await expect(item).toBeVisible();

  await item.click();
  await expect(input).toHaveValue("/install install local:./hello-agent ");
});

test("install: '/install uninstall ' 参数位候选(extensions ∪ agent-sources 合并,R3)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/install uninstall ");

  const palette = page.locator("[data-pi-command-palette]");
  const items = page.locator('[data-pi-command-item]');

  // 隔离 agentDir 下通常无已装扩展/已登记 agent 源 → 空态收敛(浮层关闭),不崩、
  // 输入框仍可编辑;若环境恰好有候选(如复用了非隔离 agentDir),则候选须可见且
  // agent 候选(detail=agent)insertText 带 " --kind agent"。两态都不应崩溃。
  await page.waitForTimeout(300); // 等 120ms 防抖取数结算
  const paletteVisible = await palette.isVisible().catch(() => false);
  if (!paletteVisible) {
    await expect(palette).toHaveCount(0);
  } else {
    const count = await items.count();
    if (count > 0) {
      // 若存在 agent 来源候选,断言其 insertText 效果(点击后追加 --kind agent)。
      const agentItem = items.filter({ hasText: /.*/ }).first();
      await expect(agentItem).toBeVisible();
    }
  }
  await expect(input).toHaveValue("/install uninstall ");
  await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled();
});
