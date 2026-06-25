import { test, expect } from "@playwright/test";

/**
 * logs-panel-right-layout 浏览器 e2e:日志面板 `panelPosition="right"` 防回归。
 *
 * 历史 bug:right 把 LogsPanel 渲染进 aside 时,其内 radix Select(level 下拉)ref 反复挂卸
 * → React #185「Maximum update depth」→ 命令面板一开整页崩。修复:level 过滤改原生 <select>
 * + aside flex-col 有界高度。本测试强制 logging 配置为 right(经路由 mock,本地 schema 默认 bottom),
 * 验证:右侧渲染、打开命令面板不崩、原生 select 可切级别(均无 #185)。
 */
test("日志面板 right 位置:右侧渲染 + 命令面板不崩 + 原生 select 可用(#185 回归防护)", async ({
  page,
}) => {
  const fatalErrors: string[] = [];
  page.on("pageerror", (e) => {
    if (/185|Maximum update depth/.test(e.message)) fatalErrors.push(e.message);
  });

  // 强制 logging 输出位置为 right(模拟用户把日志面板配在右侧)。
  await page.route("**/api/config/logging", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const res = await route.fetch();
    const json = (await res.json()) as {
      values?: { outputs?: Record<string, unknown> };
    };
    const patched = {
      ...json,
      values: {
        ...(json.values ?? {}),
        outputs: {
          ...((json.values?.outputs as Record<string, unknown>) ?? {}),
          panelVisible: true,
          panelPosition: "right",
        },
      },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(patched),
    });
  });

  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  // 右侧日志面板渲染:level 过滤(原生 select)可见(不依赖实际日志条目)。
  const levelFilter = page.locator("[data-pi-logs-level-filter]");
  await expect(levelFilter).toBeVisible({ timeout: 10_000 });

  // 打开命令面板(历史崩点)——不崩,命令项正常出现。
  await page.locator("[data-pi-input-textarea]").click();
  await page.locator("[data-pi-input-textarea]").fill("/");
  await expect(page.locator('[data-pi-command-item="help"]')).toBeVisible({
    timeout: 10_000,
  });
  await page.keyboard.press("Escape");

  // 原生 select 切级别不触发 #185。
  await levelFilter.selectOption("warn");
  await expect(levelFilter).toHaveValue("warn");

  // 全程无 React #185。
  expect(fatalErrors).toHaveLength(0);
});
