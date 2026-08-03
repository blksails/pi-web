import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";

/**
 * 自定义 provider 的模型出现在**部署级模型目录**(spec: multi-gateway-providers,
 * 任务 8.2;Req 7.2, 11.1)。
 *
 * ★ 覆盖范围订正(任务 8.2 修复轮):本文件验证的是设置界面「通用」面板的
 * `defaultModel` 下拉(widget `modelSelect`),取数走真实 `GET /api/config/models`
 * (`ModelCatalogService` + `providers.json` 装配链路,部署级目录)——对应 design.md
 * 追溯表的 **Req 3.1/11.1/11.2**,以及 Req 7.2「其模型出现在模型目录中」在这个具体
 * 消费面成立。它**不**覆盖、也不再声称覆盖 Req 11.3(「会话模型选择器」,聊天区
 * `<PiChat>` 的 `[data-pi-model-selector]`,走 `GET /api/sessions/:id/models` →
 * pi SDK `session.modelRegistry.getAvailable()`)—— 那是完全独立的一条数据管道:
 * 浏览器 e2e 下的聊天区选择器由离线桩 agent(`PI_WEB_STUB_AGENT=1`)驱动,默认桩
 * (`lib/app/stub-agent-process.mjs`)的 `get_available_models` 返回**固定写死**的
 * anthropic/openai 桩模型,与 `providers.json` 完全解耦,本文件的取数路径无法触达它、
 * 也不对它做任何断言。Req 11.3 的会话侧观测点由新增的
 * `e2e/browser/custom-provider-session-selector.e2e.ts`(专用 stub
 * `e2e/fixtures/model-catalog-stub-agent.mjs`,经真实 `registerBuiltinModelSources()`
 * 合成会话可用清单)独立覆盖,详见该文件头注释。
 *
 * 与已有同族用例的分工:`provider-management.e2e.ts`(任务 5.4)已覆盖「新增 provider →
 * 出现在 providers 面板自身的『全部 Provider』清单」;`provider-hot-reflect.e2e.ts`
 * (任务 6.6)已覆盖「带外变更 → providerSelect(provider 名)下拉最终反映」。本文件
 * 补的是二者都未覆盖的一格:**模型本身**(而非仅 provider 名)出现在 `modelSelect`
 * 下拉里,且按 provider 分组——证明的是 Req 7.2「其模型出现在模型目录中」在这个具体
 * 消费面确实成立,不是「provider 名出现了但模型列表仍是空的」这种半接线状态。
 *
 * 写入落到 playwright.config.ts 为本次运行分配的隔离 `PI_WEB_E2E_AGENT_DIR`(与
 * provider-management.e2e.ts 同惯例),用例前后都删 `providers.json` 保持幂等。
 */
const agentDir = process.env.PI_WEB_E2E_AGENT_DIR;
if (agentDir === undefined || agentDir.length === 0) {
  throw new Error("PI_WEB_E2E_AGENT_DIR 未设置——本用例依赖 playwright.config.ts 分配的隔离目录");
}
const PROVIDERS_JSON = join(agentDir, "providers.json");
const removeProvidersJson = (): void => {
  rmSync(PROVIDERS_JSON, { force: true });
};

// TTL 兜底档的轮询预算(与 provider-hot-reflect.e2e.ts 同一常量来源
// MODEL_OPTIONS_CACHE_TTL_MS=5000ms,留足余量吸收压载下的调度抖动)。
const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVALS_MS = [500, 1_000, 2_000];

test.describe("会话模型选择器(通用面板 modelSelect)反映新增自定义 provider 的模型", () => {
  test.beforeEach(() => {
    removeProvidersJson();
  });
  test.afterEach(() => {
    removeProvidersJson();
  });

  test("经 API 新增一个带模型的自定义 provider 后,其模型出现在 modelSelect 下拉并按 provider 分组(完成判据)", async ({
    page,
  }) => {
    const providerId = `e2e-modelselect-${Date.now()}`;
    const modelId = "model-a";

    await page.goto("/settings");
    await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

    // 经本页面自身的 server(同 origin,与该 server 实际读到的 agentDir 天然一致)整份
    // PUT providers 文档——与 provider-hot-reflect.e2e.ts 同惯例。
    const origin = new URL(page.url()).origin;
    const putRes = await page.request.put(`${origin}/api/config/providers`, {
      data: {
        values: {
          providers: [
            {
              id: providerId,
              baseUrl: "https://api.e2e-modelselect.example.com/v1",
              models: [{ id: modelId }],
            },
          ],
        },
      },
    });
    expect(putRes.ok()).toBe(true);

    // 反复做 SPA 内导航(切到 Provider 面板再切回「通用」面板,逼出 modelSelect 的
    // ModelSelectField 以 key={panel.id} 重新挂载)直到目录携带新模型或超时——不睡固定
    // 时长,不整页刷新。
    await expect
      .poll(
        async () => {
          await page.locator('[data-pi-settings-nav="providers"]').click();
          await page.locator('[data-pi-settings-nav="settings"]').click();
          const combobox = page
            .locator('[data-pi-model-select="modelSelect"]')
            .getByRole("combobox");
          await expect(combobox).toBeVisible();
          await combobox.click();
          await expect(page.getByRole("listbox")).toBeVisible();
          const found = (await page.getByRole("option", { name: modelId }).count()) > 0;
          await page.keyboard.press("Escape");
          return found;
        },
        { timeout: POLL_TIMEOUT_MS, intervals: POLL_INTERVALS_MS },
      )
      .toBe(true);

    // 按 provider 分组(Req 7.2 的字面要求「其模型出现在模型目录中」,分组标题须是该
    // provider 标识,而不是模型混进某个既有 provider 组里被误判为"本就有的"）。
    // `buildGroups`(model-select-field.tsx)只在某 provider 至少有一个选项时才创建其
    // CommandGroup(`heading={g.provider}`)——随机生成、全局唯一的 `providerId` 作为
    // 组标题出现,只可能因为这条新增 provider 真的产出了模型条目,不会与既有分组混淆。
    await page
      .locator('[data-pi-model-select="modelSelect"]')
      .getByRole("combobox")
      .click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(listbox.getByText(providerId, { exact: true })).toBeVisible();
    await expect(listbox.getByRole("option", { name: modelId })).toBeVisible();
  });
});
