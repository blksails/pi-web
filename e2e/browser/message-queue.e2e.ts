import { test, expect } from "@playwright/test";

/**
 * message-queue-ui browser e2e —— 忙时排队 → 可视化 → 取回 全回环(Req 1.1/1.2/2.2/3.2)。
 *
 * Real browser → real Next server(PI_WEB_STUB_AGENT=1)→ 真实 handler/session/SSE/clear_queue 端点。
 * stub 的 `queue-hold` 哨兵开一个不结束的 busy 轮次(无阻塞对话框);忙时 steer/follow_up 命令累积
 * 并回发 queue_update →(server 双帧)control:"queue" → control-store → usePiControls().queue → 队列面板。
 * Esc 触发 clearQueue(POST /clear_queue → PiSession 关联 → stub 回 piweb_clear_queue_result)取回回填编辑器。
 */
test("busy queue → visualize → retrieve closed loop", async ({ page }) => {
  await page.goto("/");

  // 选源 → 启动 hello-agent 会话。
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();

  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();

  // 开一个挂起 busy 轮次(queue-hold 哨兵)→ 权威 busy=true,无对话框。
  await input.fill("queue-hold please");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-busy]")).toHaveAttribute("data-pi-busy", "true");

  // 忙时 Enter → steering 排队 → 队列面板出现,pending 计数 1。
  await input.fill("first steering");
  await input.press("Enter");
  await expect(page.locator("[data-pi-queue-count]")).toHaveAttribute(
    "data-pi-queue-count",
    "1",
  );

  // 忙时 Alt+Enter → follow-up 排队 → pending 计数 2。
  await input.fill("then a follow up");
  await input.press("Alt+Enter");
  await expect(page.locator("[data-pi-queue-count]")).toHaveAttribute(
    "data-pi-queue-count",
    "2",
  );

  // Esc 取回 → 编辑器回填(先 steering 后 followUp,换行连接),队列面板清空隐藏。
  await input.press("Escape");
  await expect(input).toHaveValue("first steering\nthen a follow up");
  await expect(page.locator("[data-pi-queue]")).toHaveCount(0);
});
