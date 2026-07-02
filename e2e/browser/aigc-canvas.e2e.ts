import { test, expect } from "@playwright/test";

/**
 * aigc-canvas 浏览器级 e2e —— 画廊物化视图闭环 + 刷新回放 + 退化(source 声明驱动,免门控)。
 *
 * 对真实 Next server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。Canvas 由 source 声明驱动
 * (免全局门控):`aigc-canvas-agent` 的 `.pi/web` 在 launcherRail 挂 `CanvasLauncher`、
 * panelRight 挂 `CanvasPanel`(有 surface 接入 → 画廊/工作台),挂载即显示。
 * stub 代替真实 canvas 命令处理器:装配期推种子图(hydrate 模拟)+ 派发 A/B 档命令维护
 * `{ assets }` 快照 → `control:"state"`(key=`surface:canvas`)回流(real fd1 直写由集成测试覆盖)。
 *
 *  ① 闭环(不过 LLM):选 `aigc-canvas-agent` → launcherRail 入口开画廊 → 种子图入 9 宫格 →
 *     点格子展开工作台 → 输入指令 → 点「编辑」→ `run("canvas","edit")` → 快照回流 → 新图进画廊。
 *     断言**无 `/messages`**(命令绕过 LLM)。
 *  ② 刷新回放:命令后刷新页面 → 经服务端粘性 `control:"state"` 回放,画廊快照仍在(新图仍在)。
 *  ③ 退化 / 独立性:切非 AIGC source(hello-agent)→ 未声明 canvas 槽 + 无 `surface:canvas` 探针 →
 *     入口/画廊不挂载,pi-web 照常运行(输入可用、可对话),不报错。独立性由声明缺席保证,非 env 门控。
 *
 * 说明:本文件在**不设** `NEXT_PUBLIC_PI_WEB_CANVAS` / `LAUNCHER_RAIL` 的隔离 build 下跑,验证
 * source 声明即显示(免门控);强制关能力由 `CanvasLauncher enabled=false → null` 单元测试兜底。
 */

const CANVAS_SOURCE = "./examples/aigc-canvas-agent";
const UNRELATED_SOURCE = "./examples/hello-agent";

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

test("canvas: 闭环(launcherRail 入口 → 画廊 → 格子展开 → edit 命令回流 → 新图进画廊),命令不过 LLM", async ({
  page,
}) => {
  const promptCalls: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (/\/sessions\/[^/]+\/messages$/.test(new URL(req.url()).pathname)) {
      promptCalls.push(req.url());
    }
  });

  await selectSource(page, CANVAS_SOURCE);

  // panelRight 初始比例来自 source 声明(web.config `config.panelRatio="4:6"`:对话 40% / Canvas 60%,面板主导)。
  await expect(page.locator("[data-pi-chat-aside]")).toHaveAttribute(
    "data-pi-panel-ratio",
    "4:6",
  );

  // launcherRail 入口(门控开)。
  const launcher = page.locator("[data-canvas-launcher]");
  await expect(launcher).toBeVisible();

  // 激活入口 → panelRight 画廊挂载(available=true;种子图入 9 宫格)。
  await launcher.click();
  const gallery = page.locator("[data-canvas-gallery]");
  await expect(gallery).toBeVisible();
  await expect(gallery).toHaveAttribute("data-canvas-available", "true");
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(1);

  // 点格子 → 展开工作台。
  await page.locator("[data-canvas-cell]").first().click();
  await expect(page.locator("[data-canvas-workbench]")).toBeVisible();

  // A 档 edit:输入指令 → 点「编辑」→ run("canvas","edit") → 快照回流 → 新图入画廊(回到画廊后 2 格)。
  await page.locator("[data-canvas-prompt]").fill("make it warmer");
  await page.locator('[data-canvas-action="edit"]').click();
  // 关闭工作台回画廊,断言新增资产已入快照(种子 + edit 产物 = 2)。
  await page.locator("[data-canvas-workbench-close]").click();
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(2);

  // 命令不过 LLM:无 /messages(prompt)请求,亦无用户消息气泡。
  expect(promptCalls).toEqual([]);
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="user"]'),
  ).toHaveCount(0);
});

