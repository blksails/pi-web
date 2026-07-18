import { test, expect } from "@playwright/test";

/**
 * desktop-cloud-login(任务 7.4)· 门控关闭档 e2e —— 未启用云端登录时无登录入口(Req 4.2/7.3)。
 *
 * 跑在默认 fs server(**未设** PI_WEB_CLOUD_LOGIN_EGRESS_BASE)上:/api/auth/* 零注册、
 * GET /api/auth/me 返回 404 → 前端 useDesktopAuth 判定未启用 → 不渲染任何登录入口,
 * 行为与今日一致(本地路径可用)。
 */

test("未启用云端登录:头部渲染但无登录入口(Req 4.2)", async ({ page }) => {
  // 先进会话使应用外壳头部渲染,再断言头部里没有登录入口(证明是 gating 关闭而非头部缺失)。
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  // 头部主题/语言切换等控件在,但登录入口不渲染(auth.enabled=false)。
  await expect(page.getByTestId("login-open")).toHaveCount(0);
  await expect(page.getByTestId("login-status")).toHaveCount(0);
});

test("未启用时 /api/auth/me 返回 404(端点零注册,Req 4.2)", async ({ page }) => {
  const res = await page.request.get("/api/auth/me");
  expect(res.status()).toBe(404);
});
