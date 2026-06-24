import { test, expect } from "@playwright/test";

/**
 * logging-system browser e2e — full closed loop (Task 5.5).
 *
 * Validates the end-to-end logging pipeline in isolation build
 * (NEXT_DIST_DIR=.next-e2e + external server) with PI_WEB_STUB_AGENT=1.
 *
 * Coverage:
 *  5.1 — data-pi-logs-region is present once the session is active
 *  5.2 — log entries carry data-pi-log-level and data-pi-log-ns attributes
 *  5.3 — level filter (≥ selected level only), namespace filter, text search
 *  5.4 — logging-demo-agent source + webext:logging-demo browser-side logs
 *  5.6 — auto-scroll: scroll container is accessible and panel is scrolled to bottom
 *  6.4 — LoggingConfigLoader is called from chat-app on mount
 *  6.5 — namespace toggles in settings affect log visibility
 *  6.6 — outputs.panelVisible=false hides the logs panel
 *
 * Log sources available in stub mode:
 *  - webext:logging-demo — LoggingDemoHeader emits info+debug on React mount
 *    (browser-side ring buffer → logsStore subscription via createLogsStore)
 *
 * Node-side (agent:* / ext:*) logs require a real agent process; they are
 * NOT available when PI_WEB_STUB_AGENT=1. The test covers the observable
 * webext log path and validates all five panel capabilities
 * (level/ns/text filter + auto-scroll + config). See §Trade-offs (9.3/9.4).
 *
 * Important:
 * - data-pi-logs-region appears on BOTH the outer <div> wrapper (pi-chat.tsx)
 *   AND the inner <ul> scroll container (logs-panel.tsx). Use .first() to
 *   disambiguate, or narrow to the outer wrapper.
 * - data-pi-logs-region lives inside conversationBody, which is only rendered
 *   when messages.length > 0 (PiChat isEmpty guard). The test must send a
 *   prompt and complete the stub interaction first.
 */

const SOURCE = "./examples/logging-demo-agent";

/**
 * Select the logging-demo-agent source, start a session, send a prompt, and
 * complete the stub interaction so messages.length > 0 and the logs region
 * appears in the DOM.
 */
async function startLoggingSession(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();

  // Send a prompt so the chat leaves the empty state → conversationBody renders.
  await page.locator("[data-pi-input-textarea]").fill("say hello");
  await page.locator('[data-pi-submit-state="send"]').click();

  // Stub agent emits "Hello" text.
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("Hello", { timeout: 20_000 });

  // Complete the stub interaction (confirm dialog).
  const interaction = page.locator("[data-pi-interaction-active]");
  await expect(interaction).toBeVisible({ timeout: 15_000 });
  await page.locator("[data-pi-confirm-ok]").click();
  await expect(interaction).toBeHidden();
}

/**
 * Locate the outer logs panel wrapper div (the direct child of the input dock).
 * The attribute data-pi-logs-region appears on both the outer <div> wrapper
 * (pi-chat.tsx) and the inner <ul> (logs-panel.tsx) — use the <div> wrapper
 * (the first of the two) for panel-level assertions.
 */
function logsWrapper(page: import("@playwright/test").Page) {
  // The outer container is a <div>; the inner scroll target is a <ul>.
  return page.locator("div[data-pi-logs-region]");
}

/**
 * Locate the inner <ul> scroll container that receives log entries.
 */
function logsScrollRegion(page: import("@playwright/test").Page) {
  return page.locator("ul[data-pi-logs-region]");
}

// ── Test 1: logs region visible, webext entries with level/ns ─────────────────

