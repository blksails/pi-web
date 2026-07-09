import { test, expect } from "@playwright/test";

/**
 * agent 权威 surface(agent-authoritative-surface)浏览器级 e2e —— 端到端命令闭环 + 退化。
 *
 * 对真实 pi-web server + 离线 stub agent(PI_WEB_STUB_AGENT=1)运行。
 * surface-demo-agent 的 `.pi/web` 在 panelRight 槽渲染 domain="demo" 的权威快照 `{count,log}`:
 *
 *  ① 命令闭环(不过 LLM):选 `surface-demo-agent` → 探针 `surface:demo` 可见(available=true)→
 *     点 increment → `surface.run("demo","increment")` → ui-rpc **agent 转发**(payload 无 name →
 *     逃逸 host 拦截)→ 子进程派发(stub 代替 wireSurfaceBridge + createSurface)→ 改权威快照 →
 *     `control:"state"`(key=surface:demo)下行回流 → 面板计数递增。断言**无 `/messages` 请求**
 *     (命令绕过 LLM)且不新增用户消息气泡。
 *
 *  ② 退化 / 独立性(Req 5.5):切到与该 domain 无关的 source(hello-agent)→ `getCommands` 无
 *     `surface:demo` 且宿主不为其挂载 surface 面板 → pi-web 照常运行(输入可用、可对话),
 *     surface 缺失既不报错也不空转。
 *
 * 说明:「面板已挂载但 available===false → 只读」这一分支由单元测试覆盖(useSurface available=false /
 * SurfaceDemoPanel 组件),因为构建期集成车道(webext-registry)把面板挂载与 source 绑定,浏览器无法
 * 让 demo 面板挂在非 demo 的 source 上;真实 fd1 回流由 server 侧真实子进程集成测试覆盖。
 */

const SURFACE_SOURCE = "./examples/surface-demo-agent";
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

test("surface: 命令闭环(increment → agent 转发 → 快照回流 → 计数递增),命令不过 LLM", async ({
  page,
}) => {
  // 追踪 prompt(LLM)请求:POST /sessions/:id/messages。surface 命令走 /ui-rpc,不应触及此端点。
  const promptCalls: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (/\/sessions\/[^/]+\/messages$/.test(new URL(req.url()).pathname)) {
      promptCalls.push(req.url());
    }
  });

  await selectSource(page, SURFACE_SOURCE);

  // panelRight 的「人侧」surface 面板已挂载;探针存在 → available=true(非退化)。
  const panel = page.getByTestId("surface-demo-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-surface-available", "true");

  const increment = page.getByTestId("surface-demo-increment");
  await expect(increment).toBeVisible();
  await expect(page.getByTestId("surface-demo-degraded")).toHaveCount(0);

  // 尚无该 domain 快照 → 计数占位(—)。
  const count = page.getByTestId("surface-demo-count");
  await expect(count).toHaveText("—");

  // 命令闭环:点击 → run("demo","increment") → 快照回流(control:"state")→ 面板计数为 1。
  await increment.click();
  await expect(count).toHaveText("1");

  // 再点一次,验证持续闭环(2)。
  await increment.click();
  await expect(count).toHaveText("2");

  // 命令不过 LLM:整个闭环期间无 /messages(prompt)请求,亦无用户消息气泡入列。
  expect(promptCalls).toEqual([]);
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="user"]'),
  ).toHaveCount(0);
});

test("surface: 无关 source(hello-agent)不挂载 surface 面板,pi-web 照常运行(退化 / 独立性 Req 5.5)", async ({
  page,
}) => {
  await selectSource(page, UNRELATED_SOURCE);

  // 该 source 与 demo domain 无关:宿主不挂载 surface 面板(探针 surface:demo 亦不存在)。
  await expect(page.getByTestId("surface-demo-panel")).toHaveCount(0);

  // 独立性:会话全部既有能力照常 —— 输入可用、可发普通消息并得到 stub 回复,不因 surface 缺失报错。
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  await page.locator("[data-pi-input-textarea]").fill("hello without surface");
  await page.locator('[data-pi-submit-state="send"]').click();
  await expect(
    page.locator('[data-pi-chat-messages] [data-pi-message-role="assistant"]'),
  ).toBeVisible();
});
