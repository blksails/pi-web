import { test, expect } from "@playwright/test";

/**
 * aigc-tool-settings 浏览器 e2e —— /settings 页「AIGC 图像工具」面板(关模型 + 提示词优化)。
 *
 * 对真实 Next server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行(隔离 NEXT_DIST_DIR=.next-e2e)。
 * 面板为标准 config 域 `aigc`:模型开关清单(自定义 widget,来自 GET /api/aigc/models)+ 提示词
 * 优化布尔开关;保存落 config 域文件 `<agentDir>/aigc.json`(临时 agentDir,不污染用户配置)。
 * 装配期「被禁模型从 LLM 枚举/清单移除」由 tool-kit 集成测试证明,本 e2e 覆盖设置页 UI↔持久往返。
 *
 *  ① 入口:/settings 左导航含「AIGC 图像」→ 进入面板,模型开关清单 + 提示词优化开关可见。
 *  ② 保存持久:关某模型 + 开提示词优化 → 保存 → GET /api/config/aigc 回读一致(落 aigc.json)。
 */

async function openAigcPanel(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();
  const nav = page.locator('[data-pi-settings-nav="aigc"]');
  await expect(nav).toBeVisible();
  await nav.click();
}

/** 重置 aigc 域为空,消除跨用例/跨运行污染。 */
async function resetAigc(page: import("@playwright/test").Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  await page.request.put(`${origin}/api/config/aigc`, {
    data: { values: { disabledModels: [], enablePromptOptimization: false } },
  });
}

test("settings: 左导航含 AIGC 图像面板,模型开关清单 + 提示词优化开关可见", async ({ page }) => {
  await openAigcPanel(page);
  await resetAigc(page);
  await page.reload();
  await page.locator('[data-pi-settings-nav="aigc"]').click();

  // 模型开关清单(来自 /api/aigc/models):gpt-image-2 复选框在
  await expect(page.locator('[data-aigc-model-toggle="gpt-image-2"]')).toBeVisible();
  // 提示词优化布尔开关
  await expect(
    page.locator('[data-pi-field="enablePromptOptimization"] input[type="checkbox"]'),
  ).toBeVisible();
});

test("settings: 关某模型 + 开提示词优化 → 保存 → 落盘 config 域回读一致", async ({ page }) => {
  await openAigcPanel(page);
  await resetAigc(page);
  await page.reload();
  await page.locator('[data-pi-settings-nav="aigc"]').click();

  // 关闭 gpt-image-2(取消勾选 → 禁用)
  const modelBox = page.locator('[data-aigc-model-toggle="gpt-image-2"]');
  await expect(modelBox).toBeChecked();
  await modelBox.uncheck();

  // 开启提示词优化
  const optBox = page.locator(
    '[data-pi-field="enablePromptOptimization"] input[type="checkbox"]',
  );
  await optBox.check();

  // 保存
  const saveBtn = page.getByRole("button", { name: "保存" });
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  await expect(page.getByText("已保存")).toBeVisible();

  // 落盘 config 域回读一致(aigcExtension 装配期即读此文件)
  const origin = new URL(page.url()).origin;
  const res = await page.request.get(`${origin}/api/config/aigc`);
  const body = (await res.json()) as {
    values: { disabledModels?: string[]; enablePromptOptimization?: boolean };
  };
  expect(body.values.disabledModels).toContain("gpt-image-2");
  expect(body.values.enablePromptOptimization).toBe(true);
});
