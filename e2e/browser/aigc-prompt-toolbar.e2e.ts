import { test, expect } from "@playwright/test";

/**
 * aigc-prompt-toolbar 浏览器级 e2e —— 工具排 AIGC 快捷设置(模型/尺寸偏好)。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行(隔离产物目录 PI_WEB_DIST_DIR
 * build + PI_WEB_E2E_EXTERNAL_SERVER=1 手动 fs:3100)。
 *
 *  ① 渲染位置:选 aigc-canvas-agent(source 声明 promptToolbar 槽)→ 快捷设置出现在公共
 *     composer 上方的独立 pill 排;公共工具排仍保留发送键(Req 1.1/2.1)。
 *  ② 选择与保留:选模型 → 触发器回显;刷新页面 → 回显仍在(localStorage seed + 会话 KV;
 *     Req 2.3/6.1)。stub 未跑 aigcExtension 清单下发 → 选项来自组件 fallback 常量。
 *  ③ 追问写回回显:`set-aigc-pref <model>` 哨兵使 stub 派发 aigc.model 偏好帧(模拟图像工具
 *     交互追问写回)→ 选择器回显自动变化,无刷新(Req 5.2 回归守卫:宿主漏透传 state 或组件
 *     漏订阅时此断言失败)。
 *  ④ 退化/独立性:hello-agent 未声明 promptToolbar → 零渲染快捷设置,输入区照常可用(Req 7.1)。
 *
 * 注:`aigc-canvas-agent` 已迁隔离 Pane 形态(isolated-panes Wave 5),画廊进了 iframe ——
 * 但 `promptToolbar` **刻意保留为槽**:快捷设置挂在输入区上方(宿主 realm),经 state 桥 KV
 * 与 agent 进程里的图像工具通信,与 pane 化无关。
 * 故本文件的定位全在宿主 realm,迁移后一行未改 —— 这也正是「该 pane 化的才 pane 化」的验证。
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

test("toolbar: 快捷设置渲染在公共 composer 上方、发送键仍可用", async ({ page }) => {
  await selectSource(page, CANVAS_SOURCE);

  const qs = page.locator("[data-aigc-quick-settings]");
  await expect(qs).toBeVisible();
  await expect(page.locator("[data-aigc-model-select]")).toBeVisible();
  await expect(page.locator("[data-aigc-size-select]")).toBeVisible();

  // 位置断言:agent pill 仍由 promptToolbar 槽提供,公共工具排独立保留发送键。
  const placement = await page.evaluate(() => {
    const qsEl = document.querySelector("[data-aigc-quick-settings]");
    const submit = document.querySelector("[data-pi-submit-state]");
    const slot = document.querySelector("[data-pi-ext-prompt-toolbar]");
    const toolbar = document.querySelector("[data-pi-prompt-input-toolbar]");
    const input = document.querySelector("[data-pi-prompt-input]");
    if (!qsEl || !submit || !slot || !toolbar || !input) return "missing";
    if (!slot.contains(qsEl) || !toolbar.contains(submit)) return "wrong-owner";
    const pos = slot.compareDocumentPosition(input);
    // DOCUMENT_POSITION_FOLLOWING(4):输入框在 pill 槽之后。
    return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? "ok" : "wrong-order";
  });
  expect(placement).toBe("ok");
});

test("toolbar: 选择模型 → 回显;刷新后选择仍在(本地记忆 + 会话偏好)", async ({ page }) => {
  await selectSource(page, CANVAS_SOURCE);

  // 打开模型下拉(Radix Select portal)→ 选一个 fallback 清单里的模型。
  await page.locator("[data-aigc-model-select]").click();
  await page.getByRole("option", { name: "gpt-image-2", exact: true }).click();
  await expect(page.locator("[data-aigc-model-select]")).toContainText("gpt-image-2");

  // 刷新:localStorage 记忆 seed 回填 + 回显恢复。
  await page.reload();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-aigc-model-select]")).toContainText("gpt-image-2");
});

test("toolbar: 工具追问写回(stub 派发偏好帧)→ 选择器回显自动更新,无刷新", async ({
  page,
}) => {
  await selectSource(page, CANVAS_SOURCE);
  // 初始默认态占位。
  await expect(page.locator("[data-aigc-model-select]")).toContainText("图像模型");

  // 哨兵轮:stub 收到后 emitState("aigc.model","qwen-image-2.0")(模拟追问写回下行帧)。
  const input = page.locator("[data-pi-input-textarea]");
  await input.fill("set-aigc-pref qwen-image-2.0");
  await input.press("Enter");
  await expect(page.locator("[data-pi-chat-messages]")).toContainText("set-aigc-pref stub");

  // 关键断言:未刷新,选择器回显经订阅自动变为写回值。
  await expect(page.locator("[data-aigc-model-select]")).toContainText("qwen-image-2.0");
});

test("toolbar: 非 AIGC source(hello-agent)零渲染快捷设置,输入区照常可用", async ({
  page,
}) => {
  await selectSource(page, UNRELATED_SOURCE);

  await expect(page.locator("[data-aigc-quick-settings]")).toHaveCount(0);
  await expect(page.locator("[data-pi-ext-prompt-toolbar]")).toHaveCount(0);

  // 独立性:输入可用、可对话。
  await page.locator("[data-pi-input-textarea]").fill("hello without quick settings");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]'),
  ).toBeVisible();
});
