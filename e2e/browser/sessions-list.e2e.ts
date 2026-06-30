import { test, expect } from "@playwright/test";

/**
 * Sessions List 浏览器 e2e(隔离 build + stub agent)。
 *
 * 覆盖关键用户路径(requirements.md):
 *  - 5.1/5.3  会话列表面板经宿主插槽(默认 sidebar)注入,与对话区共存。
 *  - 2.2      系统(全机器)视图默认关闭 → 前端无「全部」Tab(构建期未开 NEXT_PUBLIC_*)。
 *  - 2.3      后端门控:scope=all 默认关闭 → 403。
 *  - 1.1/3.x  当前目录列表含已持久化会话(经后端 API 断言,避开 cwd 推断)。
 *  - 4.1/4.2  从侧栏列表点击「恢复」→ 进入该会话并回放历史。
 *
 * 注:「全部」Tab 出现(开启态)需以 NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL=1 重新构建
 * (NEXT_PUBLIC_ 构建期内联),不在本默认构建的运行时可切换;此处验证关闭态前端 + 后端门控。
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

async function sendAndFinishTurn(
  page: import("@playwright/test").Page,
  message: string,
): Promise<void> {
  await page.locator("[data-pi-input-textarea]").fill(message);
  await page.locator('[data-pi-submit-state="send"]').click();
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(page.locator("[data-pi-interaction-resolved]")).toBeVisible();
}

test("panel injected via host sidebar slot; closed global view hides the 'all' tab", async ({
  page,
}) => {
  await startSession(page);
  // 面板注入(R5.1/5.3):侧栏出现会话列表,对话区(输入框)仍在、未被遮挡。
  await expect(page.locator("[data-pi-session-list]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  // 关闭态(R2.2):无「全部」Tab(构建期未开全局视图)。
  await expect(page.locator("[data-pi-session-list-tabs]")).toHaveCount(0);
});

test("backend gates scope=all and lists the current session's directory", async ({
  page,
  request,
}) => {
  // 门控(R2.3):系统范围默认关闭 → 403。
  const all = await request.get("/api/sessions?scope=all");
  expect(all.status()).toBe(403);

  // 持久化一轮会话;以 sessionId 解析「当前目录」应含之(R1.1/3.x)。
  const id = await startSession(page);
  await sendAndFinishTurn(page, "hello");
  const res = await request.get(`/api/sessions?sessionId=${id}`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    sessions: ReadonlyArray<{ sessionId: string }>;
    scope: string;
  };
  expect(body.scope).toBe("cwd");
  expect(body.sessions.map((s) => s.sessionId)).toContain(id);
});

test("new session appears in the sidebar after a turn, without reload", async ({
  page,
}) => {
  // 新建会话首屏:header 异步落盘,侧栏此刻可能不含该会话(既有竞态——其余用例靠 reload 绕过)。
  const id = await startSession(page);
  // 完成一轮 → 宿主 onTurnEnd 触发面板刷新;再完成一轮,使刷新必发生在首轮落盘之后(消除竞态)。
  await sendAndFinishTurn(page, "hello");
  await sendAndFinishTurn(page, "again");
  // 无需 reload:每轮结束后列表重拉当前 cwd 首页 → 该会话出现在侧栏(问题1:及时看到新会话)。
  await expect(
    page.locator(`[data-pi-session-list-resume="${id}"]`),
  ).toBeVisible();
});

test("resume a listed session from the sidebar", async ({ page }) => {
  // 建会话 A 并持久化一轮(header + 一回合落盘)。
  const idA = await startSession(page);
  await sendAndFinishTurn(page, "hello");

  // 冷恢复:reload /session/:id —— A 的 header 已在盘,侧栏据当前会话 cwd 可解析并列出 A
  // (避开新会话 header 异步落盘的竞态)。
  await page.reload();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  // 侧栏列表出现会话 A,点击该项(整行)直接恢复。
  const resumeA = page.locator(`[data-pi-session-list-resume="${idA}"]`);
  await expect(resumeA).toBeVisible();
  await resumeA.click();

  // 进入会话 A 并回放历史(R4.1/4.2)。
  await expect(page).toHaveURL(new RegExp(`/session/${idA}$`));
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("hello");
});
