import { test, expect } from "@playwright/test";

/**
 * canvas-plugin-stickers 浏览器级 e2e —— Canvas 插件双端范例(canvas-plugins-m3 · R7.5)。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。贴纸 source
 * (`canvas-plugin-stickers`)是 domain=canvas 的权威 surface 范例:`.pi/web` 复用
 * `CanvasLauncher`/`CanvasPanel`,并经 `canvasPlugins:[stickersBundle]`(车道①)贡献
 * 贴纸图层/工具 + 风格迁移动作。构建期集成(lib/app/webext-registry)静态 import 其
 * web.config(canvasPlugins 含 React 组件 Render/Inspector,运行时 /api/webext/resolve
 * 无法承载),故挂载即显示。stub 代替真实 canvas 命令处理器:装配期推种子图 + 把能力清单
 * `capabilities.actions=["style_transfer"]` 并入快照(agent 权威)→ `control:"state"` 回流。
 *
 *  ① 贴纸闭环:选 `canvas-plugin-stickers` → launcherRail 入口开画廊 → 种子图入格 → 点格子
 *     展开工作台 → 工具轨出现**命名空间前缀化**的贴纸工具(`data-canvas-tool` =
 *     `canvas-plugin-stickers:sticker`)→ 激活 → 舞台按下放置一枚贴纸(`data-canvas-plugin-layer`
 *     + `data-sticker-emoji` 可见,自动选中)→ `data-canvas-inspector` 出现 → 调 `data-sticker-size-range`
 *     尺寸(断言呈现 fontSize 变化)→ 拍平(`data-canvas-layer-flatten`,贴纸烤入位图,层清空)。
 *
 * 说明:与 aigc-canvas.e2e.ts 同构(选源工具函数、种子图入格、工具/舞台/图层锚点)。
 * 风格迁移动作(命令通道回流)的端到端覆盖见 canvas-plugin-stickers.style-transfer 用例的
 * 说明(见文件尾部注释)。
 */

const STICKERS_SOURCE = "./examples/canvas-plugin-stickers";
const STICKER_TOOL_ANCHOR = "canvas-plugin-stickers:sticker";

async function selectSource(
  page: import("@playwright/test").Page,
  source: string,
): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
}

/** 选源 → 开画廊 → 点种子格子展开工作台(与 aigc-canvas 手法一致)。 */
async function openWorkbench(page: import("@playwright/test").Page): Promise<void> {
  await selectSource(page, STICKERS_SOURCE);

  // panelRight 初始比例来自 source 声明(web.config `config.panelRatio="4:6"`)。
  await expect(page.locator("[data-pi-chat-aside]")).toHaveAttribute(
    "data-pi-panel-ratio",
    "4:6",
  );

  // launcherRail 入口 → 画廊挂载(available=true;装配期种子图入格)。
  const launcher = page.locator("[data-canvas-launcher]");
  await expect(launcher).toBeVisible();
  await launcher.click();
  const gallery = page.locator("[data-canvas-gallery]");
  await expect(gallery).toBeVisible();
  await expect(gallery).toHaveAttribute("data-canvas-available", "true");
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(1);

  // 点种子格子 → 展开工作台。
  await page.locator("[data-canvas-cell]").first().click();
  await expect(page.locator("[data-canvas-workbench]")).toBeVisible();
}

