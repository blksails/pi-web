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
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  return body.sessionId;
}

test("独立素材 Pane：会话素材库与素材目录并列、预览、分页及静默刷新闭环", async ({ page }) => {
  const sessionId = await startSession(page);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/sessions/${sessionId}/agent-routes`);
    if (!response.ok()) return [];
    return ((await response.json()) as { routes: Array<{ name: string }> }).routes.map(({ name }) => name);
  // Windows 冷启需先由 jiti 装载 server store；与生产 readiness 探针的 30s 上限对齐。
  }, { timeout: 30_000 }).toContain("assets-list");
  const routes = await page.request.get(`/api/sessions/${sessionId}/agent-routes`);
  expect(routes.ok()).toBeTruthy();
  expect((await routes.json()).routes).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "assets-list", methods: ["GET"] }),
    expect.objectContaining({ name: "materials-library", methods: expect.arrayContaining(["GET"]) }),
    expect.objectContaining({ name: "material-status", methods: ["GET"] }),
  ]));
  const assets = await page.request.get(`/api/sessions/${sessionId}/agent-routes/assets-list`);
  expect(assets.ok()).toBeTruthy();
  expect((await assets.json()).items).toEqual([
    expect.objectContaining({ attachmentId: "att_aigc_seed" }),
  ]);
  await page.getByRole("button", { name: "展开 Pane 侧栏" }).click();
  await expect(page.locator("[data-panes-host]")).toBeVisible();

  await page.getByRole("tab", { name: "素材" }).click();
  const materials = page.frameLocator('iframe[title="素材"]');
  await expect(materials.getByRole("tab", { name: "素材目录" })).toHaveCount(0);
  const modeTabs = materials.getByRole("navigation", {
    name: "素材工作台展示模式",
  });
  await expect(modeTabs.getByRole("button")).toHaveCount(3);
  await expect(modeTabs.getByRole("button", { name: "并列" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(materials.locator("[data-materials-library]")).toBeVisible();
  await expect(materials.locator("[data-materials-directory]")).toBeVisible();
  const trackResizer = materials.getByRole("separator", {
    name: "调整素材库与素材目录尺寸",
  });
  await expect(trackResizer).toBeVisible();
  const initialTrackSize = Number(await trackResizer.getAttribute("aria-valuenow"));
  const initialOrientation = await trackResizer.getAttribute("aria-orientation");
  await trackResizer.press(initialOrientation === "horizontal" ? "ArrowDown" : "ArrowRight");
  await expect(trackResizer).toHaveAttribute(
    "aria-valuenow",
    String(initialTrackSize + 2),
  );
  await modeTabs.getByRole("button", { name: "素材库" }).click();
  await expect(materials.locator("[data-materials-library]")).toBeVisible();
  await expect(materials.locator("[data-materials-directory]")).toHaveCount(0);
  await modeTabs.getByRole("button", { name: "素材目录" }).click();
  await expect(materials.locator("[data-materials-library]")).toHaveCount(0);
  await expect(materials.locator("[data-materials-directory]")).toBeVisible();
  await modeTabs.getByRole("button", { name: "并列" }).click();
  await expect(materials.locator("[data-materials-library]")).toBeVisible();
  await expect(materials.locator("[data-materials-directory]")).toBeVisible();
  await expect(materials.locator("[data-materials-directory-content]")).toBeVisible();
  const libraryAsset = materials.locator("[data-materials-library] .asset").first();
  const directoryAsset = materials.locator("[data-materials-directory] .asset").first();
  await expect(libraryAsset.locator(".asset-name")).toHaveText("AIGC 示例素材");
  await libraryAsset.hover();
  await expect(materials.locator(".hover-preview")).toBeVisible();
  await libraryAsset.click({ button: "right" });
  await expect(materials.locator(".hover-preview")).toHaveCount(0);
  await materials.locator(".asset-backdrop").click();
  await expect(materials.locator("[data-materials-library] .day")).toBeVisible();
  await expect(directoryAsset).toBeVisible();
  const assetName = directoryAsset.locator(".asset-name");
  await expect(assetName).toHaveText("企业示例素材");
  await expect(assetName).toHaveCSS("border-radius", "999px");
  await expect(assetName).toHaveCSS("backdrop-filter", /blur\(9px\)/);
  const rootFolderRow = materials.locator(".tree-row").filter({ hasText: "企业目录" }).first();
  const folderActions = rootFolderRow.getByRole("button", { name: "企业目录目录操作" });
  await expect(folderActions).toHaveCSS("width", "0px");
  await rootFolderRow.hover();
  await expect(folderActions).toHaveCSS("width", "22px");
  await folderActions.click();
  await expect(materials.getByRole("menuitem", { name: "新建子目录" })).toBeVisible();
  await expect(materials.getByRole("menuitem", { name: "上传素材" })).toBeVisible();
  await expect(materials.getByRole("menuitem", { name: "重命名" })).toBeVisible();
  await expect(materials.getByRole("menuitem", { name: "删除空目录" })).toBeVisible();
  await materials.locator(".asset-backdrop").click();

  await directoryAsset.getByRole("button", { name: "素材菜单" }).click();
  await materials.getByRole("button", { name: "移动到目录…" }).click();
  const moveDialog = materials.getByRole("dialog", { name: "移动到目录" });
  await expect(moveDialog).toBeVisible();
  const folderTwist = moveDialog.getByRole("button", { name: "折叠企业目录" });
  await folderTwist.click();
  await expect(moveDialog.getByRole("button", { name: "子目录" })).toHaveCount(0);
  await moveDialog.getByRole("button", { name: "展开企业目录" }).click();
  await expect(moveDialog.getByRole("button", { name: "子目录" })).toBeVisible();
  await moveDialog.getByRole("button", { name: "取消" }).click();

  const directoryContent = materials.locator("[data-materials-directory-content]");
  await expect(materials.getByRole("navigation", { name: "素材分页" })).toHaveCSS("opacity", "1");
  const [contentBox, scrollBox, pagerBox] = await Promise.all([
    directoryContent.boundingBox(),
    materials.locator(".materials-scroll").boundingBox(),
    materials.getByRole("navigation", { name: "素材分页" }).boundingBox(),
  ]);
  expect(contentBox).not.toBeNull();
  expect(scrollBox).not.toBeNull();
  expect(pagerBox).not.toBeNull();
  expect(Math.abs((contentBox?.y ?? 0) + (contentBox?.height ?? 0) -
    ((pagerBox?.y ?? 0) + (pagerBox?.height ?? 0)))).toBeLessThanOrEqual(1);
  expect(Math.abs((scrollBox?.y ?? 0) + (scrollBox?.height ?? 0) -
    (pagerBox?.y ?? 0))).toBeLessThanOrEqual(1);

  await directoryAsset.hover();
  const hoverPreview = materials.locator(".hover-preview");
  await expect(hoverPreview).toBeVisible();
  await expect(hoverPreview).toHaveCSS("border-top-width", "0px");
  await expect(hoverPreview.locator("strong")).toHaveText("企业示例素材");
  const [previewBox, gridBox] = await Promise.all([
    hoverPreview.boundingBox(),
    directoryAsset.locator("xpath=..").boundingBox(),
  ]);
  expect(previewBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  const previewGap = Math.min(
    Math.abs((previewBox?.x ?? 0) - ((gridBox?.x ?? 0) + (gridBox?.width ?? 0))),
    Math.abs((gridBox?.x ?? 0) - ((previewBox?.x ?? 0) + (previewBox?.width ?? 0))),
  );
  expect(previewGap).toBeLessThanOrEqual(4);

  const beforeRefresh = await directoryAsset.boundingBox();
  await page.route("**/agent-routes/materials-library*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  const directRefresh = materials.getByRole("button", { name: "刷新", exact: true });
  if (await directRefresh.isVisible().catch(() => false)) {
    await directRefresh.click();
  } else {
    await materials.getByRole("button", { name: "更多素材操作" }).click();
    const refreshMenuItem = materials.getByRole("menuitem", { name: "刷新", exact: true });
    const menuFit = await refreshMenuItem.evaluate((element) => {
      const rect = element.closest('[role="menu"]')?.getBoundingClientRect();
      return rect === undefined
        ? undefined
        : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: innerWidth, height: innerHeight };
    });
    expect(menuFit).toEqual(expect.objectContaining({
      left: expect.any(Number),
      right: expect.any(Number),
    }));
    expect(menuFit!.left).toBeGreaterThanOrEqual(0);
    expect(menuFit!.right).toBeLessThanOrEqual(menuFit!.width);
    expect(menuFit!.top).toBeGreaterThanOrEqual(0);
    expect(menuFit!.bottom).toBeLessThanOrEqual(menuFit!.height);
    await refreshMenuItem.click();
  }
  const duringRefresh = await directoryAsset.boundingBox();
  expect(beforeRefresh).not.toBeNull();
  expect(duringRefresh).not.toBeNull();
  expect(Math.abs((beforeRefresh?.y ?? 0) - (duringRefresh?.y ?? 0))).toBeLessThanOrEqual(1);
  await expect(materials.locator(".initial-loading")).toHaveCount(0);

  await expect(libraryAsset).toBeVisible();
  await expect(libraryAsset.locator(".asset-img")).toHaveJSProperty("naturalWidth", 512);
  await libraryAsset.locator(".asset-img").click();
  await expect(materials.getByRole("dialog")).toBeVisible();
  await expect(materials.locator(".ilb-dims")).toHaveText("512×512");
  await materials.getByRole("button", { name: "关闭预览" }).click();

  await directoryAsset.getByRole("button", { name: "选择" }).click();
  await expect(materials.getByText("已选 1")).toBeVisible();
  const directBring = materials.getByRole("button", { name: "带入对话", exact: true });
  if (await directBring.isVisible().catch(() => false)) {
    await expect(directBring).toBeEnabled();
  } else {
    await materials.getByRole("button", { name: "更多素材操作" }).click();
    const bringMenuItem = materials.getByRole(
      "menuitem",
      { name: "带入对话", exact: true },
    );
    await expect(bringMenuItem).toBeEnabled();
    await bringMenuItem.click();
  }

  await directoryAsset.evaluate((source) => {
    const target = document.querySelector("[data-materials-library]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("materials library drop target not found");
    }
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    target.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
    target.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  });
  await expect(materials.getByText("已加入当前会话素材库")).toBeVisible();
  await expect(
    materials.locator("[data-materials-library] .asset-name", {
      hasText: "企业示例素材",
    }),
  ).toBeVisible();
  const importedAssets = materials.locator("[data-materials-library] .asset", {
    hasText: "企业示例素材",
  });
  const importedCount = await importedAssets.count();
  const importedAsset = importedAssets.last();
  await importedAsset.getByRole("button", { name: "素材菜单" }).click();
  await materials.getByRole("button", { name: "删除", exact: true }).click();
  await materials.getByRole("button", { name: "再次点击确认删除" }).click();
  await expect(importedAssets).toHaveCount(importedCount - 1);

  const paneAside = page.locator("[data-pi-chat-aside]");
  await paneAside.evaluate((element) =>
    (element as HTMLElement).style.setProperty("width", "850px", "important"));
  await expect(trackResizer).toHaveAttribute("aria-orientation", "vertical");
  await paneAside.evaluate((element) =>
    (element as HTMLElement).style.setProperty("width", "600px", "important"));
  await expect(trackResizer).toHaveAttribute("aria-orientation", "horizontal");
  const [libraryBox, directoryBox] = await Promise.all([
    materials.locator("[data-materials-library]").boundingBox(),
    materials.locator("[data-materials-directory]").boundingBox(),
  ]);
  expect(libraryBox).not.toBeNull();
  expect(directoryBox).not.toBeNull();
  expect(directoryBox?.y ?? 0).toBeGreaterThan(
    (libraryBox?.y ?? 0) + (libraryBox?.height ?? 0),
  );
});
