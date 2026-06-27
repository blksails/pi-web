import { test, expect } from "@playwright/test";

/**
 * unified-command-result-layer 浏览器 e2e:统一命令通道(host 内置命令)。
 *
 * `/plugin` 已移除(扩展安装改为 agent 内置工具,spec extension-install-agent-tools),故本套件
 * 仅保留 `/clear` —— 验证 host 内置命令经命令通道分派、清空聊天视图(UI effect),且**不发任何
 * /messages 给 LLM**。
 */

async function startSession(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

test("/clear:经命令通道清空聊天视图(UI effect),不作为消息发给 LLM", async ({
  page,
}) => {
  // 捕获是否发出过 prompt(/messages)——host 命令绝不进 LLM。
  let sentMessage = false;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/sessions\/[^/]+\/messages$/.test(r.url())) {
      sentMessage = true;
    }
  });

  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  const messages = page.locator("[data-pi-chat-messages]");

  // 先发一条普通消息建立可视记录;等该轮完成(stub 终值出现)再继续,避免 busy 态下
  // 命令面板/命令未就绪。
  await input.click();
  await input.fill("hello there");
  await page.keyboard.press("Enter");
  await expect(messages).toContainText("hello there");
  await expect(messages).toContainText("Hello from the stub agent", {
    timeout: 15000,
  });

  // /clear 是 host 内置命令:键入后等面板项就绪,单次 Enter 选中即分派(执行 host 命令)。
  sentMessage = false; // 仅关心 /clear 阶段是否误发 prompt
  await input.fill("/clear");
  await expect(page.locator('[data-pi-command-item="clear"]')).toBeVisible({
    timeout: 10000,
  });
  await page.keyboard.press("Enter");

  // UI effect: 聊天视图被清空(clear-transcript → setMessages([]))——之前的 "hello there"
  // 从页面消失(清空后会话回到空态,messages 容器移除,故按整页文本计数为 0)。
  await expect(page.getByText("hello there", { exact: false })).toHaveCount(0, {
    timeout: 20000,
  });
  // /clear 不作为消息发给 LLM(命令通道分派,无 /messages POST)。
  expect(sentMessage).toBe(false);
});
