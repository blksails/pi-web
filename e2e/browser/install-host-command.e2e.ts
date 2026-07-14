import { test, expect } from "@playwright/test";

/**
 * install-host-command 浏览器 e2e — `/install` host 命令的安装旅程与 component 拒绝
 * (.kiro/specs/install-host-command 任务 5.2)。
 *
 * 对专用第三套 pi-web server 运行(playwright.config.ts project "install"):放行 env
 * (PI_WEB_EXT_ADMIN_ALLOW_ANY/PI_WEB_EXT_ALLOW_LOCAL)+ 隔离落盘(临时 agentDir/
 * sourcesRoot/registry),不触碰真实 ~/.pi-web 或 ~/.pi/agent。
 *
 * 会话源用 `./examples`(通用 CLI 模式,cwd 下多个可作为 install local: 源的子目录),
 * 与已删除的 plugin-subcommand-completion.e2e.ts 同一布置。
 *
 * `/install install <arg>` 的提交机制:命令面板对声明了 argSpec 的命令(install 属于此类)
 * 在有候选时拦截 Enter(命令面板 Req 3.3/4);直接键入完整参数段(如 `local:./examples/hello-agent`)
 * 时,该段作为 stage.query 送 `GET /sessions/:id/install-sources?q=` 查询,候选按
 * `path.includes(q)` 过滤 —— 带 `local:` 前缀的完整参数段不是任何候选 path 的子串,候选
 * 清空后浮层关闭(120ms 防抖后),Enter 才落到 dispatchBuiltin 正常提交(见
 * pi-command-palette.tsx `inArgFlow && argNav.length===0` 分支 + pi-chat.tsx `onSubmit`)。
 *
 * `local:<rel>` 的 `<rel>` 相对**会话 cwd**(与 install-sources 补全端点同基准 ——
 * 整改 230ce05:handler 执行时优先 `ctx.session.cwd`,装配 `deps.cwd` 仅兜底)。
 * 本布置中源 `./examples` 走通用 CLI 模式 ⇒ 会话 cwd = 服务器工作目录(仓库根),
 * 补全端点按同一 cwd 扫描(MAX_DEPTH=2)给出的候选即 `./examples/<dir>` 形态 ——
 * 用例键入的正是补全会给出的值(「选中候选提交即可用」的用户旅程)。
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

/**
 * 键入完整 `/install install local:<rel>` 并等命令面板候选清空(query 不匹配任何本地源)
 * 后再提交,规避面板拦截 Enter(不选中候选)。
 */
async function submitInstallCommand(
  page: import("@playwright/test").Page,
  text: string,
): Promise<void> {
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill(text);
  // 等 120ms 防抖取数结算 + 候选清空(浮层因 arg-flow 无候选而关闭)。
  await expect(page.locator("[data-pi-command-palette]")).toHaveCount(0, {
    timeout: 10000,
  });
  await input.press("Enter");
}

test("install: 安装本地 agent 源成功→data-install-result 卡片→选择器免刷新可见新 source(Req 7.1, 4.3)", async ({
  page,
}) => {
  await startSession(page);

  await submitInstallCommand(
    page,
    "/install install local:./examples/hello-agent",
  );

  const card = page.locator("[data-pi-install-result]");
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toHaveAttribute("data-pi-install-action", "install");
  await expect(card).toHaveAttribute("data-pi-install-ok", "true");
  await expect(card.locator("[data-pi-install-location]")).toBeVisible();

  // 免刷新:effect panel-refresh 已 bump agentSourcesRefreshKey,经 launcherRail 悬浮
  // 对话框(不离开当前会话,不整页刷新)打开 source 选择器即可见新装的 source。
  await page.locator("[data-launcher-new-chat]").click();
  const dialog = page.locator("[data-agent-source-dialog]");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('[data-agent-source-item][data-source*="hello-agent"]'),
  ).toBeVisible({ timeout: 10000 });
});

test("install: component 包被拒绝→失败卡片含 pi-web add 指引(Req 7.2, 2.5/2.6)", async ({
  page,
}) => {
  await startSession(page);

  await submitInstallCommand(
    page,
    "/install install local:./examples/canvas-component-watermark",
  );

  const card = page.locator("[data-pi-install-result]");
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toHaveAttribute("data-pi-install-ok", "false");
  await expect(card.locator("[data-pi-install-error]")).toContainText(
    "pi-web add",
  );
});
