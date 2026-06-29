import { test, expect } from "@playwright/test";

/**
 * 纯扩展命令的历史持久化(plugin-system-unification R13)浏览器验收。
 *
 * 真实浏览器 → 真实 Next server(PI_WEB_STUB_AGENT=1)→ 真实 handler/session/SSE 链。
 * 纯扩展命令(`/review`,只经 ctx.ui 反馈、不触发对话轮)此前 0 持久化:实时有乐观气泡、刷新即消失。
 * R13 让纯命令落 LLM-clean 的 `piweb.command` 标记,服务端 `GET /messages` 按时间序合并 surfacing,
 * 使冷恢复后该 `/review` 气泡仍在转录区——与实时一致。
 *
 * 流程:建会话 → 提交 `/review`(stub 纯命令 sentinel:不发 turn、写 piweb.command)→ 实时见气泡
 * → 删内存会话强制冷恢复 → 重开 /session/:id → 断言 `/review` 用户气泡仍在(修复前为空白)。
 *
 * 默认 fs 后端(playwright.config.ts 的 fs project)。surfacing 经 SessionEntryStore 抽象,后端无关。
 */

const SOURCE = "./examples/plugin-code-review-agent";

test("纯扩展命令 /review:实时可见 → 冷恢复历史仍可见(R13)", async ({ page }) => {
  // 建会话。
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();

  const text = await page.locator("[data-session-id]").textContent();
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);

  // 提交纯命令 /review。doSend 经 useChat 加乐观用户气泡;stub 不发 turn,server 的 R11
  // 命令-turn watcher 在窗口后合成 finish 解冻输入框(不冒空助手气泡)。
  await page.locator("[data-pi-input-textarea]").fill("/review");
  await page.locator('[data-pi-submit-state="send"]').click();

  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("/review"); // 实时乐观气泡

  // 输入框解冻(R11 finish 合成)→ 可再次发送状态回到 send。
  await expect(page.locator('[data-pi-submit-state="send"]')).toBeVisible();

  // 删内存会话强制冷恢复路径。
  const del = await page.request.delete(`/api/sessions/${id}`);
  expect(del.ok()).toBeTruthy();

  // 冷恢复:重开 URL → server 经 loadCommandMarkers 把 piweb.command 标记合并进历史。
  await page.goto(`/session/${id}`);
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(messages).toContainText("/review"); // 修复前此处为空白(0 持久化)
});
