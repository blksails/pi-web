import { test, expect, type FrameLocator, type Page } from "@playwright/test";

/**
 * aigc-canvas 浏览器级 e2e —— **隔离 Pane 形态**(isolated-panes Wave 5 迁移后)。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。
 * stub 代替真实 canvas 命令处理器:装配期推种子图(hydrate 模拟)+ 派发 A/B 档命令维护
 * `{ assets }` 快照 → `control:"state"`(key=`surface:canvas`)回流(real fd1 直写由集成测试覆盖)。
 *
 * ## 与迁移前的差别(读断言前先看这段)
 *
 * 迁移前画廊由 `panelRight` 槽在**宿主同 realm** 渲染,选择器直接 `page.locator(...)` 即可,
 * 且需要先点 `launcherRail` 的 `[data-canvas-launcher]` 把它打开。
 *
 * 迁移后画廊跑在 `PanesHost` 的**独立 iframe** 里:
 *  - 入口按钮没了 —— pane 由 `initialPaneIds: ["canvas"]` 开箱即在,不需要也不可能去点它
 *    (`canvasOpenStore` 不跨 realm,留着就是死按钮,故已随迁移撤掉);
 *  - 画廊内的一切(格子/工作台/提示词/动作按钮)必须经 `canvasFrame(page)` 定位;
 *  - 对话消息、panelRatio 仍在宿主 realm,照旧 `page.locator`。
 *
 * ★ 跨边界的两条断言是这次迁移真正的风险点,别删:
 *  - 用例③ 轮末 auto-sync:`syncSignal` 不在 pane 协议里,靠 web.config 的宿主侧包装器补发
 *    `run("canvas","sync")`。包装器一旦失效,这条会红,而画廊看起来「只是没刷新」。
 *  - 用例① 的 `/messages` 断言:证明 pane 里点「生成」确实经 `conversation.submit` 能力
 *    穿回宿主发了用户消息,而不是在 iframe 里自嗨。
 */

const CANVAS_SOURCE = "./examples/aigc-canvas-agent";
const UNRELATED_SOURCE = "./examples/hello-agent";

async function selectSource(page: Page, source: string): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
}

/** 画廊 pane 的 iframe。单 pane 定义,故 `[data-panes-host] iframe` 唯一。 */
function canvasFrame(page: Page): FrameLocator {
  return page.frameLocator("[data-panes-host] iframe");
}

/** 选源 → 等 pane 挂载并连上宿主(画廊可见即握手完成)。 */
async function openCanvasPane(page: Page): Promise<FrameLocator> {
  await selectSource(page, CANVAS_SOURCE);
  // pane 宿主在 panelRight;initialPaneIds 让画廊 pane 开箱即在,无需入口按钮。
  await expect(page.locator("[data-panes-host]")).toBeVisible();
  const frame = canvasFrame(page);
  const gallery = frame.locator("[data-canvas-gallery]");
  // iframe 首帧 + 建连 + 首个 surface 快照下行,比同 realm 慢,给足超时。
  await expect(gallery).toBeVisible({ timeout: 20_000 });
  await expect(gallery).toHaveAttribute("data-canvas-available", "true");
  return frame;
}

