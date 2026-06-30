import { test, expect } from "@playwright/test";

/**
 * Bang(`!`)shell 命令 browser e2e(spec bang-shell-command)— 真实 Next server +
 * 离线 stub agent(stub 用 execSync 真实执行 shell)。
 *
 * 覆盖(开启档:NEXT_PUBLIC_PI_WEB_BASH_ENABLED=1 build + PI_WEB_BASH_ENABLED=1 server):
 *  - Req 6.1 — 输入以 `!` 开头 → 输入框显示 BASH 视觉提示。
 *  - Req 1.1 / 2.1 / 4.2 — `!echo …` 经 client.bash 执行,结果以 data-bash-result 卡片
 *    显示命令与真实输出(不经 useChat、不触发 prompt 流)。
 *  - Req 6.2 / 4.5 — `!!` 前缀显示 no-context 提示与卡片 no-context 徽标。
 *
 * 关闭档(前端关 → `!` 当普通消息;后端关 → 404 错误反馈)由单元/集成测试覆盖
 * (pi-chat-bash-submit.test.tsx / bash-route.test.ts),不在此重复(避免第二个 build)。
 */

const SOURCE = "./examples/hello-agent";

async function startSession(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
}

test("bang: 输入 ! 显示 BASH 徽标,!echo 出结果卡片含真实输出(Req 6.1/1.1/2.1/4.2)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");

  // Req 6.1 — 输入 ! 前缀即点亮 bash 模式视觉提示。
  await input.fill("!echo pi-e2e-bash-ok");
  await expect(page.locator("[data-pi-bash-badge]")).toBeVisible();

  // 提交(Enter)→ 经 client.bash 执行(stub 真实 echo)。
  await input.press("Enter");

  const card = page.locator("[data-pi-bash-result]");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-pi-bash-command]")).toContainText(
    "echo pi-e2e-bash-ok",
  );
  await expect(card.locator("[data-pi-bash-output]")).toContainText(
    "pi-e2e-bash-ok",
  );
  // 提交后输入框清空(Req 7.4)。
  await expect(input).toHaveValue("");
});

test("bang: !! 显示 no-context 提示与卡片标记(Req 6.2/4.5)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");

  await input.fill("!!echo pi-e2e-noctx");
  await expect(page.locator("[data-pi-bash-badge]")).toContainText("no context");

  await input.press("Enter");
  const card = page.locator("[data-pi-bash-result]");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-pi-bash-no-context]")).toBeVisible();
  await expect(card.locator("[data-pi-bash-output]")).toContainText(
    "pi-e2e-noctx",
  );
});
