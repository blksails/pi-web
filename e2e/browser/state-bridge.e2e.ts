import { test, expect } from "@playwright/test";

/**
 * 状态注入桥(state-injection-bridge)浏览器级 e2e —— 双向闭环的「人侧」真实渲染。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。
 * state-bridge-agent 的 `.pi/web` 以**独立 pane**(iframe)渲染共享状态 `count` + 写回按钮
 * (spec panes-only-right-panel 任务 3.1 迁移;迁移前是 panelRight 槽):
 *  - 下行(agent→UI):prompt(含 `state-bridge`)→ stub 发 piweb_state(count=1)→
 *    SSE control:"state" 帧 → ControlStore.states → 面板显示 1。
 *  - 写回(UI→agent):点 +1 → useExtensionState/WebExtStateAccess → POST /state →
 *    stub 回 piweb_state(count=2)→ 面板显示 2。
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

test("状态注入桥:工具写→面板更新;点击→写回→面板再更新(双向闭环)", async ({ page }) => {
  await selectSource(page, "./examples/state-bridge-agent");

  // 「人侧」面板已挂载,初始无值(—)。
  // ★ 迁 pane 后面板在 iframe 内,故经 frameLocator 定位 —— **断言本身一条未改**。
  const frame = page.frameLocator("[data-panes-host] iframe");
  const panel = frame.getByTestId("state-bridge-panel");
  await expect(panel).toBeVisible();
  const count = frame.getByTestId("state-bridge-count");
  await expect(count).toHaveText("—");

  // 下行:prompt 含 `state-bridge` → stub 模拟工具写 count=1 → 面板实时更新为 1。
  await page.locator("[data-pi-input-textarea]").fill("run state-bridge demo");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(count).toHaveText("1");

  // 写回:点 +1 → POST /state(value=2)→ stub 回 piweb_state(2)→ 面板更新为 2。
  await frame.getByTestId("state-bridge-increment").click();
  await expect(count).toHaveText("2");

  // 再点一次,验证持续写回闭环(3)。
  await frame.getByTestId("state-bridge-increment").click();
  await expect(count).toHaveText("3");
});
