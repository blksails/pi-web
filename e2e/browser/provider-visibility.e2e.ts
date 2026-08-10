import { test, expect } from "@playwright/test";

/**
 * provider-visibility-config 浏览器 e2e —— /settings 页 Provider 面板的展示可见性
 * (任务 4.2;Req 2.1, 2.2, 5.1, 5.2, 6.2)。
 *
 * 对真实 pi-web server + 离线 stub agent 运行。面板是标准 config 域 `providers`:
 * 顶部清单由自定义 widget(`providerVisibility`)渲染,数据取自唯一部署级目录端点
 * `GET /api/config/models`(按 output 两次取数);配置落 `<agentDir>/providers.json`
 * 的 `visibility` 字段。
 *
 * 过滤本体的行为由 core 的单测与出口集成测试覆盖,本 e2e 只证闭环:
 *  ① 入口:/settings 左导航进 Provider 面板 → 清单与开关可见;
 *  ② 隐藏一个 provider 并保存 → 配置域回读含该 provider 的 hidden;
 *     且部署级目录端点(选择器的取数来源)不再列出它;
 *  ③ 改回可见并保存 → 目录端点恢复列出。
 */

type Page = import("@playwright/test").Page;

interface CatalogBody {
  readonly providers?: readonly string[];
  readonly models?: ReadonlyArray<{ readonly provider: string; readonly id: string }>;
}

async function openProvidersPanel(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();
  const nav = page.locator('[data-pi-settings-nav="providers"]');
  await expect(nav).toBeVisible();
  await nav.click();
}

/** 重置 visibility 为空,消除跨用例污染(既有自定义 provider 条目原样保留)。 */
async function resetVisibility(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.get(`${origin}/api/config/providers`);
  const body = (await res.json()) as { values?: Record<string, unknown> };
  await page.request.put(`${origin}/api/config/providers`, {
    data: { values: { ...(body.values ?? {}), visibility: {} } },
  });
}

/** 部署级目录(各处模型选择器的取数来源)按输出类型取一次。 */
async function readCatalog(page: Page, output: "text" | "image"): Promise<CatalogBody> {
  const origin = new URL(page.url()).origin;
  const res = await page.request.get(`${origin}/api/config/models?output=${output}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as CatalogBody;
}

/** 取清单里第一个 provider 的标识(部署环境不同,provider 名不能写死)。 */
async function firstProviderInPanel(page: Page): Promise<string> {
  const row = page.locator("[data-pi-provider-row]").first();
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-pi-provider-row");
  expect(id, "清单里应至少有一个 provider").toBeTruthy();
  return id as string;
}

test("settings: Provider 面板渲染全部 provider 清单与可见性开关", async ({ page }) => {
  await openProvidersPanel(page);
  await resetVisibility(page);
  await page.reload();
  await page.locator('[data-pi-settings-nav="providers"]').click();

  await expect(page.locator("[data-pi-provider-visibility]")).toBeVisible();
  const provider = await firstProviderInPanel(page);
  await expect(page.locator(`[data-pi-provider-toggle="${provider}"]`)).toBeVisible();
  // Req 3.1:界面须明示这只影响展示。
  await expect(page.getByText(/已有会话与工具照常可用/)).toBeVisible();
});

test("settings: 隐藏 provider → 保存 → 目录端点不再列出;改回可见后恢复", async ({ page }) => {
  await openProvidersPanel(page);
  await resetVisibility(page);
  await page.reload();
  await page.locator('[data-pi-settings-nav="providers"]').click();

  const provider = await firstProviderInPanel(page);

  // 基线:该 provider 此刻在目录里(两类输出至少命中一类)。
  const beforeText = await readCatalog(page, "text");
  const beforeImage = await readCatalog(page, "image");
  const presentBefore =
    (beforeText.providers ?? []).includes(provider) ||
    (beforeImage.providers ?? []).includes(provider);
  expect(presentBefore, "基线:被测 provider 应先出现在目录中").toBe(true);

  // 隐藏它(控件用 confirm 拦一道,e2e 里一律接受)。
  page.on("dialog", (d) => void d.accept());
  await page.locator(`[data-pi-provider-toggle="${provider}"]`).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存")).toBeVisible();

  // 配置域回读:落盘含该 provider 的 hidden。
  const origin = new URL(page.url()).origin;
  const saved = (await (await page.request.get(`${origin}/api/config/providers`)).json()) as {
    values?: { visibility?: Record<string, { hidden?: boolean }> };
  };
  expect(saved.values?.visibility?.[provider]?.hidden).toBe(true);

  // 目录端点(选择器取数来源)不再列出它。
  const afterText = await readCatalog(page, "text");
  const afterImage = await readCatalog(page, "image");
  expect((afterText.providers ?? []).includes(provider)).toBe(false);
  expect((afterImage.providers ?? []).includes(provider)).toBe(false);

  // 改回可见 → 恢复出现。
  await page.reload();
  await page.locator('[data-pi-settings-nav="providers"]').click();
  await page.locator(`[data-pi-provider-toggle="${provider}"]`).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存")).toBeVisible();

  const restoredText = await readCatalog(page, "text");
  const restoredImage = await readCatalog(page, "image");
  const presentAfter =
    (restoredText.providers ?? []).includes(provider) ||
    (restoredImage.providers ?? []).includes(provider);
  expect(presentAfter, "改回可见后应恢复出现在目录中").toBe(true);
});
