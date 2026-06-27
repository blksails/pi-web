import { test, expect } from "@playwright/test";

/**
 * 会话就绪握手 browser e2e(spec session-readiness-handshake, Task 5.2)。
 *
 * Real browser → real Next server(PI_WEB_STUB_AGENT=1,readinessHandshake 默认开)→ 真实
 * handler/session/SSE。验证门控全链路在真实浏览器中:
 *  - 选源后会话就绪门控开启,就绪后发送按钮启用(无 false error 指示)
 *  - 就绪后发送 prompt 收到流式回复(证明 ready→发送的闭环未被门控破坏)
 *
 * 注:stub agent 对探针 get_commands 即时应答,就绪近乎瞬时,故"连接中"指示为瞬态、不作硬断言;
 * 其确定性覆盖在 ui 单测 pi-chat-readiness 与 server 集成测试 readiness.integration。
 */
test("session readiness: 门控开启下就绪后可发送并流式回复,无 false error", async ({
  page,
}) => {
  await page.goto("/");

  // 选源 → 启动 hello-agent 会话。
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();

  // 会话激活。
  await expect(page.locator("[data-session-active]")).toBeVisible();

  // 不应出现就绪错误指示(探针对 stub 正常应答 → 不会 error)。
  await expect(
    page.locator('[data-pi-session-readiness="error"]'),
  ).toHaveCount(0);

  // 输入区可编辑 + 发送按钮最终启用(门控在就绪后放行)。
  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();
  await input.fill("say hello");

  // 发送态按钮可点(Playwright 自动等待 actionable;门控未就绪时禁用会令其等待至就绪)。
  await page.locator('[data-pi-submit-state="send"]').click();

  // 流式回复抵达 → 证明就绪门控放行后闭环正常。
  const messages = page.locator("[data-pi-chat-messages]");
  await expect(messages).toContainText("Hello");

  // 收尾仍无就绪错误指示。
  await expect(
    page.locator('[data-pi-session-readiness="error"]'),
  ).toHaveCount(0);
});
