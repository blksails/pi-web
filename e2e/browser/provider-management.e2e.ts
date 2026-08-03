import { test, expect } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * 「Provider」设置面板 browser e2e(spec: multi-gateway-providers,任务 5.4;
 * Req 7.1, 11.7)。
 *
 * 完成判据(tasks.md):浏览器 e2e 能新增一个 provider 并在保存后看到它出现在列表中。
 *
 * 写入落到 playwright.config.ts 为本次运行分配的隔离 `PI_WEB_E2E_AGENT_DIR`
 * (与 settings-config.e2e.ts 的沙箱用例同惯例),不污染真实 `~/.pi/agent`;用例前后
 * 都删 `providers.json`,使其自带幂等(存量残留会让"新增后出现"这类断言在重跑时
 * 因为条目已经在场而失去区分度 —— 同一坑 settings-config.e2e.ts 文件头注释已踩过)。
 */
const agentDir = process.env.PI_WEB_E2E_AGENT_DIR;
if (agentDir === undefined || agentDir.length === 0) {
  throw new Error("PI_WEB_E2E_AGENT_DIR 未设置——本用例依赖 playwright.config.ts 分配的隔离目录");
}
const PROVIDERS_JSON = join(agentDir, "providers.json");
const removeProvidersJson = (): void => {
  rmSync(PROVIDERS_JSON, { force: true });
};

