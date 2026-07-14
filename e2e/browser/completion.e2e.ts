import { test, expect } from "@playwright/test";

/**
 * completion-provider-framework 浏览器 e2e。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。验证 core 触发符
 * 补全:在会话输入框键入 `@` → 弹出按 kind 分区的文件候选浮层 → 选中后输入框被插入
 * `@file:<相对路径>` token。会话 cwd = 选中的 agent 源目录(hello-agent 含 index.ts)。
 */
async function selectSource(
  page: import("@playwright/test").Page,
  source: string,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

test("completion: 键入 @ 弹出文件候选并插入 @file: token", async ({ page }) => {
  await selectSource(page, "./examples/hello-agent");

  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toBeVisible();

  // 键入 @ + 查询;core 补全浮层经通用端点拉取 cwd 文件候选。
  await input.click();
  await input.fill("@index");

  const popover = page.locator("[data-pi-completion-popover]");
  await expect(popover).toBeVisible();

  // 分区渲染:file 分组在场。
  await expect(popover.locator('[data-pi-completion-group="file"]')).toBeVisible();

  // 命中 index.ts 候选(hello-agent cwd 根文件),且标注 kind=file。
  const item = popover.locator('[data-pi-completion-item="index.ts"]');
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("data-kind", "file");

  // 选中 → 输入框插入带类型回环 token。
  await item.click();
  await expect(input).toHaveValue(/@file:index\.ts\s/);
  await expect(popover).toBeHidden();
});

test("completion: 纯文本输入不弹补全浮层(收敛)", async ({ page }) => {
  await selectSource(page, "./examples/hello-agent");
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("just plain text");
  await expect(page.locator("[data-pi-completion-popover]")).toHaveCount(0);
});

// completion-cursor-anchor:浮层 caret 锚定(position:fixed,非全宽贴顶)+ 键盘导航。
test("completion-cursor-anchor: 浮层 fixed 锚定 + 键盘 ↓ 导航 + Enter 选中插入", async ({
  page,
}) => {
  await selectSource(page, "./examples/hello-agent");
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  // 空查询列出 cwd 根文件(index.ts / README.md),≥2 项供方向键导航。
  await input.fill("@");

  const popover = page.locator("[data-pi-completion-popover]");
  await expect(popover).toBeVisible();

  // 锚定:浮层为 position:fixed(而非旧的全宽 absolute bottom-full)。
  await expect(popover).toHaveCSS("position", "fixed");

  const items = popover.locator("[data-pi-completion-item]");
  await expect(items.nth(1)).toBeVisible(); // 至少两项

  // 默认高亮首项。
  await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");

  // ↓ 高亮第二项。
  await input.press("ArrowDown");
  await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(items.nth(0)).toHaveAttribute("aria-selected", "false");

  // 记录第二项 id,Enter 选中应插入对应 @file: token。
  const secondId = await items.nth(1).getAttribute("data-pi-completion-item");
  await input.press("Enter");
  await expect(input).toHaveValue(new RegExp(`@file:${secondId}\\s`));
  await expect(popover).toBeHidden();
});

// completion-cursor-anchor:文本中间位置触发补全,仅替换 token、保留尾部文本。
test("completion-cursor-anchor: 中间位置补全只替换 token 并保留尾部", async ({
  page,
}) => {
  await selectSource(page, "./examples/hello-agent");
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill("hello @index world");

  // 用方向键把光标从末尾(18)左移 6 位到 "index" 之后(偏移 12,token 末尾);
  // 每次 ArrowLeft 经 onKeyUp 自然上报新光标,驱动中间位置补全激活。
  for (let i = 0; i < 6; i++) await input.press("ArrowLeft");

  const popover = page.locator("[data-pi-completion-popover]");
  await expect(popover).toBeVisible();
  await expect(
    popover.locator('[data-pi-completion-item="index.ts"]'),
  ).toBeVisible();

  // Enter 选中高亮(首项) → 仅替换 [6,12) 的 "@index",保留尾部 " world"。
  await input.press("Enter");
  await expect(input).toHaveValue("hello @file:index.ts  world");

  // 光标落在插入串之后(而非文本末尾):selectionStart === "hello @file:index.ts ".length。
  const caret = await input.evaluate(
    (el: HTMLTextAreaElement) => el.selectionStart,
  );
  expect(caret).toBe("hello @file:index.ts ".length);
});
