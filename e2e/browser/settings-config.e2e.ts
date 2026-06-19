import { test, expect } from "@playwright/test";

/**
 * 设置页配置中心 browser e2e(config-ui-sandbox-extensions Req 5/6/7/8.4)。
 *
 * 验证「沙箱」「扩展」各为**一个**左侧菜单项,进入后以「全局/项目」Tab 切换;
 * 切 Tab 加载对应面板;并在「沙箱·全局」保存(回写同值,幂等)验证表单保存链路。
 *
 * 持久化往返由 node e2e(`e2e/node/config-domains.e2e.test.ts`,临时目录)覆盖;
 * 本测试聚焦 UI/Tab 行为,避免写用户级配置。
 */
test("settings: 沙箱/扩展 合并为一个菜单项 + 全局/项目 Tab 切换", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

  // 左侧导航:沙箱、扩展 各一个菜单项(非「沙箱(全局)」「沙箱(项目)」两个)。
  const sandboxNav = page.locator('[data-pi-settings-nav="sandbox"]');
  const extNav = page.locator('[data-pi-settings-nav="extensions"]');
  await expect(sandboxNav).toBeVisible();
  await expect(sandboxNav).toHaveText("沙箱");
  await expect(extNav).toBeVisible();
  await expect(extNav).toHaveText("扩展");
  await expect(page.getByRole("button", { name: "沙箱(全局)" })).toHaveCount(0);

  // 进入「沙箱」→ Tab 切换器含 全局/项目。
  await sandboxNav.click();
  const globalTab = page.locator('[data-pi-settings-tab="sandbox"]');
  const projectTab = page.locator('[data-pi-settings-tab="sandbox-project"]');
  await expect(globalTab).toHaveText("全局");
  await expect(projectTab).toHaveText("项目");
  await expect(globalTab).toHaveAttribute("aria-selected", "true");

  // 切到「项目」→ 项目面板渲染。
  await projectTab.click();
  await expect(projectTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-pi-settings-panel="sandbox-project"]')).toBeVisible();

  // 进入「扩展」→ 全局/项目 Tab + 固定区(Slash 命令)+ KV 区(扩展参数)。
  await extNav.click();
  await expect(page.locator('[data-pi-settings-tab="extensions"]')).toHaveText("全局");
  await expect(page.locator('[data-pi-settings-tab="extensions-project"]')).toHaveText("项目");
  await expect(page.getByText("允许的命令")).toBeVisible();
  await expect(page.getByText("扩展参数")).toBeVisible();
});

test("settings: 沙箱项目表单可保存(写所服务项目的 .pi/sandbox.json)", async ({ page }) => {
  // 在「项目」Tab 保存,避免改写用户级全局配置;持久化往返由 node e2e 以临时目录验证。
  await page.goto("/settings");
  await page.locator('[data-pi-settings-nav="sandbox"]').click();
  await page.locator('[data-pi-settings-tab="sandbox-project"]').click();
  await expect(page.locator('[data-pi-settings-panel="sandbox-project"]')).toBeVisible();

  // 勾选「启用沙箱」使表单 dirty(项目覆盖 enabled=true,语义无害)。
  const enableToggle = page.locator('[data-pi-field="enabled"] input[type="checkbox"]');
  await expect(enableToggle).toBeVisible();
  await enableToggle.check();
  const saveBtn = page.getByRole("button", { name: "保存" });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.getByText("已保存")).toBeVisible();
});
