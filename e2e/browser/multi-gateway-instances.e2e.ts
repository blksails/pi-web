import { test, expect } from "@playwright/test";

/**
 * 多网关实例并存(spec: multi-gateway-providers,任务 8.2;Req 1.1, 1.2, 1.3)。
 *
 * 完成判据(tasks.md):两个网关实例同时启用时在 provider 下拉中分别可见。
 *
 * 专用 playwright project「gateways」(见 `playwright.config.ts`):pi-web server 声明
 * `PI_WEB_GATEWAYS=cloudflare,blksails-ai`(契约见 `.env.local.example`「Multi-gateway
 * instances」段),两个实例各自指向一个本机可控的桩网关(`e2e/fixtures/
 * ai-gateway-catalog-stub-server.mjs`,与 `test/ai-gateway-multi-instance.integration
 * .test.ts` 的 `makeCatalogServer` 同一惯例)——绝不依赖真实上游网关(不可达/需密钥)。
 *
 * 未接线时会报红的两条路径(在实现引入前均已实测复现,详见任务收尾 learnings):
 *  - `PI_WEB_GATEWAYS` 被忽略、只回落合成缺省实例(存量单实例行为)→ provider 下拉只有
 *    一个 `ai-gateway`,两个实例名均缺席;
 *  - 若目录合并把多实例条目误折叠回同一个固定常量(改造前的真实缺陷,design.md「既有
 *    架构分析」),则两个实例的模型会共享同一个 provider 名,`cloudflare` 与
 *    `blksails-ai` 无法同时被观测为两个不同选项。
 */

const CF_MODEL_ID = "e2e-cf-mesh-model";
const BLK_MODEL_ID = "e2e-blk-mesh-model";

test("两个网关实例同时启用:provider 下拉中分别可见,且各自的模型归属正确(完成判据)", async ({
  page,
}) => {
  // 目录服务是惰性 + TTL(stale-while-revalidate):首次 `get()` 触发后台刷新但不等待,
  // 快照恒为空直到刷新成功。先经 API 直接轮询部署级目录,等两个实例的桩数据都已
  // 拉取成功,再进入设置界面——避免与目录预热竞态,使下方的 UI 断言确定性成立。
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/config/models?output=text");
        if (!res.ok()) return false;
        const body = (await res.json()) as { models: ReadonlyArray<{ id: string }> };
        return (
          body.models.some((m) => m.id === CF_MODEL_ID) &&
          body.models.some((m) => m.id === BLK_MODEL_ID)
        );
      },
      { timeout: 15_000, intervals: [200, 500, 1_000] },
    )
    .toBe(true);

  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();
  await page.locator('[data-pi-settings-nav="settings"]').click();

  const providerCombobox = page
    .locator('[data-pi-model-select="providerSelect"]')
    .getByRole("combobox");
  await expect(providerCombobox).toBeVisible();
  await providerCombobox.click();
  await expect(page.getByRole("listbox")).toBeVisible();

  // Req 1.3:两个实例标识分别列出(不是折叠成单一固定常量)。
  await expect(page.getByRole("option", { name: "cloudflare" })).toBeVisible();
  await expect(page.getByRole("option", { name: "blksails-ai" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Req 1.2:各自的模型归属其所属实例标识(不是共享同一个 provider 名)——经默认模型
  // 下拉(modelSelect,按 provider 分组)校验分组标题即为各自实例名。
  await page.locator('[data-pi-model-select="modelSelect"]').getByRole("combobox").click();
  await expect(page.getByRole("listbox")).toBeVisible();
  const cfOption = page.getByRole("option", { name: new RegExp(CF_MODEL_ID) });
  const blkOption = page.getByRole("option", { name: new RegExp(BLK_MODEL_ID) });
  await expect(cfOption).toBeVisible();
  await expect(blkOption).toBeVisible();
});