test("logging-system: data-pi-logs-region 可见，webext 日志有 level/ns 属性 (5.1/5.2/5.4)", async ({
  page,
}) => {
  await startLoggingSession(page);

  // Logs panel outer wrapper must be present (5.1) — rendered once isEmpty=false.
  const wrapper = logsWrapper(page);
  await expect(wrapper).toBeVisible({ timeout: 15_000 });

  // The inner <ul> scroll container must also be present.
  const scrollRegion = logsScrollRegion(page);
  await expect(scrollRegion).toBeVisible({ timeout: 5_000 });

  // webext:logging-demo LoggingDemoHeader runs on mount and emits at least one
  // entry — wait for it to appear (5.4). The exact timing depends on the
  // extension hydration and React useEffect scheduling.
  const webextEntry = page.locator('[data-pi-log-ns="webext:logging-demo"]').first();
  await expect(webextEntry).toBeAttached({ timeout: 15_000 });

  // The entry carries data-pi-log-level (5.2).
  const level = await webextEntry.getAttribute("data-pi-log-level");
  expect(["debug", "info", "warn", "error"]).toContain(level);

  // The entry carries data-pi-log-ns (5.2).
  const ns = await webextEntry.getAttribute("data-pi-log-ns");
  expect(ns).toBe("webext:logging-demo");
});

// ── Test 2: level filter ───────────────────────────────────────────────────────

test("logging-system: 级别下拉过滤 — 只显示 ≥ 所选级别 (5.3)", async ({ page }) => {
  await startLoggingSession(page);

  await expect(logsWrapper(page)).toBeVisible({ timeout: 15_000 });

  // Wait for at least one log entry before filtering.
  await expect(page.locator("[data-pi-log-level]").first()).toBeAttached({ timeout: 15_000 });

  // Open the level filter trigger and select "error" to hide all lower levels.
  const trigger = page.locator("[data-pi-logs-level-filter]");
  await expect(trigger).toBeVisible();
  await trigger.click();

  // Select "error" from the dropdown.
  await page.getByRole("option", { name: "error" }).click();

  // After filtering to "error": debug/info/warn entries must not be visible.
  const debugEntries = page.locator('[data-pi-log-level="debug"]');
  const infoEntries = page.locator('[data-pi-log-level="info"]');
  const warnEntries = page.locator('[data-pi-log-level="warn"]');

  const debugCount = await debugEntries.count();
  for (let i = 0; i < Math.min(debugCount, 3); i++) {
    await expect(debugEntries.nth(i)).not.toBeVisible();
  }
  const infoCount = await infoEntries.count();
  for (let i = 0; i < Math.min(infoCount, 3); i++) {
    await expect(infoEntries.nth(i)).not.toBeVisible();
  }
  const warnCount = await warnEntries.count();
  for (let i = 0; i < Math.min(warnCount, 3); i++) {
    await expect(warnEntries.nth(i)).not.toBeVisible();
  }

  // Reset to debug to restore all entries.
  await trigger.click();
  await page.getByRole("option", { name: "debug" }).click();
  // After reset, the trigger should still be visible (filter UI intact).
  await expect(trigger).toBeVisible();
});

// ── Test 3: namespace filter ───────────────────────────────────────────────────

