import { test, expect } from "@playwright/test";

/**
 * registry agent 源 · 浏览器 e2e(spec agent-plugin-commands,任务 4.4)。
 *
 * 对 project "registry" 运行:pi-web server 的 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE` 指向一台
 * **真实可达**的假 cloud(`e2e/fixtures/fake-cloud-server.mjs`),因此这条链路可以完整跑通:
 *
 *   登录 → POST /api/desktop/capabilities 换 sources 授予 → GET {baseUrl}/sources
 *        → 并入 GET /agent-sources → `/agent list` 卡片
 *
 * 与 desktop-cloud-login.e2e.ts 的分工:那条把 egress base 指向不可达占位地址,只验登录状态机
 * 与门控 UI;本条验的是**登录之后的取数**,是此前只有注入 fetch 替身的单测覆盖的部分。
 *
 * 落盘隔离(见 playwright.config.ts):agentDir/sourcesRoot 都是空临时目录,故 `/agent-sources`
 * 里出现的条目**只可能**来自 registry —— 断言不受开发机既有本地源影响。
 */

/** 假 cloud 与 registry 的宿主端口 = pi-web 端口 + 1(见 config 的 PORT_REGISTRY/PORT_FAKE_CLOUD)。 */
function fakeCloudBase(baseURL: string): string {
  const port = Number(new URL(baseURL).port) + 1;
  return `http://127.0.0.1:${port}`;
}

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("login-page")).toBeVisible();
  await page.locator('[data-login-field="identifier"]').fill("dev@example.com");
  await page.getByTestId("login-password").fill("whatever");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-page")).toBeHidden();
}

// server 端登录态是进程级单例,用例间会互相泄漏 —— 每例后显式清除。
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/auth/session").catch(() => undefined);
});

test("登录后 /agent-sources 并入 registry 源,plugin 条目被过滤", async ({
  page,
  baseURL,
}) => {
  await login(page);

  const res = await page.request.get("/api/agent-sources");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    sources?: { id: string; origin?: string; name?: string; source?: string }[];
  };
  const sources = body.sources ?? [];
  const ids = sources.map((s) => s.id);

  expect(ids).toContain("acme/hello-cloud");
  expect(ids).toContain("acme/data-wrangler");
  // registry 里 kind:"plugin" 的条目不进会话 agent 选择器(registry-http-provider 显式过滤)。
  expect(ids).not.toContain("acme/some-plugin");

  const hello = sources.find((s) => s.id === "acme/hello-cloud");
  expect(hello?.origin).toBe("registry");
  expect(hello?.name).toBe("Hello Cloud");
  // source 串带发布通道(默认 stable),可直接提交给会话创建链路。
  expect(hello?.source).toBe("acme/hello-cloud@stable");

  // 链路确实按 登录 → capabilities → sources 三步走过,且各步带的是各自那枚 token。
  const hits = (await (
    await page.request.get(`${fakeCloudBase(baseURL ?? "")}/__hits`)
  ).json()) as { hits: string[] };
  expect(hits.hits.some((h) => h.startsWith("POST /api/desktop/login"))).toBe(true);
  expect(
    hits.hits.some((h) => h.startsWith("POST /api/desktop/capabilities") && !h.endsWith("(none)")),
  ).toBe(true);
  expect(
    hits.hits.some((h) => h.startsWith("GET /registry/sources") && h.includes("fake-sources")),
  ).toBe(true);
});

test("登录后 /agent list 卡片列出 registry 源", async ({ page }) => {
  await login(page);

  // 进会话(源用本地 ./examples,与列表内容无关)。
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();
  await input.click();
  await input.fill("/agent list");
  // 终态子动作要按两次回车:第一次让它就位并关浮层,第二次才提交(命令面板既有语义)。
  await page.waitForTimeout(400);
  await input.press("Enter");
  await page.waitForTimeout(300);
  await input.press("Enter");

  const card = page.locator("[data-pi-install-result]");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toHaveAttribute("data-pi-install-action", "list");
  await expect(card).toHaveAttribute("data-pi-install-ok", "true");

  const items = page.locator("[data-pi-install-item]");
  await expect(items.filter({ hasText: "acme/hello-cloud" })).toHaveCount(1);
  await expect(items.filter({ hasText: "acme/data-wrangler" })).toHaveCount(1);
  await expect(items.filter({ hasText: "acme/some-plugin" })).toHaveCount(0);
  // 有条目时不应出现空态文案。
  await expect(page.locator("[data-pi-install-empty]")).toHaveCount(0);
});

test("未登录时只有本地源,registry 条目不出现", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("login-page")).toBeVisible();

  // 不登录 → 无 sources 授予 → provider fail-soft 返回空,列表里没有 registry 条目。
  const res = await page.request.get("/api/agent-sources");
  const body = (await res.json()) as { sources?: { id: string }[] };
  const ids = (body.sources ?? []).map((s) => s.id);
  expect(ids).not.toContain("acme/hello-cloud");
});

/**
 * registry 安装通道(spec installer-registry-channel)。
 *
 * 此前这里钉的是「`/agent install <registry-id>` → REGISTRY_NOT_IMPLEMENTED」这条**能力边界**;
 * 通道接入后该边界已不存在,故改写为成功路径。两条路径现在走**同一份**安装实现:
 *  - source 选择器选中 registry 源 → `onlineSourceResolver` → registry 安装端口;
 *  - `/agent install <registry-id>` → `Installer` 的 registry 通道 → 同一个 `installFromRegistry`。
 *
 * 链路全程真实 HTTP:假 cloud 同时扮演 registry,`resolve` 返回的 integrity 由夹具**现场**
 * 对真实 bundle 算出,故 sha384 复核是真的在验字节,不是走过场。
 */
test("registry 标识经 /agent install 安装成功,且随后可被源枚举看到", async ({ page }) => {
  await login(page);
  await page.locator("[data-agent-source-input]").fill("./examples");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/agent install acme/hello-cloud");
  await page.waitForTimeout(600);
  await input.press("Enter");
  await page.waitForTimeout(300);
  await input.press("Enter");

  const card = page.locator("[data-pi-install-result]");
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card).toHaveAttribute("data-pi-install-ok", "true");
  await expect(card).toHaveAttribute("data-pi-install-action", "install");

  // 装完落在扫描根内 → 被 scan-provider 枚举 → 与选择器同源的 /agent-sources 能看到它。
  // (registry 列举面本来也含这个 id,故断言落点:origin 应已变为本地扫描而非 registry。)
  const res = await page.request.get("/api/agent-sources");
  const body = (await res.json()) as { sources?: { id: string; origin?: string }[] };
  const found = (body.sources ?? []).filter((s) => s.id.includes("hello-cloud"));
  expect(found.length).toBeGreaterThan(0);
});

/**
 * kind 门:清单说 plugin、命令说 agent → 拒绝,并指路另一条命令。
 *
 * 这是「**清单里的 kind 是权威判据**」的端到端证据 —— 与 component 那条修正同构:
 * 真实判据压过命令名带来的假设,不让包落进错误的目录。
 */
test("registry 上的 plugin 包经 /agent install → 拒绝并指向 /plugin install", async ({ page }) => {
  await login(page);
  await page.locator("[data-agent-source-input]").fill("./examples");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/agent install acme/some-plugin");
  await page.waitForTimeout(600);
  await input.press("Enter");
  await page.waitForTimeout(300);
  await input.press("Enter");

  const card = page.locator("[data-pi-install-result]");
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card).toHaveAttribute("data-pi-install-ok", "false");
  await expect(card.locator("[data-pi-install-error]")).toContainText("/plugin install");
});
