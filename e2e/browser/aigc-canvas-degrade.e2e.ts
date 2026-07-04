import { test, expect } from "@playwright/test";

/**
 * aigc-canvas 降级(unavailable / 只读)浏览器级 e2e —— surface-runtime-facade Task 6.2。
 *
 * 场景(Req 8.6 / 8.7):选一个「贡献 Canvas 面板但 agent 未注册 canvas surface」的 source
 * (`aigc-canvas-nosurface-agent`,index.ts 只装 `aigcExtension`、不装 `canvasSurfaceExtension`)
 * → 打开 Canvas 面板 → 面板挂载但因无 `surface:canvas` 探针而退化为只读图库,pi-web 本地功能
 * (对话)照常可用、不崩溃。
 *
 * fixture 独立可验:`surface.hasCommand("surface:canvas")` 为假(stub 仅对 `aigc-canvas-agent`
 * 源名放出 surface:canvas 探针),而面板经 `.pi/web/web.config` 的 slot 贡献仍可见。
 *
 * ⚠ 降级三态的 workbench 锚点(`data-canvas-op-channel` / `data-canvas-degrade`):
 * 在真实宿主下,pi-chat 无条件向 panelRight slot 注入 `conversation` 能力对象(见
 * pi-chat.tsx `conversation` useMemo + SlotHost 注入,Task 3.1),故 `useConversationBridge`
 * 求值 opChannel 恒为 `"prompt"`,workbench 的 `unavailable` op-channel 态在浏览器不可达。
 * 三个 op-channel 态(prompt/command/unavailable)与对应降级横幅由组件测试
 * `packages/ui/test/canvas/canvas-workbench-channel.test.tsx` 穷举覆盖。本 e2e 断言真实宿主
 * 可达的**面板级**降级:画廊 `data-canvas-available="false"` + `data-canvas-degraded` 只读横幅。
 */

const NOSURFACE_SOURCE = "./examples/aigc-canvas-nosurface-agent";

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

test("canvas 降级:贡献面板但无 surface → 只读图库退化,本地功能照常,不崩溃", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await selectSource(page, NOSURFACE_SOURCE);

  // 面板贡献仍在:launcherRail 入口可见(source 声明驱动,免门控)。
  const launcher = page.locator("[data-canvas-launcher]");
  await expect(launcher).toBeVisible();

  // 打开 Canvas 面板 → 画廊挂载,但因无 surface:canvas 探针而 available=false(退化只读图库)。
  await launcher.click();
  const gallery = page.locator("[data-canvas-gallery]");
  await expect(gallery).toBeVisible();
  await expect(gallery).toHaveAttribute("data-canvas-available", "false");

  // 降级横幅呈现(「只读图库(该 source 未提供 canvas surface)」)。
  const degraded = page.locator("[data-canvas-degraded]");
  await expect(degraded).toBeVisible();
  await expect(degraded).toContainText("未提供 canvas surface");

  // 无 surface → 无种子快照 → 无 A 档格子(不可进入 workbench 的 surface 命令通道)。
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(0);

  // 本地功能照常:输入可用、可对话,不因 canvas surface 缺失而崩溃。
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("hello without canvas surface");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]'),
  ).toBeVisible();

  // 面板与对话并存,画廊退化态保持,无页面级错误。
  await expect(gallery).toBeVisible();
  await expect(gallery).toHaveAttribute("data-canvas-available", "false");
  expect(pageErrors).toEqual([]);
});