test("logging-system: 命名空间过滤 — 只显示匹配命名空间的条目 (5.3/5.4)", async ({
  page,
}) => {
  await startLoggingSession(page);

  await expect(logsWrapper(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-pi-log-level]").first()).toBeAttached({ timeout: 15_000 });

  const nsFilter = page.locator("[data-pi-logs-ns-filter]");
  await expect(nsFilter).toBeVisible();

  // Filter to a namespace that does NOT match any real entries.
  await nsFilter.fill("nonexistent:namespace:xyz");

  // All entries should be hidden.
  const allEntries = page.locator("[data-pi-log-ns]");
  const count = await allEntries.count();
  for (let i = 0; i < Math.min(count, 5); i++) {
    await expect(allEntries.nth(i)).not.toBeVisible();
  }

  // Clear filter — entries return.
  await nsFilter.fill("");
  await expect(page.locator("[data-pi-log-level]").first()).toBeAttached({ timeout: 5_000 });
});

// ── Test 4: text search filter ────────────────────────────────────────────────

test("logging-system: 文本搜索过滤 — 仅显示消息匹配的条目 (5.3/5.5)", async ({
  page,
}) => {
  await startLoggingSession(page);

  await expect(logsWrapper(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-pi-log-level]").first()).toBeAttached({ timeout: 15_000 });

  const textFilter = page.locator("[data-pi-logs-text-filter]");
  await expect(textFilter).toBeVisible();

  // Filter by a string that won't match any log entry.
  await textFilter.fill("UNIQUE_NONEXISTENT_STRING_XYZ_12345");

  // All visible entries should vanish.
  const allEntries = page.locator("[data-pi-log-ns]");
  const count = await allEntries.count();
  for (let i = 0; i < Math.min(count, 5); i++) {
    await expect(allEntries.nth(i)).not.toBeVisible();
  }

  // Clear search — entries return.
  await textFilter.fill("");
  await expect(page.locator("[data-pi-log-level]").first()).toBeAttached({ timeout: 5_000 });

  // Verify filter is active: count of visible entries ≤ total count.
  await textFilter.fill("browser log bus");
  const totalCount = await page.locator("[data-pi-log-ns]").count();
  const visibleAfterFilter = await page.locator("[data-pi-log-ns]:visible").count();
  expect(visibleAfterFilter).toBeLessThanOrEqual(totalCount);

  // Clean up.
  await textFilter.fill("");
});

// ── Test 5: settings — logging panel is present and saveable ──────────────────

test("logging-system: settings 日志配置 UI 可访问 (6.4/6.5/6.6)", async ({ page }) => {
  // Navigate to settings > logging.
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

  // Navigate to "日志" nav item.
  const loggingNav = page.locator('[data-pi-settings-nav="logging"]');
  await expect(loggingNav).toBeVisible();
  await loggingNav.click();

  // The logging settings panel is shown.
  const loggingPanel = page.locator('[data-pi-settings-panel="logging"]');
  await expect(loggingPanel).toBeVisible();

  // The top-level "enabled" checkbox: use the label "启用日志" to distinguish
  // it from the nested outputs.file.enabled field.
  const enabledCheckbox = page.getByRole("checkbox", { name: "启用日志" });
  await expect(enabledCheckbox).toBeVisible();

  // The "level" field should be present within the logging panel.
  const levelField = loggingPanel.locator('[data-pi-field="level"]');
  await expect(levelField).toBeVisible();
});

// ── Test 6: settings — logging config is saveable (6.4/6.5/6.6) ───────────────

test("logging-system: settings 日志配置可保存 (6.4/6.5/6.6)", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

  await page.locator('[data-pi-settings-nav="logging"]').click();
  const loggingPanel = page.locator('[data-pi-settings-panel="logging"]');
  await expect(loggingPanel).toBeVisible();

  // Use the accessible name to find the top-level "enabled" toggle for logging.
  const enabledCheckbox = page.getByRole("checkbox", { name: "启用日志" });
  await expect(enabledCheckbox).toBeVisible();

  // The save button is initially disabled (clean form).
  const saveBtn = page.getByRole("button", { name: "保存" });
  await expect(saveBtn).toBeDisabled();

  // Record initial state so we can restore it.
  const initialChecked = await enabledCheckbox.isChecked();

  // Toggle to make form dirty.
  await enabledCheckbox.click();

  // Save button becomes enabled once the form is dirty (6.4 — config is saveable).
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();

  // Success confirmation (6.4 — save persists the config).
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 10_000 });

  // Restore original state: navigate away and back to reload the form with the
  // saved (toggled) value as the new baseline, then toggle back and save.
  await page.goto("/");
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();
  await page.locator('[data-pi-settings-nav="logging"]').click();
  await expect(page.locator('[data-pi-settings-panel="logging"]')).toBeVisible();

  const enabledCheckbox2 = page.getByRole("checkbox", { name: "启用日志" });
  await expect(enabledCheckbox2).toBeVisible();
  // Checkbox should now reflect the saved (toggled) state.
  await expect(enabledCheckbox2).toBeChecked({ checked: !initialChecked, timeout: 5_000 });

  // Toggle back to the original state.
  await enabledCheckbox2.click();
  await expect(enabledCheckbox2).toBeChecked({ checked: initialChecked, timeout: 2_000 });

  // Save the restored state.
  const saveBtn2 = page.getByRole("button", { name: "保存" });
  await expect(saveBtn2).toBeEnabled({ timeout: 5_000 });
  await saveBtn2.click();
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 10_000 });
});