test("stickers: 贴纸闭环(工具轨命名空间锚 → 舞台置层 → Inspector 调尺寸 → 拍平进位图)", async ({
  page,
}) => {
  await openWorkbench(page);

  // 车道① canvasPlugins:贴纸工具进工具轨,锚值 = **完整前缀化 id**(toolAnchor 只剥 builtin:,
  // 插件工具保留命名空间);requires 满足(捆自带 sticker 图层)→ 启用(非置灰)。
  const stickerTool = page.locator(`[data-canvas-tool="${STICKER_TOOL_ANCHOR}"]`);
  await expect(stickerTool).toBeVisible();
  await expect(stickerTool).toBeEnabled();

  // 激活贴纸工具 → 舞台按下放置一枚贴纸图层(createLayer 声明「点击置层」,自动选中)。
  await stickerTool.click();
  await expect(stickerTool).toHaveAttribute("aria-pressed", "true");

  const stage = page.locator("[data-canvas-stage]");
  await stage.click({ position: { x: 200, y: 160 } });

  // 插件图层在场:data-canvas-plugin-layer(kind 命中 registry.layers → Render 替换 img)+
  // data-sticker-emoji(Render 显 emoji)可见。
  const pluginLayer = page.locator("[data-canvas-plugin-layer]");
  await expect(pluginLayer).toHaveCount(1);
  const emoji = page.locator("[data-sticker-emoji]");
  await expect(emoji).toBeVisible();

  // 选中的插件图层 → Inspector 浮层出现(data-canvas-inspector),含尺寸滑杆。
  const inspector = page.locator("[data-canvas-inspector]");
  await expect(inspector).toBeVisible();
  const sizeRange = inspector.locator("[data-sticker-size-range]");
  await expect(sizeRange).toBeVisible();

  // Inspector 调尺寸 → 经 onInspectorUpdate 回写 layer.data.size → Render fontSize = size*scale
  // 变化(呈现随 data 更新;编辑生效由 fontSize 差异证明)。
  const beforeFontSize = await emoji.evaluate(
    (el) => (el as HTMLElement).style.fontSize,
  );
  await sizeRange.fill("200");
  await expect
    .poll(async () => emoji.evaluate((el) => (el as HTMLElement).style.fontSize))
    .not.toBe(beforeFontSize);

  // 拍平:贴纸图层经 bake 烤入位图(per-layer canvas 合成),图层清空(拍平后不再有插件层)。
  const flatten = page.locator("[data-canvas-layer-flatten]");
  await expect(flatten).toBeEnabled();
  await flatten.click();
  await expect(page.locator("[data-canvas-plugin-layer]")).toHaveCount(0);
});

/*
 * ② 风格迁移(命令通道回流)。前置资产:先置贴纸并拍平——拍平产物经 `run("register")` 回流
 * 画廊成第二张资产(参考图候选)。随后 @引用该资产 + prompt "style:油画" → styleTransferAction
 * match(referenceIds.length===1 + "style:" 前缀 + capability.actions 白名单命中)评 85 胜出 →
 * 生成按钮显示「风格迁移 / data-canvas-action="style-transfer"」→ 点击经 command 通道
 * `surface.run("canvas","style_transfer",…)` → stub 回流派生资产 → 版本条 +1。
 *
 * (历史:此用例曾因 workbench 派发塌缩缺口受阻——generate() 不读胜者 execution.via,插件
 *  command 动作被 toGenerateDecision 回退为 edit;3.4 remediation 已在 generate()/预览按钮
 *  补「按胜者 via 分道」,本用例即其端到端回归锚。)
 */
test("stickers: 风格迁移经 command 通道回流画廊(capability 白名单 + 按胜者 via 分道)", async ({
  page,
}) => {
  await openWorkbench(page);

  // 前置:置贴纸 → 拍平 → 拍平产物 register 回流为第二张资产(参考图候选就位)。
  await page.locator(`[data-canvas-tool="${STICKER_TOOL_ANCHOR}"]`).click();
  await page.locator("[data-canvas-stage]").click({ position: { x: 180, y: 140 } });
  await expect(page.locator("[data-canvas-plugin-layer]")).toHaveCount(1);
  await page.locator("[data-canvas-layer-flatten]").click();
  await expect(page.locator("[data-canvas-plugin-layer]")).toHaveCount(0);

  // @引用:拍平产物成为 refCandidates → 引用其为参考图(referenceIds.length===1)。
  const refTrigger = page.locator("[data-canvas-ref-trigger]");
  await expect(refTrigger).toBeEnabled();
  await refTrigger.click();
  await page.locator("[data-canvas-ref-option]").first().click();
  await expect(page.locator("[data-canvas-ref-chip]")).toHaveCount(1);

  // prompt "style:…" → styleTransferAction 胜出:按钮标签/锚点=插件 label/去前缀 id。
  await page.locator("[data-canvas-prompt]").fill("style:油画");
  const generate = page.locator("[data-canvas-generate]");
  await expect(generate).toHaveAttribute("data-canvas-action", "style-transfer");
  await expect(generate).toContainText("风格迁移");

  // 点击 → command 通道 surface.run("canvas","style_transfer") → stub 回流派生资产 → 版本条 +1。
  const versionsBefore = await page.locator("[data-canvas-version-item]").count();
  await generate.click();
  await expect
    .poll(async () => page.locator("[data-canvas-version-item]").count(), { timeout: 15_000 })
    .toBe(versionsBefore + 1);
});
