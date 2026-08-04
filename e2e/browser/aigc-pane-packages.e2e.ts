import { test, expect } from "@playwright/test";

const SOURCE = "./examples/aigc-agent";

async function startSession(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/");
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/sessions"
  );
  await page.locator("[data-agent-source-submit]").click();
  const body = await (await created).json() as { sessionId: string };
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 45_000 });
  return body.sessionId;
}

async function activatePane(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  // ResizeObserver 会在展开后的首帧重算“直接标签 / 更多菜单”归属；等一帧并
  // 有界重试，避免恰在重排瞬间拿到随后被卸载的 locator。
  await page.waitForTimeout(120);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const tab = page.getByRole("tab", { name, exact: true });
    if (await tab.count() > 0) {
      const clicked = await tab.first().click({ force: true, timeout: 800 })
        .then(() => true)
        .catch(() => false);
      if (clicked) return;
    }
    const more = page.getByRole("button", { name: "更多 Pane" });
    if (await more.count() > 0) {
      if (await more.getAttribute("aria-expanded") !== "true") {
        await more.click();
      }
      const item = page.getByRole("menuitem", { name, exact: true });
      if (await item.count() > 0) {
        await item.click();
        return;
      }
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`Pane tab not reachable: ${name}`);
}

async function closePane(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  await activatePane(page, name);
  await page.getByRole("button", { name: `关闭 ${name}` }).click();
}

test("搜索独立包 + 基座 Canvas Pane 直嵌均可用", async ({ page }) => {
  const sessionId = await startSession(page);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}/agent-routes`);
    if (!response.ok()) return [];
    return ((await response.json()) as { routes: Array<{ name: string }> }).routes.map(({ name }) => name);
  }).toContain("creative-search");

  await page.getByRole("button", { name: "展开 Pane 侧栏" }).click();
  await activatePane(page, "搜图");
  const search = page.frameLocator('iframe[title="搜图"]');
  await expect(search.locator("[data-search-pane]")).toBeVisible();
  await search.getByPlaceholder("输入描述，或拖入/粘贴图片搜图…").fill("国潮海报");
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search.locator("[data-search-results] .card")).toHaveCount(2);
  await expect(search.locator("[data-search-results] .card").first()).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(search.locator("[data-search-results] .card").first()).toHaveCSS(
    "box-shadow",
    "none",
  );
  await expect(search.locator("[data-search-results] img").first()).toHaveJSProperty("naturalWidth", 512);
  await expect(search.getByText("94%")).toBeVisible();
  await expect(search.getByText("夜色创意簇")).toBeVisible();
  await search.getByRole("button", { name: "聚类卡片" }).click();
  await expect(search.locator('[data-result-kind="cluster"]')).toHaveCount(1);
  await expect(search.locator('[data-result-kind="image"]')).toHaveCount(0);
  await search.getByRole("button", { name: "全部" }).click();
  await expect(search.getByRole("button", { name: "上传图片以图搜图" })).toBeVisible();
  await search.locator('input[type="file"]').setInputFiles({
    name: "query.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf5sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(search.getByRole("button", { name: "移除搜索图片" })).toBeVisible();
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search.locator("[data-search-results] .card")).toHaveCount(2);

  await activatePane(page, "画布");
  const canvas = page.frameLocator('iframe[title="画布"]');
  await expect(canvas.locator("[data-canvas-gallery]")).toBeVisible();
  await expect(canvas.locator("[data-canvas-gallery]")).toHaveAttribute(
    "data-canvas-available",
    "true",
  );
  await expect.poll(
    () => canvas.locator("html").evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("16px");
  await expect(canvas.locator("[data-canvas-cell]")).toHaveCount(1);
  await expect(canvas.locator("[data-canvas-cell] img")).toHaveJSProperty("naturalWidth", 512);
  await canvas.locator("[data-canvas-cell]").click();
  await expect(canvas.locator("[data-canvas-workbench]")).toBeVisible();
  await expect(canvas.locator("[data-canvas-workbench-image]")).toBeVisible();
  await expect(canvas.locator("[data-canvas-workbench-image]")).toHaveJSProperty("naturalWidth", 512);
  await expect(canvas.locator("[data-canvas-tool='move']")).toBeEnabled();
  const fitted = await canvas.locator("[data-canvas-workbench-image]").evaluate((image) => {
    const imageBox = image.getBoundingClientRect();
    const stageBox = image.closest("[data-canvas-stage]")?.getBoundingClientRect();
    return stageBox === undefined ? 0 : imageBox.width / stageBox.width;
  });
  expect(fitted).toBeGreaterThan(0.85);
  await expect(canvas.getByText("100%", { exact: true })).toBeVisible();
  await canvas.getByRole("button", { name: "放大" }).click();
  await expect(canvas.getByText("120%", { exact: true })).toBeVisible();
  await canvas.getByRole("button", { name: "适应" }).click();
  await expect(canvas.getByText("100%", { exact: true })).toBeVisible();
});

test("工具 Pill 不改写输入；日志为隔离 Pane；每类最多两实例", async ({ page }) => {
  const sessionId = await startSession(page);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}/logs`);
    if (!response.ok()) return [];
    return ((await response.json()) as { entries: Array<{ ns: string }> }).entries
      .map(({ ns }) => ns);
  }).toContain("agent:stub");
  const input = page.locator("[data-pi-input-textarea]");
  await expect(input).toHaveValue("");
  await page.getByRole("button", { name: "图像编辑", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.locator("[data-aigc-prompt-toolbar]").getByText("图像编辑", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "展开 Pane 侧栏" }).click();
  await expect(page.getByRole("tab", { name: "日志" })).toHaveCount(0);
  await page.getByRole("button", { name: "新开 Pane" }).click();
  const logsDialog = page.getByRole("dialog", { name: "新开 Pane" });
  await logsDialog.getByRole("button").filter({ hasText: "日志" }).click();
  const logsPane = page.frameLocator('iframe[title="日志"]');
  await expect(logsPane.locator('[data-pi-log-ns="agent:stub"]')).toContainText(
    "AIGC stub agent ready",
  );

  await page.getByRole("button", { name: "新开 Pane" }).click();
  let dialog = page.getByRole("dialog", { name: "新开 Pane" });
  await dialog.getByRole("button").filter({ hasText: "画布" }).click();
  await expect(page.locator('iframe[title="画布"]')).toHaveCount(2);

  await page.getByRole("button", { name: "新开 Pane" }).click();
  dialog = page.getByRole("dialog", { name: "新开 Pane" });
  await expect(dialog.getByRole("button").filter({ hasText: "画布" })).toBeDisabled();
});

