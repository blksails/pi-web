import { test, expect } from "@playwright/test";

/**
 * agent-web-extension 视觉验收 — 补齐项集中回归(任务 14)。
 *
 * 覆盖既有 webext.e2e.ts / slash-command-palette.e2e.ts 未触及的「新补齐能力」:
 *  - R6 Tier1 全部 12 个协议保留插槽(webext-slots-agent)在会话内渲染,
 *    且**去重回归**:扩展插槽一律追加、不替换内核输入/消息表面。
 *  - R3/R4 Tier1 header 三区(headerLeft/Center/Right)+ footer(webext-layout-agent)。
 *
 * 与既有用例一致:对真实 pi-web server + 确定性离线 stub agent(PI_WEB_STUB_AGENT=1)运行。
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

function gridButtonTexts(page: import("@playwright/test").Page) {
  return page
    .locator('[data-pi-suggestions-layout="grid"] button')
    .allTextContents();
}

test("webext slots: Tier5 声明式空态配置(config.empty)驱动标题/副标题/建议项,并 prepend 合并命令", async ({
  page,
}) => {
  await selectSource(page, "./examples/webext-slots-agent");

  // 标题/副标题取自 webext-slots-agent 的声明式 config.empty。
  await expect(
    page.getByRole("heading", { name: "Slots Agent · 自定义空态" }),
  ).toBeVisible();
  await expect(
    page.getByText("标题/副标题/下面这两个建议项均来自声明式 config.empty。"),
  ).toBeVisible();

  // 配置建议项与 agent 命令(stub:/help、/clear)都出现;prepend → 配置项在命令之前。
  await expect(
    page.locator('[data-pi-suggestions-layout="grid"] button', {
      hasText: "解释这个项目的结构",
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-pi-suggestions-layout="grid"] button', {
      hasText: "/help",
    }),
  ).toBeVisible();

  const texts = await gridButtonTexts(page);
  const idxStarter = texts.findIndex((t) => t.includes("解释这个项目的结构"));
  const idxHelp = texts.findIndex((t) => t.includes("/help"));
  expect(idxStarter).toBeGreaterThanOrEqual(0);
  expect(idxHelp).toBeGreaterThan(idxStarter);

  // 共存回归:Tier1 `empty` 槽 fixture 与 Tier5 config.empty 同时在空态渲染。
  await expect(page.getByTestId("slot-empty")).toBeVisible();
});

test("regression: 无 empty 配置的 source 使用宿主默认标题", async ({ page }) => {
  await selectSource(page, "./examples/hello-agent");
  await expect(
    page.getByRole("heading", { name: "What can I help with?" }),
  ).toBeVisible();
});

test("webext background: 会话态浮动底栏无不透明渐隐色带(自定义背景)", async ({
  page,
}) => {
  await selectSource(page, "./examples/webext-background-agent");

  // 驱动一轮进入会话态 → 浮动底栏 dock 出现。
  await page.locator("[data-pi-input-textarea]").fill("hi");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-input-dock]")).toBeVisible();

  // 自定义背景在场 → 不渲染底栏不透明渐隐遮罩(否则 fade 到 hsl(var(--background))
  // 会在极光上盖出一条违和的纯色矩形带;输入框自身 frosted backdrop-blur 已提供分隔)。
  await expect(page.locator("[data-pi-input-dock-fade]")).toHaveCount(0);
  // 极光背景仍在。
  await expect(page.locator(".pw-webext-background-aurora")).toBeAttached();
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