test.describe("settings: Provider 管理面板", () => {
  test.beforeEach(() => {
    removeProvidersJson();
  });
  test.afterEach(() => {
    removeProvidersJson();
  });

  test("新增一个自定义 provider 并保存后,出现在列表与来源清单中(完成判据)", async ({
    page,
  }) => {
    const providerId = `e2e-custom-${Date.now()}`;

    await page.goto("/settings");
    await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

    // 左侧导航有「Provider」菜单项,进入其面板。
    const nav = page.locator('[data-pi-settings-nav="providers"]');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveText("Provider");
    await nav.click();
    await expect(page.locator('[data-pi-settings-panel="providers"]')).toBeVisible();

    // Req 7.1:面板顶部有「全部 Provider」只读清单区块(标明来源)。不断言"初始为空"——
    // e2e server 装配了真实网关套件,即便没有自定义 provider,清单也会先列出网关/自配
    // provider(这正是 Req 7.1 要求的"标明每个来自内置注册"那一档,不是本用例的空干扰)。
    const registry = page.locator("[data-pi-provider-registry]");
    await expect(registry).toBeVisible();
    await expect(
      registry.getByText("暂无 provider").or(registry.locator("[data-pi-provider-registry-row]").first()),
    ).toBeVisible();

    // 新增一条(objectList「添加条目」;此刻页面上仅有一个该按钮——providers 列表
    // 为空时,嵌套的 models 列表尚未渲染,不会产生第二个同名按钮造成歧义)。
    await page.getByRole("button", { name: "添加条目" }).click();
    const item = page.locator('[data-pi-objlist-item="0"]');
    await expect(item).toBeVisible();

    // 用 `>` 直接子代组合器锁定**外层**条目自身的「标识」字段(下方补的嵌套模型条目
    // 同样有一个 key 为 "id" 的字段,若不加 `>` 会连带命中,后续 reload 断言即歧义报错)。
    await item.locator('> [data-pi-field="id"] input').fill(providerId);
    await item
      .locator('[data-pi-field="baseUrl"] input')
      .fill("https://api.e2e-custom-provider.example.com/v1");
    // 顺带验证凭据只写不读(★铁律):填一个明文凭据,保存后回读页面绝不应出现明文。
    await item.locator('[data-pi-field="apiKey"] input[type="password"]').fill("sk-e2e-secret-value");

    // 「全部 Provider」清单(及部署级目录本身)按 provider **所携带的模型**聚合——
    // 零模型的 provider 不出现在任何统一目录投影里(`ModelCatalogService.query()` 的
    // `providers` 字段就是从 `models` 反推的去重集合,不是独立枚举)。故需给这条自定义
    // provider 补一个模型条目,才能在下方 Req 7.1 清单里被观测到——这也更贴近真实使用
    // (Req 7.2「新增 provider 后其模型出现在目录中」本就是以模型为单位来谈的)。
    await item.locator('[data-pi-field="models"]').getByRole("button", { name: "添加条目" }).click();
    const modelItem = item.locator('[data-pi-field="models"] [data-pi-objlist-item="0"]');
    await modelItem.locator('[data-pi-field="id"] input').fill("model-a");

    const saveBtn = page.getByRole("button", { name: "保存" });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByText("已保存")).toBeVisible();

    // 磁盘确实落盘(装配期靠这个文件接入目录/会话),且凭据是明文(装配期需要真实凭据)。
    const onDisk = JSON.parse(readFileSync(PROVIDERS_JSON, "utf8")) as {
      providers: readonly Record<string, unknown>[];
    };
    expect(onDisk.providers).toHaveLength(1);
    expect(onDisk.providers[0]?.["id"]).toBe(providerId);
    expect(onDisk.providers[0]?.["apiKey"]).toBe("sk-e2e-secret-value");

    // 刷新页面 → 重新进入面板 → 新增的 provider 仍在列表中(完成判据字面要求)。
    // ★ `[data-pi-objlist-item="0"]` 在外层 providers 列表与内嵌 models 列表里都是下标 0,
    // 重新加载后两者同时渲染;`.first()` 只保证card**本身**取到外层(父先于子），但
    // 在其内部再查找同 key 的字段仍会连带命中嵌套条目——同样需要 `>` 锁定直接子代。
    await page.reload();
    await page.locator('[data-pi-settings-nav="providers"]').click();
    await expect(page.locator('[data-pi-settings-panel="providers"]')).toBeVisible();
    const reloadedItem = page.locator('[data-pi-objlist-item="0"]').first();
    await expect(reloadedItem.locator('> [data-pi-field="id"] input')).toHaveValue(providerId);

    // 凭据回读只呈现掩码,明文绝不出现在页面上的任何地方(★铁律:不得把掩码值当真值)。
    await expect(page.locator("body")).not.toContainText("sk-e2e-secret-value");
    await expect(reloadedItem.locator('[data-pi-field="apiKey"]')).toContainText("已设置");

    // Req 7.1:只读清单同步反映新增的 provider,标明其来源为「使用者自定义」。
    const registryRow = page.locator(`[data-pi-provider-registry-row="${providerId}"]`);
    await expect(registryRow).toBeVisible();
    await expect(registryRow.locator('[data-pi-provider-registry-source="custom"]')).toHaveText(
      "使用者自定义",
    );
  });

  test("保存后立即(不等缓存 TTL)在「通用」面板的模型下拉中反映(任务 6.6 主机制,Req 11.3/11.4/11.5)", async ({
    page,
  }) => {
    const providerId = `e2e-immediate-${Date.now()}`;

    await page.goto("/settings");
    await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

    // 先进入「通用」面板,建立 providerSelect 下拉的首次取数缓存桶——此刻新 provider
    // 还不存在。
    await page.locator('[data-pi-settings-nav="settings"]').click();
    const providerCombobox = page
      .locator('[data-pi-model-select="providerSelect"]')
      .getByRole("combobox");
    await expect(providerCombobox).toBeVisible();
    await providerCombobox.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: providerId })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 切到 Provider 面板,新增一条并经界面「保存」按钮提交(与上一用例同惯例)——
    // `useConfigDomain.save()` 成功后会广播 `pi-web:config-saved`,这是本断言要验证的
    // 主机制(而非下方 provider-hot-reflect.e2e.ts 覆盖的 TTL 兜底档)。
    await page.locator('[data-pi-settings-nav="providers"]').click();
    await expect(page.locator('[data-pi-settings-panel="providers"]')).toBeVisible();
    await page.getByRole("button", { name: "添加条目" }).click();
    const item = page.locator('[data-pi-objlist-item="0"]');
    await expect(item).toBeVisible();
    await item.locator('> [data-pi-field="id"] input').fill(providerId);
    await item
      .locator('[data-pi-field="baseUrl"] input')
      .fill("https://api.e2e-immediate.example.com/v1");
    await item.locator('[data-pi-field="models"]').getByRole("button", { name: "添加条目" }).click();
    const modelItem = item.locator('[data-pi-field="models"] [data-pi-objlist-item="0"]');
    await modelItem.locator('[data-pi-field="id"] input').fill("model-a");

    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("已保存")).toBeVisible();

    // 不等待——立即切回「通用」面板(SPA 内导航,`ConfigPanelView` 以 `key={panel.id}`
    // 重新挂载 `ModelSelectField`),下拉里应已能看到新 provider:证明是事件驱动的即时
    // 失效在生效,而不是恰好命中了 TTL 兜底(TTL 是 5000ms,本用例全程不 sleep)。
    await page.locator('[data-pi-settings-nav="settings"]').click();
    const providerComboboxAgain = page
      .locator('[data-pi-model-select="providerSelect"]')
      .getByRole("combobox");
    await expect(providerComboboxAgain).toBeVisible();
    await providerComboboxAgain.click();
    await expect(page.getByRole("option", { name: providerId })).toBeVisible();
  });

  test("停用一个 provider 后配置仍保留(Req 7.5 的界面侧行为)", async ({ page }) => {
    const providerId = `e2e-toggle-${Date.now()}`;

    await page.goto("/settings");
    await page.locator('[data-pi-settings-nav="providers"]').click();
    await expect(page.locator('[data-pi-settings-panel="providers"]')).toBeVisible();

    await page.getByRole("button", { name: "添加条目" }).click();
    const item = page.locator('[data-pi-objlist-item="0"]');
    await item.locator('[data-pi-field="id"] input').fill(providerId);
    await item.locator('[data-pi-field="baseUrl"] input').fill("https://api.e2e-toggle.example.com/v1");

    const enabledToggle = item.locator('[data-pi-field="enabled"] input[type="checkbox"]');
    await expect(enabledToggle).toBeChecked(); // 缺省启用(Req 7.5 的反面)。
    await enabledToggle.uncheck();

    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("已保存")).toBeVisible();

    // 磁盘保留该条目(未被删除),只是 enabled=false。
    const onDisk = JSON.parse(readFileSync(PROVIDERS_JSON, "utf8")) as {
      providers: readonly Record<string, unknown>[];
    };
    expect(onDisk.providers).toHaveLength(1);
    expect(onDisk.providers[0]?.["id"]).toBe(providerId);
    expect(onDisk.providers[0]?.["enabled"]).toBe(false);
  });
});