test("Pane 头部刷新当前项并重新建立隔离载体", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: "展开 Pane 侧栏" }).click();
  await activatePane(page, "素材");
  const frame = page.locator('iframe[title="素材"]');
  await expect(frame).toBeVisible();
  await frame.evaluate((element) => {
    element.setAttribute("data-e2e-before-refresh", "1");
  });

  await page.getByRole("button", { name: "刷新当前 Pane" }).click();

  await expect(frame).not.toHaveAttribute("data-e2e-before-refresh", "1");
  await expect(
    page.frameLocator('iframe[title="素材"]').locator("[data-materials-directory]"),
  ).toBeVisible();
});

test("AIGC 本地恢复 Pane 侧栏开合、宽度、标签与当前项", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: "展开 Pane 侧栏" }).click();
  await closePane(page, "搜图");
  await activatePane(page, "素材");

  const resizer = page.locator("[data-pi-panel-resizer]");
  const box = await resizer.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 80);
  await page.mouse.down();
  await page.mouse.move(box!.x - 120, box!.y + 80);
  await page.mouse.up();
  const saved = await page.evaluate(() => JSON.parse(
    localStorage.getItem("pi-web:aigc-studio:panes:v4:sidebar") ?? "{}",
  ) as { open?: boolean; width?: number });
  expect(saved.open).toBe(true);
  expect(saved.width).toBeGreaterThan(480);

  await page.reload();
  await expect(page.locator("[data-panes-host]")).toBeVisible();
  await expect(page.getByRole("tab", { name: "素材" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "画布" })).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "搜图" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "日志" })).toHaveCount(0);
  await expect.poll(async () => {
    const width = await page.locator("[data-pi-ext-panel-right]").evaluate((element) =>
      element.getBoundingClientRect().width);
    return Math.round(width);
  }).toBe(Math.round(saved.width!));
});

test("对话 AIGC 成品图使用公共动作条，可批量下载并打开 Canvas Pane", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("aigc-completed-images");
  await input.press("Enter");
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("已生成两张成品图。");

  await page.reload();
  await expect(page.locator("[data-pi-conversation-images]")).toHaveCount(1);
  await expect(page.locator("[data-pi-conversation-image]")).toHaveCount(2);
  await expect(page.locator("[data-pi-conversation-image] img").first()).toHaveCSS(
    "object-fit",
    "contain",
  );
  await expect(page.getByRole("button", { name: "下载全部" })).toBeVisible();

  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "下载全部" }).click();
  await expect.poll(() => downloads.length).toBe(2);

  await page.getByRole("button", { name: "在画布中打开" }).first().click();
  await expect(page.locator("[data-panes-host]")).toBeVisible();
  await expect(page.getByRole("tab", { name: "画布", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("用户输入历史按钮位于回到底部上方，并平滑定位所选消息", async ({ page }) => {
  await startSession(page);
  const input = page.locator("[data-pi-input-textarea]");
  for (const text of [
    "aigc-completed-images 第一条历史输入",
    "aigc-completed-images 第二条历史输入",
  ]) {
    await input.fill(text);
    await input.press("Enter");
    await expect(page.locator("[data-pi-chat-messages]")).toContainText(text);
    await expect(input).toBeEnabled();
  }
  await page.reload();

  const viewport = page.locator("[data-pi-conversation-viewport]");
  await viewport.evaluate((element) => {
    const messages = element.querySelector<HTMLElement>("[data-pi-chat-messages]");
    if (messages !== null) messages.style.minHeight = "1600px";
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const navigator = page.getByRole("button", { name: "定位用户输入" });
  const toBottom = page.getByRole("button", { name: "回到底部" });
  await expect(navigator).toBeVisible();
  await expect(toBottom).toBeVisible();
  const navigatorBox = await navigator.boundingBox();
  const bottomBox = await toBottom.boundingBox();
  expect(navigatorBox!.y).toBeLessThan(bottomBox!.y);

  const second = page.locator(
    "[data-pi-message-id][data-pi-message-role='user']",
  ).nth(1);
  await second.evaluate((element) => {
    element.scrollIntoView = () => element.setAttribute("data-e2e-located", "true");
  });
  await navigator.click();
  await page.getByRole("menuitem", {
    name: /aigc-completed-images 第二条历史输入/,
  }).click();
  await expect(second).toHaveAttribute("data-e2e-located", "true");
  await expect(page.getByRole("menu", { name: "用户输入历史" })).toHaveCount(0);
  expect(await input.evaluate((element) => document.activeElement === element)).toBe(false);
});
