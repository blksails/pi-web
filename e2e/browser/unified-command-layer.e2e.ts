import { test, expect } from "@playwright/test";
import * as path from "node:path";

/**
 * unified-command-result-layer 浏览器 e2e:统一命令通道(决策 A,host 侧)。
 *
 * 验证 `/plugin install <源>` 经 ui-rpc command 通道在**服务端同步执行**,结果经 HTTP 响应体
 * 回流驱动面板刷新(事件驱动,非 refreshKey/手动时序),且**不发任何 /messages 给 LLM**。
 * 需服务端以 PI_WEB_EXT_ADMIN_ALLOW_ANY=1 + PI_WEB_EXT_ALLOW_LOCAL=1 启动(见 e2e 运行说明)。
 */

async function startSession(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill("./examples/hello-agent");
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

test("键入 /plugin install:命令通道执行 → 面板事件驱动显示已装项,且不进 LLM", async ({
  page,
}) => {
  const src = `local:${path.resolve("examples/aigc-agent")}`;

  // 捕获是否发出过 prompt(/messages)——host 命令绝不进 LLM。
  let sentMessage = false;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/sessions\/[^/]+\/messages$/.test(r.url())) {
      sentMessage = true;
    }
  });

  await startSession(page);

  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill(`/plugin install ${src}`);
  await page.keyboard.press("Enter");

  // 分派而非发送:输入清空、对话区无该命令文本。
  await expect(input).toHaveValue("");

  // 命令结果事件驱动:面板打开并最终显示已安装的 aigc-agent(经 control 同步响应刷新列表)。
  await expect(page.locator('[data-testid="plugin-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="plugin-list"]')).toContainText("aigc-agent", {
    timeout: 20000,
  });

  // 全程未发 /messages 给 LLM。
  expect(sentMessage).toBe(false);
});

test("面板内安装非法来源:命令通道返回失败 → 错误反馈可见(非静默)", async ({
  page,
}) => {
  await startSession(page);

  // 经命令通道打开面板(/plugin 无子命令)。
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("/plugin");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="plugin-panel"]')).toBeVisible();

  // 面板内安装一个白名单外来源 → host 命令返回 effect:notify(失败文案),错误区可见。
  await page.locator('[data-testid="plugin-install-source"]').fill("npm:@evil/pkg@1.0.0");
  await page.locator('[data-testid="plugin-install-btn"]').click();
  await expect(page.locator('[data-testid="plugin-error"]')).toBeVisible({ timeout: 20000 });
});
