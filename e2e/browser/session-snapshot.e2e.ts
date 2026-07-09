import { test, expect } from "@playwright/test";

/**
 * session-snapshot-authority browser e2e(Req 5.2, 7.4)。
 *
 * Real browser → real pi-web server(PI_WEB_STUB_AGENT=1,snapshotAuthority 生产默认开)→
 * 真实 handler/session/SSE。验证**权威 busy 抵达 DOM**:
 *  - 发 prompt → 轮次开始 → data-pi-busy="true"(来自服务端 session-state,非 useChat.status 推断)
 *  - 应答权限对话 → 轮次结束 → data-pi-busy="false"(不卡死)
 *
 * 这是 node e2e(session-snapshot.e2e.test.ts)的真实 DOM 对应物:node 证明帧管线,
 * 此处证明前端纯投影 ControlStore → useSyncExternalStore → PiChat → DOM 的最后一格。
 */
test("authoritative busy reaches the DOM: true during turn, false after turn end", async ({
  page,
}) => {
  await page.goto("/");

  // 选源 → 启动 hello-agent 会话。
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();

  // 发送前:无活跃轮次 → 权威 busy=false。
  await expect(page.locator("[data-pi-busy]")).toHaveAttribute("data-pi-busy", "false");

  // 发 prompt → 轮次开始,流到权限对话暂停;此间权威 busy=true。
  await input.fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-busy]")).toHaveAttribute("data-pi-busy", "true");

  // 权限对话出现 → 应答 → 轮次恢复并结束。
  await expect(page.locator("[data-pi-interaction-active]")).toBeVisible();
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("Continuing");

  // 轮次结束:权威 busy 回落 false(不卡死)。
  await expect(page.locator("[data-pi-busy]")).toHaveAttribute("data-pi-busy", "false");
});
