import { test, expect } from "@playwright/test";

/**
 * webext-package-install 浏览器 e2e:运行时(非构建期)加载 Tier5 纯声明 webext。
 *
 * 夹具 `webext-runtime-declarative-agent` **刻意不在构建期注册表**(webext-registry)。
 * 故其 config 只能经「构建期未命中 → /api/webext/resolve 运行时解析 → loadExtension
 * declarative 分支 → applyExtension」生效。断言:
 *   - documentTitle 取自运行时加载的 config(而非 source 派生名)→ 证明运行时路径生效;
 *   - config.theme 经宿主注入(data-pi-ext-theme)。
 * 复用与其它 webext spec 相同的 stub agent 装配(无 LLM)。
 */
test("运行时声明式 webext:构建期未命中 → /api/webext/resolve 加载并应用 config", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await expect(page).toHaveTitle("pi-web");

  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-runtime-declarative-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();

  // 运行时加载证据:标题取自运行时 config.documentTitle(非 source 派生名)。
  await expect(page).toHaveTitle("Runtime Declarative · pi-web");
  // config.theme 经宿主注入。
  await expect(page.locator("[data-pi-ext-theme]")).toBeAttached();
  // 默认聊天界面仍可用(纯声明零 bundle)。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
});

test("运行时代码 webext:签名 .mjs 经 import map 单例动态加载并渲染 Tier1 slot", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator("[data-agent-source-input]")
    .fill("./examples/webext-runtime-code-agent");
  await page.locator("[data-agent-source-submit]").click();

  await expect(page.locator("[data-session-active]")).toBeVisible();
  // 代码 .mjs 经服务端验签 → import map 单例 → 动态 import → applyExtension → slot 渲染。
  await expect(page.getByTestId("runtime-code-panel")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("runtime-code-header")).toContainText(
    "Runtime Code Agent",
  );
});

test("解析端点直查:运行时夹具返回 found + 已背书声明式 manifest", async ({
  request,
}) => {
  const res = await request.get(
    "/api/webext/resolve?source=" +
      encodeURIComponent("./examples/webext-runtime-declarative-agent"),
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    found: boolean;
    manifest?: { id?: string; signaturePreVerified?: boolean };
    baseUrl?: string;
  };
  expect(body.found).toBe(true);
  expect(body.manifest?.id).toBe("webext-runtime-declarative");
  expect(body.manifest?.signaturePreVerified).toBe(true);
  expect(body.baseUrl).toContain("/api/webext/dist/");
});
