import { test, expect, type Page } from "@playwright/test";

/**
 * aigc-canvas **沙盒(e2b baked)Chrome e2e** —— 真实链路全功能面验收。
 *
 * 与 `e2e/browser/aigc-canvas.e2e.ts`(离线 stub)不同,本 spec 对**真实 agent**运行:
 * 由 `e2e/sandbox-browser.local.mjs` 编排——aigc-canvas-agent 烘焙进沙箱镜像(e2b/ws-runner
 * 数据面,本地 kind agent-sandbox),LLM/图像/视觉调用全部真实发生;附件走全远程 S3 拓扑
 * (本地 MinIO),使沙箱内子进程 attachment-tool-bridge 与宿主指向同一后端(画廊 = 附件物化
 * 视图,Req 见 docs/sandbox-baked-agent-image.md §6)。
 *
 * 同一 spec 以两个 project 各跑一遍:
 *  - `sandbox`        → e2b baked dev(vite :5184)—— 主验收对象;
 *  - `local-baseline` → 非沙盒 local dev(vite :5185,同附件拓扑/同凭据)—— 基线对照,
 *    与 http://localhost:5173 主 dev 同构(local 模式),沙盒/基线同 spec 全绿即装配面 +
 *    行为面一致(对比验证)。
 *
 * 用例序(serial,共享一个会话;真实生成为昂贵操作,只做一次,后续用例围绕其产物展开):
 *  T1 装配面(免 LLM):就绪握手 → 4:6 布局 → launcher 入口 → 画廊挂载 available=true 空
 *     → slash 补全(/img-gen、/img-edit)→ agent routes(gallery-stats 零值结构)
 *  T2 真实生成闭环:对话流指令 → LLM 调 image_generation → 产物落 S3 附件 → 轮末 auto-sync
 *     画廊 +1 → **presigned displayUrl 真实可加载**(S3 X-Amz-Expires ≤ 7 天;曾抓 10 年 TTL
 *     被 MinIO 400 拒签的缺陷)→ gallery-stats assets=1/tool-output=1
 *  T3 刷新回放:reload → 粘性 control:state 回放,画廊快照仍在
 *  T4 工作台 + A 档二创经对话流:点格子 → 工作台 → 指令 + edit → /messages 用户消息含
 *     image_edit → LLM 真实编辑 → 新图进画廊(+1)
 *  T5 B 档客户端二创:旋转 → dataURI 上传 att_ → register 回流 → 画廊 +1
 *  T6 视觉识别(显式 model,绕过交互选择):image_vision 委派视觉模型,回答含预期内容
 *  T7 视觉识别(交互对话框路径):不带 model → ui.select 弹框 → 选项提交 → 工具完成
 *     (回归守卫:PiRpcSession 曾发自创 respond_extension_ui 包装帧,pi 不认 → 永挂)
 *  T8 退化:非 canvas source(hello-agent,已单独烘焙)→ 不挂载入口/画廊,对话照常
 *
 * 环境要求(编排器负责,缺失即 SKIP):OPENROUTER_API_KEY(生成/兜底视觉)、
 * APISERVICES_API_KEY(apiservices 视觉模型;缺失时 T6/T7 skip)。
 */

const CANVAS_SOURCE =
  process.env.PI_E2E_CANVAS_SOURCE ??
  "/Users/hysios/Projects/BlackSail/agents/pi-web/examples/aigc-canvas-agent";
const HELLO_SOURCE =
  process.env.PI_E2E_HELLO_SOURCE ??
  "/Users/hysios/Projects/BlackSail/agents/pi-web/examples/hello-agent";
const GEN_MODEL = process.env.PI_E2E_GEN_MODEL ?? "gemini-2.5-flash-image";
const VISION_MODEL = process.env.PI_E2E_VISION_MODEL ?? "apiservices/gpt-5.4-mini";
const HAS_VISION_KEY = process.env.PI_E2E_HAS_VISION_KEY === "1";

/** 建会话并等就绪(source picker → 会话页 → 输入框可用)。 */
async function startSession(page: Page, source: string): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(source);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible({ timeout: 60_000 });
  // 就绪握手(gateUntilReady):沙箱冷启动含 Pod 调度,给足窗口。
  await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 120_000 });
}

/** 经聊天输入发一条消息(真实 LLM 轮次)。 */
async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill(text);
  await page.locator('[data-pi-submit-state="send"]').click();
}

/** 等本轮结束(提交按钮回到 send 态)。 */
async function waitTurnEnd(page: Page, timeoutMs: number): Promise<void> {
  await expect(page.locator('[data-pi-submit-state="stop"]')).toHaveCount(0, {
    timeout: timeoutMs,
  });
}

