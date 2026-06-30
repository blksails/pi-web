import { test, expect } from "@playwright/test";

/**
 * Slash-command-palette browser e2e — drives the "/" command completion overlay
 * against the real Next server with the deterministic offline stub agent
 * (PI_WEB_STUB_AGENT=1). The stub's `get_commands` returns two commands: `help`
 * and `clear` (lib/app/stub-agent-process.mjs).
 *
 * Covers (.kiro/specs/slash-command-palette/requirements.md):
 *  - Req 1 — typing "/" opens the palette, fetches commands, filters by input.
 *  - Req 2 — ArrowDown/ArrowUp navigate, Enter selects, Esc closes; mouse click selects.
 *  - Req 3 — selecting a command fills the input with "/name " (trailing space) and
 *            does NOT send; appending args + Enter then sends the full slash text.
 *  - Req 4 — in command mode with candidates, Enter is yielded to the palette (no send);
 *            with no candidates (no match) Enter is not suppressed → literal command sent.
 *  - Req 5 — empty session shows the suggestion grid; once a message exists the
 *            session-state suggestion bubbles are gone (palette takes over).
 *  - Req 7 — no-match query shows the empty state without crashing; chat stays usable.
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

test("slash palette: typing '/' opens the palette and filters by query (Req 1)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  const palette = page.locator("[data-pi-command-palette]");

  // Req 1.2 — not in command mode → no palette.
  await expect(palette).toHaveCount(0);

  // Req 1.1/1.3 — "/" enters command mode; commands fetched via get_commands.
  await input.fill("/");
  await expect(palette).toBeVisible();
  await expect(page.locator('[data-pi-command-item="help"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="clear"]')).toBeVisible();

  // completion-cursor-anchor — 命令面板与 @ 补全一致:经 caret 锚定 position:fixed
  // (不再全宽 absolute bottom-full)。
  await expect(palette).toHaveCSS("position", "fixed");

  // Req 1.4/1.5 — case-insensitive substring filter on name; "/h" keeps only help.
  await input.fill("/h");
  await expect(page.locator('[data-pi-command-item="help"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="clear"]')).toHaveCount(0);
});

test("slash palette: ArrowDown navigates and Enter selects, filling '/name ' without sending (Req 2, 3)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");

  await input.click();
  await input.fill("/");
  await expect(page.locator("[data-pi-command-palette]")).toBeVisible();
  // First option (help) is active by default (Req 2.6 aria-activedescendant).
  await expect(page.locator('[data-pi-command-item="help"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Req 2.1 — ArrowDown moves the highlight to the next option (retry).
  // 注:/clear 现为 host 内置命令(选中走分派、不填充),故此处用普通 agent 命令 retry
  // 验证「导航+填充 /name 」;命令顺序为 [help, retry, plugin(内置), clear(内置)]。
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-pi-command-item="retry"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Req 2.2 / 3.1 — Enter selects the highlighted command, filling "/retry " and
  // NOT sending (no message appears, Enter was yielded to the palette).
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("/retry ");
  await expect(page.locator("[data-pi-chat-messages]")).toHaveCount(0);
  // The value "/retry " still starts with "/", so the palette stays in command
  // mode but now matches no command name → empty state (Req 3.2 "re-match"; not a
  // send). No command items remain highlighted.
  await expect(page.locator('[data-pi-command-item="retry"]')).toHaveCount(0);
  await expect(page.locator("[data-pi-command-empty]")).toBeVisible();
});

test("slash palette: mouse click selects a command and fills the input (Req 2.5, 3.1)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");

  await input.fill("/");
  await page.locator('[data-pi-command-item="help"]').click();
  await expect(input).toHaveValue("/help ");
});

test("slash palette: Escape closes the palette and exits command mode (Req 2.3)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");

  await input.click();
  await input.fill("/");
  await expect(page.locator("[data-pi-command-palette]")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-pi-command-palette]")).toHaveCount(0);
  // Palette clears the command-mode input on Escape.
  await expect(input).toHaveValue("");
});

test("slash palette: no-match query shows empty state and Enter sends the literal command (Req 4, 7)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  const messages = page.locator("[data-pi-chat-messages]");

  // Req 7.3 — a query matching no command shows the empty state, no crash.
  await input.click();
  await input.fill("/zzz");
  await expect(page.locator("[data-pi-command-palette]")).toBeVisible();
  await expect(page.locator("[data-pi-command-empty]")).toBeVisible();

  // Req 4 — with no candidates, Enter is NOT suppressed; the literal "/zzz" is
  // sent as a normal message (no dead key). The stub streams a reply.
  await page.keyboard.press("Enter");
  await expect(messages).toContainText("Hello");
});

test("slash palette: command-mode Enter with candidates does not send, appended args then send (Req 3.3, 4)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  const messages = page.locator("[data-pi-chat-messages]");

  // Command mode with a candidate: Enter selects, does not send.
  await input.click();
  await input.fill("/h");
  await expect(page.locator('[data-pi-command-item="help"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("/help ");
  await expect(page.locator("[data-pi-chat-messages]")).toHaveCount(0);

  // Req 3.3 — append args; now out of command mode, Enter submits the full text.
  await input.fill("/help me");
  await page.keyboard.press("Enter");
  await expect(messages).toContainText("Hello");
});

test("slash palette: agent 声明的伪命令并入单浮层,选中只填入不执行,补词后正常发送 (agent-slash-completion)", async ({
  page,
}) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  const messages = page.locator("[data-pi-chat-messages]");

  // "/" → 伪命令(agent 声明,经 completion 端点)与执行型命令(get_commands)并入同一浮层。
  await input.fill("/");
  await expect(page.locator("[data-pi-command-palette]")).toBeVisible();
  await expect(page.locator('[data-pi-command-item="img-gen"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="img-edit"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="help"]')).toBeVisible();

  // 前缀过滤到伪命令(执行型命令无 img 匹配)。
  await input.fill("/img");
  await expect(page.locator('[data-pi-command-item="img-gen"]')).toBeVisible();
  await expect(page.locator('[data-pi-command-item="help"]')).toHaveCount(0);

  // 选中伪命令 → 只填入 insertText("/img-gen ")、不执行、不发送。
  await page.locator('[data-pi-command-item="img-gen"]').click();
  await expect(input).toHaveValue("/img-gen ");
  await expect(messages).toHaveCount(0);

  // 补词后:等候选(防抖 120ms 刷新)清空——"/img-gen 一只猫" 不再前缀匹配任何命令名,
  // 浮层落到 No-commands(normalTotal=0),Enter 不被浮层拦截。
  // (真实使用中逐字输入,防抖在敲击间已结算;此处等候选清空以避免 fill+Enter 抢跑防抖。)
  await input.fill("/img-gen 一只猫");
  await expect(page.locator('[data-pi-command-item="img-gen"]')).toHaveCount(0);
  await expect(page.locator('[data-pi-command-item="img-edit"]')).toHaveCount(0);
  // Enter → 作为普通消息发送,stub 回流回复。
  await page.keyboard.press("Enter");
  await expect(messages).toContainText("Hello");
});

test("slash palette: empty session shows suggestion grid, session state drops the bubbles (Req 5)", async ({
  page,
}) => {
  await startSession(page);

  // Req 5.1 — empty session renders the suggestion grid (commands ∪ presets).
  await expect(page.locator("[data-pi-suggestions]")).toBeVisible();

  // Drive one turn so the conversation has a message.
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("hello");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("Hello");

  // Req 5.2 — in session state the suggestion bubbles are no longer rendered;
  // command completion is handled by the palette instead.
  await expect(page.locator("[data-pi-chat-suggestions]")).toHaveCount(0);
});
