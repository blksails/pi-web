import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * webext-empty-state-config 浏览器 e2e:
 * 纯声明式 `config.empty`(零 bundle)经 webext-registry → chat-app → <PiChat> 驱动空态
 * (EmptyState)标题/副标题/建议项,并按 mergeCommands 与 agent slash 命令(stub:/help、/clear)
 * 合并。复用与 webext.e2e 相同的 stub agent 装配(无 LLM)。
 */

async function activate(page: Page, source: string): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

function gridButtonTexts(page: Page) {
  return page
    .locator('[data-pi-suggestions-layout="grid"] button')
    .allTextContents();
}

test("empty config prepend: 配置标题/副标题渲染,建议项排在 agent 命令之前", async ({
  page,
}) => {
  await activate(page, "./examples/webext-empty-config-agent");

  // 标题/副标题取自声明式 config.empty。
  await expect(
    page.getByRole("heading", { name: "需要我帮忙吗?" }),
  ).toBeVisible();
  await expect(page.getByText("选择一个起点,或直接提问。")).toBeVisible();

  // 配置建议项与 agent 命令(/help、/clear)都出现;等两者都就绪再断言顺序。
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
  expect(idxHelp).toBeGreaterThan(idxStarter); // prepend:配置项在命令之前
});

test("empty config replace: 仅展示配置建议项,隐藏 agent 命令", async ({
  page,
}) => {
  await activate(page, "./examples/webext-empty-replace-agent");

  await expect(
    page.getByRole("heading", { name: "只看这几个入口" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-pi-suggestions-layout="grid"] button', {
      hasText: "开始一个新任务",
    }),
  ).toBeVisible();

  // 给 getCommands 充分加载时间,确认命令是被 replace 丢弃(而非尚未到达)。
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator('[data-pi-suggestions-layout="grid"] button', {
      hasText: "/help",
    }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-pi-suggestions-layout="grid"] button', {
      hasText: "/clear",
    }),
  ).toHaveCount(0);
});

test("regression: 无 empty 配置的 source 使用宿主默认标题", async ({ page }) => {
  await activate(page, "./examples/hello-agent");
  await expect(
    page.getByRole("heading", { name: "What can I help with?" }),
  ).toBeVisible();
});
