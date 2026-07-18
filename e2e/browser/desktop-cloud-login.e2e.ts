import { test, expect } from "@playwright/test";

/**
 * desktop-cloud-login(任务 7.4)· 浏览器 e2e —— 登录/登出/切号/失败 UI 全链。
 *
 * 对真实 pi-web server(云端登录**已启用**档:设 PI_WEB_CLOUD_LOGIN_EGRESS_BASE + MODELS)+
 * 离线 stub agent 运行。登录态管理不需真实模型调用(主对话经 egress 由集成测试 7.2 覆盖),故
 * 此处只验登录状态机 + UI + gating-on。前端全程不接触 sk-gw(B-pure:sk-gw 云端换取,浏览器
 * 只经 /api/auth/* 传桌面凭据,不触达网关数据面)。
 *
 * 桌面凭据形态(外部契约):`base64url(JSON({userId,companyId,scope,exp}))+"."+<sig>`;server 只
 * 解 payload、验签在云端,故 e2e 可用远期 exp 的样例凭据驱动登录态。
 */

/** 造一枚样例桌面凭据(远期 exp;sig 内容 server 不校验)。 */
function makeCredential(userId: string, companyId: string): string {
  const payload = { userId, companyId, scope: "desktop", exp: 4_000_000_000 };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.e2esig`;
}
/** 已过期凭据(exp 在过去)。 */
function makeExpired(): string {
  const payload = { userId: "u-exp", companyId: "co", scope: "desktop", exp: 1000 };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.e2esig`;
}

const CRED_A = makeCredential("user-alice", "co-alpha");
const CRED_B = makeCredential("user-bob", "co-beta");

/** 选一个 source 进入会话,使应用外壳头部(含登录入口)渲染。 */
async function enterApp(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await enterApp(page);
  // 登录入口在应用头部;启用档下应出现(auth.enabled=true,Req 1.1)。
  await expect(page.getByTestId("login-open")).toBeVisible();
});

// server 端登录态是**进程级单例**(设计:一桌面用户一进程)。e2e 复用同一 server 进程,故每个
// 用例后必须显式清除,避免上一个用例的登录态泄漏到下一个用例的 beforeEach(否则看到已登录态)。
test.afterEach(async ({ page }) => {
  await page.request.delete("/api/auth/session");
});

test("登录 → 展示用户标识,登出 → 回到登录入口(Req 1.1/1.2/1.3/2.5)", async ({ page }) => {
  await page.getByTestId("login-open").click();
  await page.getByTestId("login-credential").fill(CRED_A);
  await page.getByTestId("login-submit").click();

  // 登录态:展示用户标识(Req 1.3)。
  await expect(page.getByTestId("login-status")).toBeVisible();
  await expect(page.getByTestId("login-user")).toHaveText("user-alice");

  // 登出 → 回到登录入口(Req 2.5)。
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-open")).toBeVisible();
  await expect(page.getByTestId("login-status")).toHaveCount(0);
});

test("切号:登录 A → 登出 → 登录 B,展示 B 身份(Req 6.2)", async ({ page }) => {
  await page.getByTestId("login-open").click();
  await page.getByTestId("login-credential").fill(CRED_A);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-user")).toHaveText("user-alice");

  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-open")).toBeVisible();

  await page.getByTestId("login-open").click();
  await page.getByTestId("login-credential").fill(CRED_B);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-user")).toHaveText("user-bob");
});

test("过期凭据 → 可读错误,不进登录态(Req 1.5)", async ({ page }) => {
  await page.getByTestId("login-open").click();
  await page.getByTestId("login-credential").fill(makeExpired());
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
  await expect(page.getByTestId("login-status")).toHaveCount(0);
});

test("取消登录 → 不写入任何态(Req 1.4)", async ({ page }) => {
  await page.getByTestId("login-open").click();
  await page.getByTestId("login-credential").fill(CRED_A);
  await page.getByTestId("login-cancel").click();
  // 回到未登录入口,未产生登录态。
  await expect(page.getByTestId("login-open")).toBeVisible();
  await expect(page.getByTestId("login-status")).toHaveCount(0);
});

test("前端全程不接触 sk-gw(B-pure 不变式,Req 5.1)", async ({ page }) => {
  const bodies: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    // 断言前端从不直接打网关数据面(/v1/chat/completions 之类)。
    expect(url).not.toContain("/v1/chat/completions");
    if (req.method() === "POST" && url.includes("/api/auth/")) {
      bodies.push(req.postData() ?? "");
    }
  });
  await page.getByTestId("login-open").click();
  await page.getByTestId("login-credential").fill(CRED_A);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-user")).toHaveText("user-alice");
  // 请求体只含桌面凭据,绝无 sk-gw(以 `sk-gw-` 前缀为特征)。
  for (const b of bodies) expect(b).not.toContain("sk-gw-");
});