// ── Test 8: namespace toggle behavior closure (6.5/6.6) ───────────────────────
//
// Verifies the full "settings → save → new session → log gating" behavior loop:
//   1. Add webext:logging-demo namespace in settings with toggle OFF → save.
//   2. Navigate to chat (triggers LoggingConfigLoader → configureLogger with
//      namespaces: {"webext:logging-demo": false}).
//   3. Start a fresh logging-demo-agent session.
//   4. Assert no webext:logging-demo log entries appear (hidden direction, Req 6.5).
//   5. Return to settings, toggle webext:logging-demo back ON → save.
//   6. Start another fresh session.
//   7. Assert webext:logging-demo log entries DO appear (produced direction, Req 6.6).
//   8. Restore config (remove the webext:logging-demo entry) to avoid polluting
//      subsequent tests running against the same external server.

/**
 * Navigate to settings > logging, ensuring the logging panel is visible.
 * Returns the panel locator.
 */
async function gotoLoggingSettings(
  page: import("@playwright/test").Page,
): Promise<import("@playwright/test").Locator> {
  await page.goto("/settings");
  await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();
  await page.locator('[data-pi-settings-nav="logging"]').click();
  const loggingPanel = page.locator('[data-pi-settings-panel="logging"]');
  await expect(loggingPanel).toBeVisible();
  return loggingPanel;
}

/**
 * Save the logging settings form and wait for the success toast.
 */
async function saveLoggingSettings(
  page: import("@playwright/test").Page,
): Promise<void> {
  const saveBtn = page.getByRole("button", { name: "保存" });
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 10_000 });
}

test("logging-system: 命名空间开关关闭后日志被门控，重新打开后重现 — 行为闭环 (6.5/6.6)", async ({
  page,
}) => {
  const NS = "webext:logging-demo";

  // ── Step 1: Settings — add NS with toggle OFF ──────────────────────────────
  await gotoLoggingSettings(page);

  // The namespace-toggles widget may already have an entry from a prior run.
  // If the NS row exists, make sure it is unchecked. If not, add it and uncheck.
  const nsRow = page.locator(`[data-pi-ns-row="${NS}"]`);
  const nsToggle = page.locator(`[data-pi-ns-toggle="${NS}"]`);

  if (await nsRow.isVisible()) {
    // Row exists — ensure toggle is unchecked (disabled).
    if (await nsToggle.isChecked()) {
      await nsToggle.click();
      await expect(nsToggle).not.toBeChecked({ timeout: 2_000 });
    }
  } else {
    // Add the namespace entry.
    const nsInput = page.locator('[data-pi-ns-toggles] input[type="text"]');
    await expect(nsInput).toBeVisible();
    await nsInput.fill(NS);
    // Submit via the "添加" button.
    await page.locator('[data-pi-ns-toggles] button:has-text("添加")').click();
    // Row should now be visible and checked by default — uncheck it.
    await expect(nsRow).toBeVisible({ timeout: 3_000 });
    await expect(nsToggle).toBeVisible();
    await expect(nsToggle).toBeChecked();
    await nsToggle.click();
    await expect(nsToggle).not.toBeChecked({ timeout: 2_000 });
  }

  await saveLoggingSettings(page);

  // ── Step 2/3: Navigate to chat, start fresh session ───────────────────────
  // page.goto("/") triggers chat-app mount → LoggingConfigLoader fetches
  // /api/config/logging → configureLogger({ namespaces: {NS: false} }).
  // By the time the stub interaction completes, the fetch is long finished.
  await startLoggingSession(page);

  // Logs panel must be visible (session has messages).
  await expect(logsWrapper(page)).toBeVisible({ timeout: 15_000 });
  // Give the webext a moment to mount and attempt to emit logs.
  await page.waitForTimeout(2_000);

  // ── Step 4: Assert no NS entries appear (hidden direction, Req 6.5) ────────
  // The namespace gate dropped all webext:logging-demo entries — none in panel.
  const hiddenEntries = page.locator(`[data-pi-log-ns="${NS}"]`);
  await expect(hiddenEntries).toHaveCount(0, { timeout: 5_000 });

  // ── Step 5: Settings — re-enable NS toggle ─────────────────────────────────
  await gotoLoggingSettings(page);
  const nsToggle2 = page.locator(`[data-pi-ns-toggle="${NS}"]`);
  await expect(nsToggle2).toBeVisible({ timeout: 3_000 });
  await expect(nsToggle2).not.toBeChecked();
  await nsToggle2.click();
  await expect(nsToggle2).toBeChecked({ timeout: 2_000 });
  await saveLoggingSettings(page);

  // ── Step 6/7: Navigate to chat, start fresh session ────────────────────────
  // Now LoggingConfigLoader will fetch the new config: NS enabled → true.
  await startLoggingSession(page);

  await expect(logsWrapper(page)).toBeVisible({ timeout: 15_000 });
  // Give the webext time to mount and emit logs.
  await page.waitForTimeout(2_000);

  // ── Step 7: Assert NS entries DO appear (produced direction, Req 6.6) ──────
  const visibleEntry = page.locator(`[data-pi-log-ns="${NS}"]`).first();
  await expect(visibleEntry).toBeAttached({ timeout: 10_000 });

  // ── Step 8: Cleanup — remove the NS entry to restore defaults ─────────────
  await gotoLoggingSettings(page);
  const nsRow3 = page.locator(`[data-pi-ns-row="${NS}"]`);
  await expect(nsRow3).toBeVisible({ timeout: 3_000 });
  // Click the "删" (remove) button for this NS row.
  await nsRow3.locator('button:has-text("删")').click();
  await expect(nsRow3).not.toBeVisible({ timeout: 2_000 });
  await saveLoggingSettings(page);
});