test("canvas: 命令后刷新 → 粘性 control:state 回放,画廊快照仍在", async ({ page }) => {
  await selectSource(page, CANVAS_SOURCE);
  await page.locator("[data-canvas-launcher]").click();
  await expect(page.locator("[data-canvas-gallery]")).toBeVisible();

  // 产一张新图(register B 档回流,免依赖 provider)。
  await page.locator("[data-canvas-cell]").first().click();
  await page.locator('[data-canvas-action="edit"]').click();
  await page.locator("[data-canvas-workbench-close]").click();
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(2);

  // 刷新:粘性帧回放 + 门控入口开合态(localStorage)恢复 → 画廊仍在,快照资产数保持。
  await page.reload();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-canvas-gallery]")).toBeVisible();
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(2);
});

test("canvas: LLM 生图轮末 auto-sync → 画廊自动填充新图(宿主 syncSignal 接线,不刷新)", async ({
  page,
}) => {
  await selectSource(page, CANVAS_SOURCE);
  await page.locator("[data-canvas-launcher]").click();
  const gallery = page.locator("[data-canvas-gallery]");
  await expect(gallery).toBeVisible();
  // 装配期 hydrate 种子图:1 格。
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(1);

  // 发一轮 `canvas-gen`:stub 落一张 tool-output 图入 pending 池(不 emit surface state,模拟
  // image_generation 只落 att、不写 canvas 快照)。轮末前端 isBusy idle 边沿 → 宿主 bump
  // syncSignal(pi-chat panelSyncSignal)→ SlotHost 透给 CanvasPanel → CanvasGallery run("canvas","sync")
  // → stub sync 并入 pending → 画廊 +1。全程不刷新页面。
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("canvas-gen 生成一张图");
  await input.press("Enter");
  // 轮结束(assistant stub 回复出现)。
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("canvas-gen stub");

  // 关键断言:**未刷新**,画廊经轮末 auto-sync 从 1 → 2 格。
  // 回归守卫:若宿主漏注入 syncSignal(修复前),sync 永不触发,画廊停在 1 格。
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(2);
});

test("canvas: B 档接线(host 注入 upload → 旋转 90° 客户端产物落 att_ → register 回流,新图进画廊)", async ({
  page,
}) => {
  await selectSource(page, CANVAS_SOURCE);
  await page.locator("[data-canvas-launcher]").click();
  await expect(page.locator("[data-canvas-gallery]")).toBeVisible();
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(1);

  // 展开工作台。
  await page.locator("[data-canvas-cell]").first().click();
  await expect(page.locator("[data-canvas-workbench]")).toBeVisible();

  // 接线证明:宿主经 SlotHost 注入 upload(uploadAttachment)+ baseUrl + sessionId 后,B 档旋转
  // 按钮不再禁用(此前 upload===undefined 降级禁用,deviation 2)。
  const rotate = page.locator("[data-canvas-b-rotate]");
  await expect(rotate).toBeEnabled();

  // 端到端:点旋转 → 客户端 canvas 旋转产 dataURI → 上传 att_(POST /attachments)→
  // run("canvas","register") → 快照回流 → 新图进画廊(种子 + 旋转产物 = 2)。
  await rotate.click();
  // 关闭工作台回画廊(workbench 态 gallery cell 不渲染),断言旋转产物已入快照(种子 + 旋转 = 2)。
  await page.locator("[data-canvas-workbench-close]").click();
  await expect(page.locator("[data-canvas-cell]")).toHaveCount(2);
});

test("canvas: 非 AIGC source(hello-agent)不挂载入口/画廊,pi-web 照常运行(退化 / 门控独立性)", async ({
  page,
}) => {
  await selectSource(page, UNRELATED_SOURCE);

  // 该 source 无 surface:canvas 探针 → 宿主不挂载 canvas launcherRail / panelRight。
  await expect(page.locator("[data-canvas-launcher]")).toHaveCount(0);
  await expect(page.locator("[data-canvas-gallery]")).toHaveCount(0);

  // 独立性:输入可用、可对话,不因 canvas 缺失报错。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  await page.locator("[data-pi-input-textarea]").fill("hello without canvas");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]'),
  ).toBeVisible();
});