test.describe.serial("aigc-canvas 沙盒真实链路(同会话贯穿)", () => {
  let sessionUrl: string;

  test("T1 装配面:就绪/布局/入口/画廊/slash 补全/agent routes", async ({ page }) => {
    await startSession(page, CANVAS_SOURCE);
    sessionUrl = page.url();

    // 布局来自 source 声明(web.config panelRatio="4:6")。
    await expect(page.locator("[data-pi-chat-aside]")).toHaveAttribute(
      "data-pi-panel-ratio",
      "4:6",
    );

    // launcherRail 入口 → 画廊挂载(真实 agent 注册了 canvas surface → available=true;空)。
    await page.locator("[data-canvas-launcher]").click();
    const gallery = page.locator("[data-canvas-gallery]");
    await expect(gallery).toBeVisible();
    await expect(gallery).toHaveAttribute("data-canvas-available", "true");
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(0);

    // slash 补全:装配期声明帧(aigcSlashCompletions)。
    const input = page.locator("[data-pi-input-textarea]");
    await input.fill("/img");
    await expect(page.locator("[data-pi-command-palette]")).toBeVisible();
    await expect(page.locator('[data-pi-command-item="img-gen"]')).toBeVisible();
    await expect(page.locator('[data-pi-command-item="img-edit"]')).toBeVisible();
    await input.press("Escape");
    await input.fill("");

    // agent 声明式 routes:清单 + 真实调用(handler 在 agent 进程内执行,零 LLM)。
    const sid = new URL(sessionUrl).pathname.split("/").pop();
    const routes = await page.request.get(`/api/sessions/${sid}/agent-routes`);
    expect(routes.status()).toBe(200);
    expect((await routes.json()).routes.map((r: { name: string }) => r.name)).toContain(
      "gallery-stats",
    );
    const stats = await page.request.get(`/api/sessions/${sid}/agent-routes/gallery-stats`);
    expect(stats.status()).toBe(200);
    expect(await stats.json()).toMatchObject({
      domain: "canvas",
      assets: 0,
      byOrigin: { upload: 0, "tool-output": 0 },
      generating: false,
    });
  });

  test("T2 真实生成闭环:对话流生图 → auto-sync 进画廊 → presign URL 可加载 → stats 计数", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto(sessionUrl);
    await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 60_000 });
    await page.locator("[data-canvas-launcher]").click();
    await expect(page.locator("[data-canvas-gallery]")).toBeVisible();

    await sendChat(
      page,
      `请立刻调用 image_generation 工具生成一张图,参数:model 用 "${GEN_MODEL}",` +
        `size 用 "1024x1024",prompt 为 "一只戴着宇航员头盔的橘猫,卡通风格"。` +
        `不要追问,直接调用;完成后一句话确认即可。`,
    );

    // 轮末 auto-sync:生成产物经附件 store(S3)收编进画廊 —— 不刷新页面。
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(1, { timeout: 240_000 });

    // presigned displayUrl 真实可加载(回归守卫:S3 presign TTL 超 604800s 被 400 拒签)。
    const img = page.locator("[data-canvas-cell] img").first();
    await expect(img).toBeVisible();
    const loaded = await img.evaluate(
      (el: HTMLImageElement) =>
        new Promise<{ ok: boolean; expires: string | null }>((resolve) => {
          const expires = new URL(el.src).searchParams.get("X-Amz-Expires");
          if (el.complete && el.naturalWidth > 0) return resolve({ ok: true, expires });
          el.addEventListener("load", () => resolve({ ok: true, expires }), { once: true });
          el.addEventListener("error", () => resolve({ ok: false, expires }), { once: true });
        }),
    );
    expect(loaded.ok).toBe(true);
    expect(Number(loaded.expires)).toBeLessThanOrEqual(604_800);

    // gallery-stats route 反映真实计数(handler 读 agent 进程内 canvas 快照)。
    const sid = new URL(sessionUrl).pathname.split("/").pop();
    const stats = await (
      await page.request.get(`/api/sessions/${sid}/agent-routes/gallery-stats`)
    ).json();
    expect(stats).toMatchObject({ assets: 1, byOrigin: { "tool-output": 1 } });
  });

  test("T3 刷新回放:粘性 control:state 回放,画廊快照仍在", async ({ page }) => {
    await page.goto(sessionUrl);
    await expect(page.locator("[data-session-active]")).toBeVisible({ timeout: 60_000 });
    await page.locator("[data-canvas-launcher]").click();
    await expect(page.locator("[data-canvas-gallery]")).toBeVisible();
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(1, { timeout: 30_000 });
  });

  test("T4 A 档二创经对话流:快捷设置偏好 → 工作台指令 edit → image_edit → 新图进画廊", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto(sessionUrl);
    await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 60_000 });

    // AIGC 快捷设置(prompt 工具栏 → state 桥 KV → 子进程 aigc 偏好):预设模型与尺寸。
    // image_edit 参数省略 model/size 时采用该偏好 —— 既避免默认模型(gpt-image-2/NEWAPI,
    // 本环境无 key)与尺寸询问对话框,也顺带验证偏好 KV 上行在沙盒链路可达子进程。
    await page.locator("[data-aigc-model-select]").click();
    await page.locator(`[role="option"][title="${GEN_MODEL}"]`).click();
    await page.locator("[data-aigc-size-select]").click();
    await page.locator('[role="option"][title="1024x1024"]').click();

    await page.locator("[data-canvas-launcher]").click();
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(1, { timeout: 30_000 });

    // 点格子 → 工作台。
    await page.locator("[data-canvas-cell]").first().click();
    await expect(page.locator("[data-canvas-workbench]")).toBeVisible();

    // A 档:生成经对话流(A 方案)——组装 image_edit 指令经 /messages 发用户消息。
    const promptCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      if (/\/sessions\/[^/]+\/messages$/.test(new URL(req.url()).pathname)) {
        promptCalls.push(req.url());
      }
    });
    await page.locator("[data-canvas-prompt]").fill("把画面色调调成黄昏暖色");
    await page.locator('[data-canvas-action="edit"]').click();
    await expect.poll(() => promptCalls.length, { timeout: 15_000 }).toBeGreaterThan(0);

    // 操作回流对话历史:用户气泡含 image_edit。
    await expect(
      page.locator('[data-pi-chat-messages] [data-pi-message-role="user"]').last(),
    ).toContainText("image_edit");

    // LLM 真实编辑 → 轮末 auto-sync → 关工作台回画廊,产物 +1(共 2 格)。
    await page.locator("[data-canvas-workbench-close]").click();
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(2, { timeout: 240_000 });
  });

  test("T5 B 档客户端二创:旋转 → 上传 att_ → register 回流画廊", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(sessionUrl);
    await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 60_000 });
    await page.locator("[data-canvas-launcher]").click();
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(2, { timeout: 30_000 });

    await page.locator("[data-canvas-cell]").first().click();
    await expect(page.locator("[data-canvas-workbench]")).toBeVisible();

    // B 档旋转:宿主注入 upload 后启用;源图能加载(presign 已修)→ 客户端旋转产物上传回流。
    const rotate = page.locator("[data-canvas-b-rotate]");
    await expect(rotate).toBeEnabled();
    await rotate.click();
    await page.locator("[data-canvas-workbench-close]").click();
    await expect(page.locator("[data-canvas-cell]")).toHaveCount(3, { timeout: 60_000 });
  });

  test("T6 视觉识别(显式 model):image_vision 委派视觉模型回答图片内容", async ({ page }) => {
    test.skip(!HAS_VISION_KEY, "缺 APISERVICES_API_KEY(视觉模型凭据),跳过");
    test.setTimeout(240_000);
    await page.goto(sessionUrl);
    await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 60_000 });

    await sendChat(
      page,
      `请立刻调用 image_vision 工具,参数:model 用 "${VISION_MODEL}",省略 image` +
        `(自动取画廊最新一张),question 为 "图里是什么动物?"。不要追问,直接调用。`,
    );
    await waitTurnEnd(page, 180_000);
    await expect(
      page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]').last(),
    ).toContainText(/猫|cat/i);
  });

  test("T7 视觉识别(交互对话框):ui.select 弹框 → 应答 → 工具完成(沙盒 ui-rpc 回流回归守卫)", async ({
    page,
  }) => {
    test.skip(!HAS_VISION_KEY, "缺 APISERVICES_API_KEY(视觉模型凭据),跳过");
    test.setTimeout(240_000);
    await page.goto(sessionUrl);
    await expect(page.locator("[data-pi-input-textarea]")).toBeEnabled({ timeout: 60_000 });

    await sendChat(
      page,
      "请立刻调用 image_vision 工具,省略 model 与 image 参数," +
        'question 为 "图里的动物戴着什么?"。不要追问,直接调用。',
    );

    // ui.select 交互请求渲染为聊天流内选择框:选 apiservices 视觉模型并提交。
    const dialogOption = page.getByRole("radio", { name: new RegExp(VISION_MODEL) });
    await expect(dialogOption).toBeVisible({ timeout: 120_000 });
    await dialogOption.check();
    await page.getByRole("button", { name: "提交" }).click();

    // 回归守卫:应答必须回流沙箱子进程(曾发 pi 不认的包装帧 → 工具永挂)。
    await waitTurnEnd(page, 180_000);
    await expect(
      page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]').last(),
    ).toContainText(/头盔|helmet|宇航/i);
  });
});

test("T8 退化:非 canvas source 不挂载入口/画廊,对话照常(真实 LLM)", async ({ page }) => {
  test.setTimeout(240_000);
  await startSession(page, HELLO_SOURCE);

  // 无 surface:canvas 探针 + 未声明 canvas 槽 → 不挂载。
  await expect(page.locator("[data-canvas-launcher]")).toHaveCount(0);
  await expect(page.locator("[data-canvas-gallery]")).toHaveCount(0);

  // 独立性:真实 LLM 对话可用。
  await sendChat(page, "只回复两个字:你好");
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]'),
  ).toBeVisible({ timeout: 120_000 });
});