test("canvas: 闭环(pane 开箱即在 → 格子展开 → 生成经对话流 → 新图进画廊),操作回流对话历史", async ({
  page,
}) => {
  const promptCalls: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (/\/sessions\/[^/]+\/messages$/.test(new URL(req.url()).pathname)) {
      promptCalls.push(req.url());
    }
  });

  const frame = await openCanvasPane(page);

  // panelRight 初始比例来自 source 声明(web.config `config.panelRatio="4:6"`)。宿主 realm。
  await expect(page.locator("[data-pi-chat-aside]")).toHaveAttribute(
    "data-pi-panel-ratio",
    "4:6",
  );

  // 统计条:pane → `route.query("gallery-stats")`。
  // ★ 本文件跑在**离线 stub agent** 下,而 stub 有自己固定的 DEMO_AGENT_ROUTES、不认本示例声明的
  //   route,故这里必然是 `failed`(宿主回 404 → guest 拒绝 → 统计条自行熄灭)。断言 `failed`
  //   而不是删掉,是因为它锁住了真正要保的行为:**route 取不到数不能连累画廊主体**。
  //   route 真实可用的正例由沙箱 e2e(真实 agent)覆盖。
  await expect(frame.locator("[data-testid=gallery-stats]")).toHaveAttribute(
    "data-state",
    "failed",
    { timeout: 30_000 },
  );

  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(1);

  // 点格子 → 展开工作台。
  await frame.locator("[data-canvas-cell]").first().click();
  await expect(frame.locator("[data-canvas-workbench]")).toBeVisible();

  // 生成走对话流(A 方案):点「生成」→ 组装 image_edit 指令 → 经 pane 的 conversation 能力
  // 穿回宿主发用户消息 → LLM(stub)调工具生图 → 轮末 auto-sync 收编 → 新图入画廊。
  await frame.locator("[data-canvas-prompt]").fill("make it warmer");
  await frame.locator('[data-canvas-action="edit"]').click();
  await expect.poll(() => promptCalls.length, { timeout: 20_000 }).toBe(1);
  // 用户气泡在宿主 realm —— 跨边界成功的证据。
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="user"]'),
  ).toContainText("image_edit");
  // 关闭工作台回画廊,断言生图产物经轮末 sync 已入快照(种子 + edit 产物 = 2)。
  await frame.locator("[data-canvas-workbench-close]").click();
  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(2, { timeout: 20_000 });
});

test("canvas: 命令后刷新 → 粘性 control:state 回放,画廊快照仍在(pane 重建后)", async ({
  page,
}) => {
  const frame = await openCanvasPane(page);

  // 产一张新图(生成经对话流:stub image_edit 分支落图 → 轮末 sync 收编)。
  await frame.locator("[data-canvas-cell]").first().click();
  await frame.locator('[data-canvas-action="edit"]').click();
  await frame.locator("[data-canvas-workbench-close]").click();
  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(2, { timeout: 20_000 });

  // 刷新:pane iframe 整个重建 + 重新握手,快照经服务端粘性 control:state 回放下行。
  // 这比迁移前的同 realm 回放更强 —— iframe 里没有任何存活的前端状态可依赖。
  await page.reload();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  const rebuilt = canvasFrame(page);
  await expect(rebuilt.locator("[data-canvas-gallery]")).toBeVisible({ timeout: 20_000 });
  await expect(rebuilt.locator("[data-canvas-cell]")).toHaveCount(2);
});

test("canvas: LLM 生图轮末 auto-sync → 画廊自动填充新图(宿主侧包装器补发 sync,不刷新)", async ({
  page,
}) => {
  const frame = await openCanvasPane(page);
  // 装配期 hydrate 种子图:1 格。
  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(1);

  // 发一轮 `canvas-gen`:stub 落一张 tool-output 图入 pending 池(不 emit surface state,模拟
  // image_generation 只落 att、不写 canvas 快照)。轮末前端 isBusy idle 边沿 → 宿主 bump
  // syncSignal → **web.config 的 ConfiguredPanesHost 包装器**发 run("canvas","sync")
  // → stub 并入 pending → 快照变化经 pane:surface 下行 → 画廊 +1。全程不刷新页面。
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("canvas-gen 生成一张图");
  await input.press("Enter");
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("canvas-gen stub");

  // ★ 回归守卫:pane 协议不传 syncSignal。若宿主侧包装器被删/失效,sync 永不触发,
  //   画廊停在 1 格 —— 而 UI 上只表现为「生成了但画廊没动」,极易被当成 stub 问题。
  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(2, { timeout: 20_000 });
});

