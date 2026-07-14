import { test, expect } from "@playwright/test";

/**
 * agent-declared-routes 浏览器级 e2e(spec agent-declared-routes task 5.2)。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。stub 装配期
 * 搭车 get_commands 就绪探针发 `agent_routes` 声明帧(演示 routes:
 * `gallery-stats` GET 定值 / `echo` POST 回显),主进程缓存为会话路由表并挂载
 * `/api/sessions/:id/agent-routes[...]` 端点。
 *
 * 断言面(requirements.md):
 *  - 2.6  经 Next catch-all(`app/api/sessions/[[...path]]/route.ts`)全链路可达,
 *         无「服务端已挂载但 HTTP 层静默 404」缺口(page.request 直打整站 URL)。
 *  - 6.1  GET 清单含演示 routes;GET gallery-stats 返回定值 JSON;POST echo 回显
 *         body 与 query。
 *  - 3.5/6.3 route 调用不向对话注入消息、UI 零可见变化(消息数不变 + 无错误提示)。
 *  - 4.1  鉴权/会话归属语义抽查:非法会话 id → 404(与既有会话级端点同门)。
 *  - 7.3  错误语义抽查:未声明名 404 ROUTE_NOT_FOUND / 方法白名单 405。
 *
 * 时序注意(tasks.md Implementation Notes):POST /sessions 的 201 先于就绪探针
 * 完成,声明帧搭车 get_commands 探针到达——首次 GET 清单前先等 UI 就绪
 * ([data-session-active])并对清单用 expect.poll 收敛,避免瞬时空清单误红。
 */

const SOURCE = "./examples/hello-agent";

async function startSession(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  const text = await page.locator("[data-session-id]").textContent();
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);
  return id;
}

/**
 * 等声明帧就位:清单端点可能在会话 201 之后、就绪探针完成之前短暂返回空数组,
 * 以 expect.poll 收敛到含 gallery-stats(系统性时序,非 stub 特有)。
 */
async function waitForDeclaredRoutes(
  page: import("@playwright/test").Page,
  id: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/sessions/${id}/agent-routes`);
        if (!res.ok()) return [];
        const json = (await res.json()) as {
          routes?: Array<{ name: string }>;
        };
        return (json.routes ?? []).map((r) => r.name);
      },
      { timeout: 15_000 },
    )
    .toContain("gallery-stats");
}

test("agent routes: 清单可发现 + 演示 route 调用(Next catch-all 全链路)→ 对话 UI 零变化", async ({
  page,
}) => {
  const id = await startSession(page);

  // 基线:route 调用前的对话消息数(新会话应为 0,但按数值快照比对更稳)。
  const messages = page.locator(
    "[data-pi-chat-messages] [data-pi-message-role]",
  );
  const baseline = await messages.count();

  // ① 清单(Req 2.5/2.6/6.1):等声明帧就位后,含两条演示 route 及各自方法白名单。
  await waitForDeclaredRoutes(page, id);
  const listRes = await page.request.get(`/api/sessions/${id}/agent-routes`);
  expect(listRes.status()).toBe(200);
  const list = (await listRes.json()) as {
    routes: Array<{ name: string; methods: string[] }>;
  };
  const byName = new Map(list.routes.map((r) => [r.name, r]));
  expect(byName.get("gallery-stats")?.methods).toEqual(["GET"]);
  expect(byName.get("echo")?.methods).toEqual(["POST"]);

  // ② GET 调用(Req 3.1/3.2/6.1):stub 定值 JSON 同步返回(原始 JSON 体,非信封)。
  const stats = await page.request.get(
    `/api/sessions/${id}/agent-routes/gallery-stats`,
  );
  expect(stats.status()).toBe(200);
  expect(await stats.json()).toEqual({ count: 3, source: "stub" });

  // ③ POST 调用(Req 3.1/3.2/6.1):body 与 query 双双回显(query 为扁平字符串投影)。
  const echo = await page.request.post(
    `/api/sessions/${id}/agent-routes/echo?tag=e2e&n=42`,
    { data: { a: 1 } },
  );
  expect(echo.status()).toBe(200);
  expect(await echo.json()).toEqual({
    echoed: { a: 1 },
    query: { tag: "e2e", n: "42" },
  });

  // ④ UI 零变化(Req 3.5/6.3):route 调用不触发 LLM 轮、不注入对话消息、无错误提示,
  //    输入区照常可用(既有对话流不受影响)。
  await expect(messages).toHaveCount(baseline);
  await expect(page.locator("[data-pi-chat-error]")).toHaveCount(0);
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
});

test("agent routes: 错误语义抽查(未声明名 404 / 方法白名单 405 / 非法会话 404)", async ({
  page,
}) => {
  const id = await startSession(page);
  await waitForDeclaredRoutes(page, id);

  // 未声明名 → 404 ROUTE_NOT_FOUND(Req 2.2;处理器只能经声明绑定可达,Req 4.4)。
  const unknown = await page.request.get(
    `/api/sessions/${id}/agent-routes/not-a-route`,
  );
  expect(unknown.status()).toBe(404);
  expect(
    ((await unknown.json()) as { error: { code: string } }).error.code,
  ).toBe("ROUTE_NOT_FOUND");

  // 方法不在该 route 声明集合 → 405(Req 2.3;gallery-stats 仅声明 GET)。
  const wrongMethod = await page.request.post(
    `/api/sessions/${id}/agent-routes/gallery-stats`,
  );
  expect(wrongMethod.status()).toBe(405);
  expect(
    ((await wrongMethod.json()) as { error: { code: string } }).error.code,
  ).toBe("METHOD_NOT_ALLOWED");

  // 非法会话 id → 404 SESSION_NOT_FOUND(Req 2.4/4.1:与既有会话级端点同门,
  // 会话归属/存在性由 Router `:id` 既有鉴权门统一裁定)。
  const bogus = await page.request.get(
    `/api/sessions/does-not-exist-e2e/agent-routes`,
  );
  expect(bogus.status()).toBe(404);
  expect(
    ((await bogus.json()) as { error: { code: string } }).error.code,
  ).toBe("SESSION_NOT_FOUND");
});
