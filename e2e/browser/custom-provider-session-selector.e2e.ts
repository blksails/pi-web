import { test, expect } from "@playwright/test";

/**
 * 自定义 provider 的模型出现在**会话内**模型选择器(spec: multi-gateway-providers,
 * 任务 8.2 修复轮;Req 7.2, 11.3)。
 *
 * 完成判据(tasks.md 8.2):新增一个自定义 provider 后其模型出现在会话模型选择器。
 *
 * ## 为什么需要这个独立文件(而不是复用 `custom-provider-model-selector.e2e.ts`)
 *
 * 那个文件验证的是设置界面「通用」面板的 `modelSelect` 下拉 —— 走
 * `GET /api/config/models`(部署级目录,`ModelCatalogService`)。它与 Req 11.3 字面
 * 要求的「**会话**模型选择器」(聊天区 `<PiChat>` 的 `[data-pi-model-selector]`,走
 * `GET /api/sessions/:id/models` → pi SDK `session.modelRegistry.getAvailable()`)
 * 是两条完全不同的数据管道 —— 浏览器 e2e 下会话侧由离线桩 agent
 * (`PI_WEB_STUB_AGENT=1`)驱动,默认桩(`lib/app/stub-agent-process.mjs`)的
 * `get_available_models` 返回写死的三个桩模型,与 `providers.json` 完全解耦,
 * 无法证明「自定义 provider 接线」在会话侧生效。
 *
 * 本文件跑在专用 playwright project「session-models」上(见 `playwright.config.ts`):
 * pi-web server 声明 `PI_WEB_STUB_AGENT_PATH` 指向
 * `e2e/fixtures/model-catalog-stub-agent.mjs`(生产 stub 的分支,唯独
 * `get_available_models` 改为经**真实**装配点 `registerBuiltinModelSources()` 合成
 * 模型清单,细节与保真边界见该夹具文件头注释)。
 *
 * ## 两个测试的分工(红检用,详见任务收尾 learnings)
 *
 * - 「会话侧」用例断言 `GET /api/sessions/:id/models` 与聊天区选择器 —— 走的是
 *   `host-assembly/model-sources.ts` 里 `registerModelSource<readonly
 *   CustomProviderEntry[]>({...})` 那一整块(会话侧登记)。
 * - 「设置页对照」用例断言 `modelSelect`(部署级 `GET /api/config/models`)——
 *   走的是 `ModelCatalogService` 的 `customProviders` 依赖,是另一条独立代码路径。
 *
 * 撤掉前者(仅会话侧登记块)时,「会话侧」用例必须报红,「设置页对照」用例必须仍绿 ——
 * 这正好证明两条管道确实不同、本文件补的是原来缺失的那条(完成判据里的
 * 「未接线时能报红」)。
 */

const SOURCE = "./examples/hello-agent";

async function startSession(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  const text = await page.locator("[data-session-id]").textContent();
  const sessionId = (text ?? "").replace("session: ", "").trim();
  expect(sessionId.length).toBeGreaterThan(0);
  return sessionId;
}

/**
 * 经 PUT 整份写入一个带 `apiKey` 的自定义 provider。
 *
 * 用 `request` fixture(而非 `page.request`)——它按 `playwright.config.ts` 的
 * `use.baseURL` 解析相对路径,不依赖 `page` 当前已导航到某个 URL(建会话前调用时
 * `page.url()` 仍是 `about:blank`,`page.request` 的相对路径解析会落空)。
 *
 * ★ 关键 gotcha(任务收尾 learnings):自定义 provider **不带 apiKey 时会被会话侧
 * fail-soft 跳过**(`model-sources.ts` 注释明确说明这是刻意设计 —— pi SDK
 * `registerProvider` 传入非空 `models` 时硬性要求 `apiKey`/`oauth` 二选一),故 e2e
 * 造数据必须带 apiKey,否则本用例会因错误原因报红(与"未接线"混淆)。
 */
async function putCustomProvider(
  request: import("@playwright/test").APIRequestContext,
  providerId: string,
  modelId: string,
): Promise<void> {
  const putRes = await request.put("/api/config/providers", {
    data: {
      values: {
        providers: [
          {
            id: providerId,
            baseUrl: "https://api.e2e-session-models.example.com/v1",
            apiKey: "e2e-session-models-api-key",
            models: [{ id: modelId }],
          },
        ],
      },
    },
  });
  expect(putRes.ok()).toBe(true);
}

test.describe("会话内模型选择器反映新增自定义 provider 的模型(Req 11.3)", () => {
  test("经 API 新增一个带 apiKey 的自定义 provider 后,其模型出现在会话可用模型清单与聊天区选择器(完成判据)", async ({
    page,
    request,
  }) => {
    const providerId = `e2e-session-model-${Date.now()}`;
    const modelId = "session-model-a";

    // ★ 顺序不能颠倒:stub 子进程只在 spawn 时读一次 providers.json,无热更新
    // (`resolveSpecFromEnv` 在 `handle("get_available_models")` 时才被本夹具调用,
    // 但新建会话即会 spawn 新的子进程 —— 先写配置、再建会话,才能保证该次会话读到
    // 新条目)。写在建会话之前。
    await putCustomProvider(request, providerId, modelId);

    const sessionId = await startSession(page);

    // (a) REST 边界:GET /api/sessions/:id/models 含该 provider/model(与
    // rich-chat.e2e.ts 同惯例,先在 REST 层佐证数据,再驱动 UI)。
    const modelsRes = await request.get(`/api/sessions/${sessionId}/models`);
    expect(modelsRes.status()).toBe(200);
    const { models } = (await modelsRes.json()) as {
      models: ReadonlyArray<{ id: string; provider: string }>;
    };
    expect(
      models.some((m) => m.provider === providerId && m.id === modelId),
    ).toBe(true);

    // (b) 聊天区选择器:[data-pi-model-selector] 展开后存在 heading 为该 provider id
    // 的 [data-pi-model-group],其下有该 model 的 [data-pi-model-option]
    // (选择器与惯例见 rich-chat.e2e.ts)。
    await expect(page.locator("[data-pi-model-selector]")).toBeVisible();
    await page.locator("[data-pi-model-trigger]").click();
    const panel = page.locator("[data-pi-model-panel]");
    await expect(panel).toBeVisible();

    const group = panel.locator("[data-pi-model-group]").filter({ hasText: providerId });
    await expect(group).toBeVisible();
    await expect(
      group.locator("[data-pi-model-option]").filter({ hasText: modelId }),
    ).toBeVisible();
  });
});

test.describe("对照:设置页『通用』modelSelect 下拉(部署级目录,Req 7.2/11.1 —— 用于红检时验证两条管道确实不同)", () => {
  test("同一个自定义 provider 的模型也出现在 modelSelect 下拉(部署级目录路径,预期与上例的会话侧路径独立生效)", async ({
    page,
    request,
  }) => {
    const providerId = `e2e-session-model-control-${Date.now()}`;
    const modelId = "control-model-a";

    await putCustomProvider(request, providerId, modelId);

    await page.goto("/settings");
    await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

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
        { timeout: 15_000, intervals: [500, 1_000, 2_000] },
      )
      .toBe(true);
  });
});