test("canvas: B 档接线(pane upload 能力 → 旋转 90° 客户端产物落 att_ → register 回流,新图进画廊)", async ({
  page,
}) => {
  const frame = await openCanvasPane(page);
  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(1);

  // 展开工作台。
  await frame.locator("[data-canvas-cell]").first().click();
  await expect(frame.locator("[data-canvas-workbench]")).toBeVisible();

  // 接线证明:pane 侧 upload 由 `guest.upload(file)` 经协议中继(capabilities.attachments
  // = "read-write" 才放行),旋转按钮因此不再降级禁用。
  const rotate = frame.locator("[data-canvas-b-rotate]");
  await expect(rotate).toBeEnabled();

  // 端到端:点旋转 → iframe 内 canvas 旋转产 dataURI → ArrayBuffer 经协议转移给宿主上传 att_
  // → run("canvas","register") → 快照回流 → 新图进画廊(种子 + 旋转产物 = 2)。
  await rotate.click();
  await frame.locator("[data-canvas-workbench-close]").click();
  await expect(frame.locator("[data-canvas-cell]")).toHaveCount(2, { timeout: 20_000 });

  // ★ 跨源加载守卫:register 产物带的是**真实 HTTP 签名 URL**(stub 经
  //   createChildAttachmentStore 签出,非 data: URI)。打开它进工作台,舞台主图用
  //   `crossOrigin="anonymous"` 加载 —— pane 是 srcdoc + sandbox,源为 opaque "null",
  //   因此这是一次货真价实的跨源请求,分发端点必须回 Access-Control-Allow-Origin。
  //
  //   只数格子数抓不到这个:格子缩略图**不带** crossOrigin,照样显示;裂的只有舞台主图。
  //   这正是此前真机裂图而 e2e 全绿的原因(夹具用 data: URI,根本不走 CORS)。
  const registered = frame.locator("[data-canvas-cell]").first();
  await registered.click();
  await expect(frame.locator("[data-canvas-workbench]")).toBeVisible();

  const stage = frame.locator('[data-canvas-workbench] img[crossorigin="anonymous"]').first();
  await expect(stage).toBeVisible();
  // 断言**真的解码出了像素**,而不只是元素在场:CORS 失败时 <img> 依然在 DOM 里,
  // 只是 naturalWidth === 0(浏览器把它当加载失败)。
  await expect
    .poll(
      async () => await stage.evaluate((el: HTMLImageElement) => el.naturalWidth),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  // 同时确认它走的确实是 HTTP 分发端点,而不是又退回了 data: URI(否则这条守卫形同虚设)。
  const src = await stage.getAttribute("src");
  expect(src).toMatch(/\/attachments\/[^/]+\/raw\?/);
});

test("canvas: 非 AIGC source(hello-agent)不挂载 pane 宿主,pi-web 照常运行(退化 / 独立性)", async ({
  page,
}) => {
  await selectSource(page, UNRELATED_SOURCE);

  // 该 source 未声明 canvas webext → 没有画廊 pane。
  //
  // ★ 2026-07-30(spec host-builtin-panes):本断言原为 `[data-panes-host]` count 0 ——
  // 那守的是「agent 无贡献 ⇒ 面板整体不存在」。R1.1 正当推翻了它:宿主内置 pane 使面板
  // 在**任何** agent 下都出现。故判据改为「宿主 pane 宿主在,但里面只有内置那一个」——
  // 原意(canvas 退化时不得泄漏画廊)完整保留,且比原断言更精确。
  await expect(page.locator("[data-panes-host]")).toHaveCount(1);
  // 只有内置 pane 一个 iframe:画廊 pane 若被错误地挂上来,这条立刻报红。
  await expect(page.locator("[data-panes-host] iframe")).toHaveCount(1);
  await expect(page.locator('iframe[title="会话信息"]')).toHaveCount(1);

  // 独立性:输入可用、可对话,不因 canvas 缺失报错。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  await page.locator("[data-pi-input-textarea]").fill("hello without canvas");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]'),
  ).toBeVisible();
});
