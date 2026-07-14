import { test, expect } from "@playwright/test";

/**
 * 统一插件包标准(plugin-system-unification)浏览器验收。
 *
 * 真实浏览器 → 真实 pi-web server(PI_WEB_STUB_AGENT=1)→ 真实 handler/session/SSE 链。
 * examples/plugin-code-review-agent 是统一插件包(pi-plugin.json + pi 扩展 code_review 工具
 * + .pi/web webext Tier2 渲染器)。验证「扁平双层咬合」(Req 3/8):
 *   pi 侧产出的 `code_review` 工具 part 由 webext 的 renderers.tools.code_review
 *   接管,渲染为富卡 CodeReviewCard(data-testid="code-review-card"),替代默认工具卡。
 *
 * 触发:prompt 含 sentinel `code-review` → stub 额外发一个 code_review 工具调用
 * (result.details.findings 两项)。
 */
test("统一插件:pi 工具 code_review 由 webext Tier2 渲染器渲染为富卡(两层咬合)", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/plugin-code-review-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();
  await input.fill("please run a code-review on this snippet");
  await page.locator('[data-pi-submit-state="send"]').click();

  // 两层咬合:code_review 工具命中扩展自定义渲染器 → 富卡渲染。
  const card = page.getByTestId("code-review-card").first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("代码检视");

  // findings 经 tool 输出 details 渲染为列表(两项)。
  const findings = card.getByTestId("code-review-findings").locator("li");
  await expect(findings).toHaveCount(2);
});