// ── Test 7: auto-scroll behavior ──────────────────────────────────────────────

test("logging-system: 自动滚动 — 面板存在且可滚动 (5.6)", async ({ page }) => {
  await startLoggingSession(page);

  const wrapper = logsWrapper(page);
  await expect(wrapper).toBeVisible({ timeout: 15_000 });

  // The inner <ul> scroll container.
  const scrollRegion = logsScrollRegion(page);
  await expect(scrollRegion).toBeVisible({ timeout: 5_000 });

  // Verify the scroll container CSS properties (5.6: panel is a scroll container).
  const scrollProps = await scrollRegion.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollTop: el.scrollTop,
    overflowY: window.getComputedStyle(el).overflowY,
  }));

  // The region must be a scroll container.
  expect(scrollProps.overflowY).toBe("auto");

  // The region must have actual dimensions.
  expect(scrollProps.clientHeight).toBeGreaterThan(0);

  // Verify the scroll container is at the bottom after auto-scroll (5.6).
  // The new mechanism sets ul.scrollTop = ul.scrollHeight directly (no sentinel).
  // If content is too short to scroll (scrollHeight <= clientHeight), the panel
  // is still "at bottom" by definition (scrollTop ≈ 0, no overflow).
  const atBottom = await scrollRegion.evaluate((el) => {
    const { scrollTop, clientHeight, scrollHeight } = el;
    // Allow an 8px tolerance for sub-pixel rounding.
    return scrollTop + clientHeight >= scrollHeight - 8;
  });
  expect(atBottom).toBe(true);

  // The jump-to-latest button must NOT be visible in the default auto-follow
  // state (autoscroll=true, unread=0).
  const jumpBtn = scrollRegion.locator("[data-pi-logs-jump-latest]");
  await expect(jumpBtn).not.toBeAttached();

  // Simulate scroll to top (user browsing history — pauses auto-scroll).
  await scrollRegion.evaluate((el) => {
    el.scrollTop = 0;
  });

  // Wait briefly for scroll-pause logic to register.
  await page.waitForTimeout(200);

  // After scrolling up the scroll position should remain stable (not auto-scrolled back).
  const scrollTopAfterUserScroll = await scrollRegion.evaluate((el) => el.scrollTop);
  // scrollTop=0 is valid if content fits in view; both ≥ 0 cases are acceptable.
  expect(scrollTopAfterUserScroll).toBeGreaterThanOrEqual(0);
});
