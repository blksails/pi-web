import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";

/**
 * provider 变更在各消费面即时反映(spec: multi-gateway-providers,任务 6.6;
 * Req 11.3, 11.4, 11.5)。
 *
 * 完成判据(tasks.md):e2e 断言新增 provider 后设置界面无需重启即出现该 provider。
 *
 * ### 本用例覆盖的是「带外变更」这一档(TTL 兜底),不是「界面内保存」那一档
 *
 * 变更事件驱动失效(任务 6.6 主机制)只在 `useConfigDomain.save()` 成功后广播,即只有
 * **经由设置界面「保存」按钮**完成的变更才会立即(不等 TTL)反映。「使用者自己在界面里
 * 填完表单点保存后立即看到新 provider」这条断言属于驱动该表单的 5.4 面板自己的职责,
 * 已加进 `provider-management.e2e.ts`(见其「保存后立即反映」用例),本文件不重复驱动
 * 整条添加流程(避免与 5.4 产生未声明的跨任务耦合)。
 *
 * 本文件验证的是**另一条同样必须成立的路径**:provider 变更并非总是经过这个 SPA 会话
 * 自己触发的保存(可能是另一个标签页保存的、或运维直接改了 `providers.json`、或像本用例
 * 这样经 API 直接 PUT)。这类「带外变更」没有触发本会话内的 `pi-web:config-saved` 事件,
 * 只能靠墙钟 TTL 兜底——`MODEL_OPTIONS_CACHE_TTL_MS`(见
 * `packages/ui/src/config/fields/model-select-field.tsx`)过期后,下一次挂载才会重新
 * 取数。断言不使用固定 `waitForTimeout` 睡过这个常量,而是反复做 SPA 内导航(切走再切回
 * 「通用」面板,逼出 `ModelSelectField` 重新挂载)直到取到新 provider 或超时——真实反映了
 * 「使用者多次切换面板」这种自然使用路径,也不因为把 TTL 改短/改长而让用例本身报红。
 *
 * ### 变更经 API 而非直接写 `providers.json` 文件
 *
 * `PUT /api/config/providers` 是**整份文档替换**(`createCustomProviderRegistry` 按
 * `PI_WEB_E2E_AGENT_DIR` 每请求重新读盘,服务端无缓存问题)。经由运行本用例的 server 自身
 * 发起变更,天然与该 server 实际读到的状态一致;若改为直接写文件,则该文件必须恰好等于
 * 本次 playwright 运行分配给**当前 server** 的 agentDir —— 一旦 `playwright.config.ts`
 * 的 fs 档命中 `reuseExistingServer`(与本机另一个已在跑的 playwright 进程共用同一个
 * server),`PI_WEB_E2E_AGENT_DIR` 与该 server 实际使用的 agentDir 就会不同,直接写文件的
 * 断言会静默落空。
 *
 * ⚠ 已知的 e2e 隔离缺口(与本用例的稳定性直接相关,非本任务边界内的产品缺陷,记录以防
 * 复现时被误判为「热反映失效」):fs 档用固定端口(`PI_WEB_E2E_PORT`,默认 3100)+
 * `reuseExistingServer: true`。若本机同时另跑一个 playwright 进程(或手工起了
 * `node dist/server.mjs` 监听同端口),本次运行会静默复用那个 server 而不是自己起一个——
 * 而 `PUT /api/config/providers` 是整份替换,两次运行各自的 `beforeEach`/`afterEach`
 * 删文件 + 写入会互相清场,产生本文件与 `provider-management.e2e.ts` 的假性 flaky。
 * 排查步骤:跑本用例前先 `lsof -nP -iTCP:3100 -sTCP:LISTEN` 确认端口未被除本次
 * playwright 外的进程占用;若占用,先杀掉再重跑。
 */
const agentDir = process.env.PI_WEB_E2E_AGENT_DIR;
if (agentDir === undefined || agentDir.length === 0) {
  throw new Error("PI_WEB_E2E_AGENT_DIR 未设置——本用例依赖 playwright.config.ts 分配的隔离目录");
}
const PROVIDERS_JSON = join(agentDir, "providers.json");
const removeProvidersJson = (): void => {
  rmSync(PROVIDERS_JSON, { force: true });
};

// TTL 兜底档的轮询预算:须 > MODEL_OPTIONS_CACHE_TTL_MS(5000ms),留足余量吸收压载下的
// 调度抖动 + 多轮 SPA 导航开销,而不是卡死在恰好等于 TTL 的边界上。
const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVALS_MS = [500, 1_000, 2_000];

test.describe("provider 带外变更后各消费面反映(TTL 兜底档,Req 11.3/11.4/11.5)", () => {
  test.beforeEach(() => {
    removeProvidersJson();
  });
  test.afterEach(() => {
    removeProvidersJson();
  });

  test("经 API 直接 PUT(不经本会话「保存」按钮,即无 config-saved 事件)→ 反复 SPA 内切面板重新挂载后最终出现该 provider,不整页刷新(完成判据)", async ({
    page,
  }) => {
    const providerId = `e2e-hotreflect-${Date.now()}`;

    await page.goto("/settings");
    await expect(page.locator("[data-pi-settings-shell]")).toBeVisible();

    // ① 先进入「通用」面板,触发 defaultProvider 下拉(providerSelect)的首次取数,
    //    命中 output=text 筛选桶——此刻新 provider 还不存在。
    await page.locator('[data-pi-settings-nav="settings"]').click();
    const providerCombobox = page
      .locator('[data-pi-model-select="providerSelect"]')
      .getByRole("combobox");
    await expect(providerCombobox).toBeVisible();
    await providerCombobox.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: providerId })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ② 带外变更:经本页面自身的 server(同 origin,故与该 server 实际读到的 agentDir
    //    天然一致)直接 PUT 整份 providers 文档——不点界面「保存」按钮,不广播
    //    `pi-web:config-saved` 事件,只能靠 TTL 兜底反映。
    const origin = new URL(page.url()).origin;
    const putRes = await page.request.put(`${origin}/api/config/providers`, {
      data: {
        values: {
          providers: [
            {
              id: providerId,
              baseUrl: "https://api.e2e-hotreflect.example.com/v1",
              models: [{ id: "model-a" }],
            },
          ],
        },
      },
    });
    expect(putRes.ok()).toBe(true);
    // 响应体除 `ok` 外还带 `protocolVersion` 等元数据字段——只钉 `ok`,不逐字节比对
    // 整份响应(避免与本任务无关的字段漂移把这条断言变脆)。
    expect(await putRes.json()).toMatchObject({ ok: true });

    // ③ 反复做 SPA 内导航(切到 Provider 面板再切回「通用」,逼出 `ModelSelectField`
    //    以 `key={panel.id}` 重新挂载)直到取到新 provider 或超时——不用固定 sleep,
    //    全程不调用 page.reload()。
    await expect
      .poll(
        async () => {
          await page.locator('[data-pi-settings-nav="providers"]').click();
          await page.locator('[data-pi-settings-nav="settings"]').click();
          const combobox = page
            .locator('[data-pi-model-select="providerSelect"]')
            .getByRole("combobox");
          await expect(combobox).toBeVisible();
          await combobox.click();
          await expect(page.getByRole("listbox")).toBeVisible();
          const found = (await page.getByRole("option", { name: providerId }).count()) > 0;
          await page.keyboard.press("Escape");
          return found;
        },
        { timeout: POLL_TIMEOUT_MS, intervals: POLL_INTERVALS_MS },
      )
      .toBe(true);
  });
});
