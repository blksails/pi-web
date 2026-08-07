/**
 * 桌面 AIGC 出口 — 端到端(spec desktop-aigc-egress 任务 5.2)。
 *
 * 对**真实** pi-web server(云端登录已启用 + egress base 指向可达的假 cloud)运行,验证:
 *   登录 → capabilities 下发 `gateway` 授予 → 合成网关实例 → 目录聚合真的去拉
 *   `${裸基址}/v1/models` → 网关模型出现在模型目录里;登出 → 随之消失。
 *
 * ## 为什么这条 e2e 值得存在
 *
 * 单测与集成测试都在**同进程**里用真实函数拼链路,唯独证明不了两件事:
 *  1. 装配点是否真的把授予接进了目录聚合(接线漏了,单测照样全绿);
 *  2. 拼出来的地址是否真能被服务端发出去(`/v1/v1` 只在真发请求时才现形)。
 * 假 cloud 的 `/v1/models` 端点同时校验 **Bearer 必须是桌面凭据**,故"本地只出示桌面凭据"
 * 这一安全不变式在这里也被真正验到,而不只是断言了一个字符串。
 *
 * 复用 registry 档的 webServer(见 playwright.config.ts):它已配好登录启用 + 可达假 cloud。
 */
import { test, expect } from "@playwright/test";

/** 目录是 stale-while-revalidate:首拉恒为空,须轮询到刷新完成(既有行为,非缺陷)。 */
async function pollModels(
  request: import("@playwright/test").APIRequestContext,
  predicate: (models: unknown[]) => boolean,
  timeoutMs = 15_000,
): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown[] = [];
  while (Date.now() < deadline) {
    const res = await request.get("/api/config/models");
    if (res.ok()) {
      const body = (await res.json()) as { models?: unknown[] };
      last = body.models ?? [];
      if (predicate(last)) return last;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

function providersOf(models: unknown[]): string[] {
  return models.map((m) => (m as { provider?: string }).provider ?? "");
}

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("login-page")).toBeVisible();
  await page.getByTestId("login-email").fill("dev@example.com");
  await page.getByTestId("login-password").fill("whatever");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-page")).toBeHidden();
}

test.afterEach(async ({ page }) => {
  // 登录态是**进程级**的:不重置会泄漏给后续用例(既有 e2e 已踩过这个坑)。
  await page.request.delete("/api/auth/session").catch(() => undefined);
});

test.describe("桌面登录态的网关模型", () => {
  test("★ 登录后网关来源模型进入模型目录,且归属为实例标识", async ({ page }) => {
    // 登录前:目录里不应有网关来源条目。
    const before = await pollModels(page.request, () => true, 2_000);
    expect(providersOf(before)).not.toContain("blksails-cloud");

    await login(page);

    // 登录后:授予 → 实例 → 目录聚合去拉假 cloud 的 /v1/models。
    const after = await pollModels(page.request, (models) =>
      providersOf(models).includes("blksails-cloud"),
    );
    const ids = after.map((m) => (m as { id?: string; model?: string }).id ?? (m as { model?: string }).model ?? "");
    expect(providersOf(after), "网关实例应作为 provider 出现").toContain("blksails-cloud");
    expect(ids.join(","), "假 cloud 目录里的模型应出现").toContain("fake-cloud-chat-model");
  });

  test("★ 登出后网关来源模型从目录消失(不留可调用窗口)", async ({ page }) => {
    await login(page);
    const after = await pollModels(page.request, (models) =>
      providersOf(models).includes("blksails-cloud"),
    );
    expect(providersOf(after)).toContain("blksails-cloud");

    await page.request.delete("/api/auth/session");

    const afterLogout = await pollModels(
      page.request,
      (models) => !providersOf(models).includes("blksails-cloud"),
      10_000,
    );
    expect(providersOf(afterLogout)).not.toContain("blksails-cloud");
  });
});
