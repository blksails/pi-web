import { test, expect } from "@playwright/test";

/**
 * agent-web-extension 视觉验收 — 补齐项集中回归(任务 14)。
 *
 * 覆盖既有 webext.e2e.ts / slash-command-palette.e2e.ts 未触及的「新补齐能力」:
 *  - R6 Tier1 全部 12 个协议保留插槽(webext-slots-agent)在会话内渲染,
 *    且**去重回归**:扩展插槽一律追加、不替换内核输入/消息表面。
 *  - R3/R4 Tier1 header 三区(headerLeft/Center/Right)+ footer(webext-layout-agent)。
 *
 * 与既有用例一致:对真实 Next server + 确定性离线 stub agent(PI_WEB_STUB_AGENT=1)运行。
 */

/** webext-slots-agent 声明的 12 个协议保留插槽 → 浏览器可见 data 属性(extension-slots.tsx)。 */
const RESERVED_SLOT_ATTRS = [
  "data-pi-ext-sidebar-left",
  "data-pi-ext-toolbar",
  "data-pi-ext-accessory-above",
  "data-pi-ext-accessory-below",
  "data-pi-ext-accessory-inline-left",
  "data-pi-ext-accessory-inline-right",
  "data-pi-ext-empty",
  "data-pi-ext-notifications",
  "data-pi-ext-status-bar",
  "data-pi-ext-artifact-surface",
  "data-pi-ext-prompt-input",
  "data-pi-ext-dialog-layer",
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

test("webext slots: 12 个协议保留插槽全部渲染,且不替换内核表面(R6 + 去重回归)", async ({
  page,
}) => {
  await selectSource(page, "./examples/webext-slots-agent");

  // R6 — 初始空态下,扩展声明的 12 个保留插槽容器全部挂入 DOM(empty 在空态渲染)。
  for (const attr of RESERVED_SLOT_ATTRS) {
    await expect(page.locator(`[${attr}]`)).toBeAttached();
  }

  // 各插槽 fixture 内容(data-testid="slot-*")随容器渲染,抽样确认可见。
  await expect(page.getByTestId("slot-sidebar-left")).toBeVisible();
  await expect(page.getByTestId("slot-toolbar")).toBeVisible();
  await expect(page.getByTestId("slot-status-bar")).toBeVisible();
  await expect(page.getByTestId("slot-empty")).toBeVisible();

  // 去重回归:扩展插槽为「追加」语义,内核输入框未被替换/移除,会话仍可用。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();

  // promptInput 装饰为同级绝对覆盖层(不接管输入):装饰层与 textarea 共享同一
  // .relative 包裹并存,证明「追加装饰」而非「替换输入」。
  const editorWrap = page.locator("div.relative", {
    has: page.locator("[data-pi-input-textarea]"),
  });
  await expect(editorWrap.locator("[data-pi-ext-prompt-input]")).toHaveCount(1);
});

test("webext layout: header 三区 + footer 渲染(R3/R4)", async ({ page }) => {
  await selectSource(page, "./examples/webext-layout-agent");

  // R3 — headerLeft / headerCenter / headerRight 三区均由扩展填充。
  await expect(page.getByTestId("layout-header-left")).toContainText("Nav");
  await expect(page.getByTestId("layout-header")).toContainText("Layout Agent");
  await expect(page.getByTestId("layout-header-right")).toContainText("Help");

  // R4 — footer 区域由扩展填充,挂在 [data-pi-ext-footer] 下。
  await expect(page.locator("[data-pi-ext-footer]")).toBeVisible();
  await expect(page.getByTestId("layout-footer")).toContainText(
    "webext-layout-agent footer",
  );

  // 去重回归:扩展 header/footer 追加,内核输入框仍可用。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
});
