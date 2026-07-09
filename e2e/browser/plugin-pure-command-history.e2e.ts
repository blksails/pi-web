import { test, expect } from "@playwright/test";

/**
 * registerCommand 扩展命令 = 动作:无气泡、不进历史(plugin-system-unification R15)。
 *
 * 真实浏览器 → 真实 pi-web server(PI_WEB_STUB_AGENT=1)→ 真实 handler/session/SSE 链。
 * registerCommand 命令(`/review`,只经 ctx.ui 反馈、不触发对话轮)是**动作**而非对话:前端对 source=
 * "extension" 命令 fire-and-forget 投递(不经 useChat)——**不渲染用户气泡、不进消息历史**;反馈仅靠
 * ctx.ui(notify 经临时控制流渲染)。冷恢复后转录区无任何命令痕迹。
 *
 * 流程:建会话 → 提交 `/review` → 断言①ctx.ui notify 出现 ②转录区**无** `/review` 气泡 → 删内存会话
 * 冷恢复 → 断言转录区仍**无** `/review`(动作不留历史)。
 *
 * stub:COMMANDS 暴露 `review`(source:"extension");handlePrompt `/review` 分支只发 notify、不持久、不发 turn。
 */

const SOURCE = "./examples/plugin-code-review-agent";

test("registerCommand /review:无气泡 + ctx.ui 反馈 + 不进历史(R15)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();

  const text = await page.locator("[data-session-id]").textContent();
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);

  // 提交 registerCommand 命令 /review(source:"extension")→ 前端 fire-and-forget,无气泡。
  await page.locator("[data-pi-input-textarea]").fill("/review");
  await page.locator('[data-pi-submit-state="send"]').click();

  // ① ctx.ui notify 渲染(经临时控制流);② 转录区**无任何消息气泡**——命令是动作不是消息,
  // 故 data-pi-chat-empty 仍为 "true"(注:"/review" 会作为命令建议按钮出现在 suggestions 区,
  // 不是用户气泡,故不能用字符串缺席断言;用空转录区标记精确判定)。
  await expect(page.getByText("代码检视完成:发现 2 个问题")).toBeVisible();
  await expect(
    page.locator('[data-pi-chat-pro][data-pi-chat-empty="true"]'),
  ).toBeVisible();

  // 冷恢复:删内存会话 → 重开 → 转录区仍空(动作不留历史痕迹)。
  const del = await page.request.delete(`/api/sessions/${id}`);
  expect(del.ok()).toBeTruthy();
  await page.goto(`/session/${id}`);
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(
    page.locator('[data-pi-chat-pro][data-pi-chat-empty="true"]'),
  ).toBeVisible();
});

/**
 * skill 命令历史显示一致(R14)。
 *
 * `/skill:<name>` 经 SDK `_expandSkillCommand` 展开成 `<skill name="…">…</skill>` 块当 prompt 持久化:
 * 实时乐观气泡显示短命令 `/skill:<name>`,但 `get_messages` 历史回放取出的是展开块——直接渲染会显示
 * 一大段 SKILL.md 正文,与发送当下不一致。R14 在 agent-message-to-ui 的 collapseSkillExpansion 把展开块
 * 折叠回 `/skill:<name>`,使历史用户气泡与实时一致。
 *
 * stub 镜像 SDK 展开(持久化展开块为 user 消息)以离线复现该不一致。
 */
test("skill 命令 /skill::实时短命令 → 冷恢复历史折叠回同一短命令(R14)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();

  const text = await page.locator("[data-session-id]").textContent();
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);

  await page.locator("[data-pi-input-textarea]").fill("/skill:code-review-skill");
  await page.locator('[data-pi-submit-state="send"]').click();

  const messages = page.locator("[data-pi-chat-messages]");
  // 实时:短命令气泡 + 助手回复;不应出现展开块正文。
  await expect(messages).toContainText("/skill:code-review-skill");
  await expect(messages).toContainText("Skill expanded and answered");
  await expect(messages).not.toContainText("这是 stub 展开的 skill 正文");

  // 冷恢复:历史取出展开块,经 collapseSkillExpansion 折叠回短命令。
  const del = await page.request.delete(`/api/sessions/${id}`);
  expect(del.ok()).toBeTruthy();
  await page.goto(`/session/${id}`);
  await expect(page.locator("[data-session-active]")).toBeVisible();
  // 关键:历史仍显示短命令,而非展开块正文(修复前此处会显示 `<skill …>` 大段正文)。
  await expect(messages).toContainText("/skill:code-review-skill");
  await expect(messages).not.toContainText("这是 stub 展开的 skill 正文");
  await expect(messages).toContainText("Skill expanded and answered"); // 助手历史
});
