import { test, expect } from "@playwright/test";

/**
 * webext-slots-runtime 浏览器 e2e(source-settings-and-slots 任务 6.4)。
 *
 * 面⑤ 路线 A 的第三方 slots 源本地全链验收:`webext-slots-runtime-agent` 与构建期静态
 * import 车道的 `webext-slots-agent`(见 `webext-full.e2e.ts`)同构(18 槽 fixture 内容
 * 一致),但**刻意不在** `lib/app/webext-registry.ts` 的静态 import 名单里、source 路径
 * 也不含 "webext-slots-agent" 子串 —— 只能经运行时车道生效:
 *   /api/webext/resolve(服务端验签)→ dist 字节 → 浏览器动态 import → loadExtension →
 *   applyExtension → SlotHost 挂 18 槽。
 *
 * 与 `webext-full.e2e.ts` 的分工:那边验证「构建期静态 import 车道」12 个 reserved-slot
 * 容器属性(`data-pi-ext-*`)命中,本文件验证「运行时车道」18 个 fixture 内容
 * (`data-testid="slot-*"`)全部逐一可见 —— 两条车道互不相关但结果应当一致
 * (SlotHost 对声明式/代码扩展一视同仁,不区分「构建期已知」与「运行时下发」)。
 */

/** 18 槽 fixture testid 全集,对齐 `examples/webext-slots-runtime-agent/.pi/web/web.config.tsx`。 */
const ALL_18_SLOT_TESTIDS = [
  "slot-background",
  "slot-header-left",
  "slot-header-center",
  "slot-header-right",
  "slot-sidebar-left",
  "slot-panel-right",
  "slot-toolbar",
  "slot-accessory-above",
  "slot-accessory-below",
  "slot-accessory-inline-left",
  "slot-accessory-inline-right",
  "slot-empty",
  "slot-footer",
  "slot-notifications",
  "slot-status-bar",
  "slot-artifact-surface",
  "slot-prompt-input",
  "slot-dialog-layer",
] as const;

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

test.describe("webext 第三方 slots 源:运行时车道全链(resolve → dist → import → 挂 18 槽)", () => {
  test("解析端点直查:运行时 slots 夹具返回 found + entry manifest + baseUrl 指向 dist", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/webext/resolve?source=" +
        encodeURIComponent("./examples/webext-slots-runtime-agent"),
    );
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      found: boolean;
      manifest?: {
        id?: string;
        entry?: string;
        signaturePreVerified?: boolean;
      };
      baseUrl?: string;
      rejectedReason?: string;
    };
    expect(body.rejectedReason).toBeUndefined();
    expect(body.found).toBe(true);
    expect(body.manifest?.id).toBe("webext-slots-runtime");
    // 代码扩展(带 entry),区别于 webext-runtime-install 覆盖的纯声明夹具。
    expect(body.manifest?.entry).toBe("web-extension.mjs");
    expect(body.manifest?.signaturePreVerified).toBe(true);
    expect(body.baseUrl).toContain("/api/webext/dist/");
  });

  test("全链渲染:18 槽全部经运行时车道挂载可见,不经构建期静态 import 车道", async ({
    page,
  }) => {
    await selectSource(page, "./examples/webext-slots-runtime-agent");

    // 运行时加载证据:标题取自运行时 config.documentTitle(webext-slots-runtime 专属值,
    // 与构建期静态车道的 "Slots Agent · pi-web" 不同,证明命中的是本 fixture 而非
    // webext-registry.ts 里 match:"webext-slots-agent" 的既有条目)。
    await expect(page).toHaveTitle("Slots Runtime Agent · pi-web");

    for (const testid of ALL_18_SLOT_TESTIDS) {
      await expect(page.getByTestId(testid)).toBeVisible();
    }
    expect(ALL_18_SLOT_TESTIDS).toHaveLength(18);

    // 去重回归:扩展插槽为追加语义,内核输入框仍可用(与 webext-full.e2e.ts 同款断言,
    // 证明运行时车道加载不破坏宿主壳)。
    await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  });

  test("声明式 config.empty 随运行时车道生效:自定义空态标题/副标题/建议项", async ({
    page,
  }) => {
    await selectSource(page, "./examples/webext-slots-runtime-agent");

    await expect(
      page.getByRole("heading", { name: "Slots Runtime Agent · 自定义空态" }),
    ).toBeVisible();
    await expect(
      page.getByText("本扩展经运行时代码车道加载(/api/webext/resolve → 动态 import)。"),
    ).toBeVisible();
  });
});

test.describe("webext 第三方 slots 源:安全门降级(篡改 / 坏签名),宿主壳不崩壳", () => {
  test("篡改降级:entry 字节被篡改 → 浏览器侧 SRI 校验拒绝,扩展不生效但会话正常可用", async ({
    page,
  }) => {
    // 服务端验签放行(manifest 本身合法签名),真正的拒绝发生在浏览器 fetch entry 字节后
    // 的 SRI 摘要比对(见 webext-fixtures.setup.ts 的 buildRuntimeSlotsTamperedFixture)。
    const res = await page.request.get(
      "/api/webext/resolve?source=" +
        encodeURIComponent("./examples/webext-slots-runtime-tampered-agent"),
    );
    const body = (await res.json()) as {
      found: boolean;
      rejectedReason?: string;
      manifest?: { entry?: string };
    };
    expect(body.found).toBe(true);
    expect(body.rejectedReason).toBeUndefined();
    expect(body.manifest?.entry).toBe("web-extension.mjs");

    await selectSource(page, "./examples/webext-slots-runtime-tampered-agent");

    // 扩展未生效:fixture 槽内容不出现,浏览器标签页标题未被扩展的 documentTitle 覆盖。
    await expect(page.getByTestId("slot-header-center")).toHaveCount(0);
    await expect(page.getByTestId("slot-panel-right")).toHaveCount(0);
    await expect(page).not.toHaveTitle("Slots Runtime Tampered · pi-web");

    // 宿主壳不崩:会话正常可用(默认 UI 降级,而非白屏/报错页)。
    await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  });

  test("坏签名降级:manifest 用非白名单私钥签名 → 服务端验签拒绝下发,会话正常可用", async ({
    page,
  }) => {
    const res = await page.request.get(
      "/api/webext/resolve?source=" +
        encodeURIComponent("./examples/webext-slots-runtime-badsig-agent"),
    );
    const body = (await res.json()) as {
      found: boolean;
      rejectedReason?: string;
      manifest?: unknown;
    };
    // 服务端验签直接拒绝:found:true(产物存在)但无背书 manifest、附拒绝原因。
    expect(body.found).toBe(true);
    expect(body.rejectedReason).toBeDefined();
    expect(body.manifest).toBeUndefined();

    await selectSource(page, "./examples/webext-slots-runtime-badsig-agent");

    await expect(page.getByTestId("slot-header-center")).toHaveCount(0);
    await expect(page.getByTestId("slot-panel-right")).toHaveCount(0);
    await expect(page).not.toHaveTitle("Slots Runtime Bad Signature · pi-web");

    // 宿主壳不崩:会话正常可用。
    await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  });
});
