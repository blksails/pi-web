import { test, expect } from "@playwright/test";
import * as path from "node:path";

/**
 * publish 预览浏览器 e2e(spec publish-host-command,任务 4.2)。
 *
 * 对 project "install" 运行(已有 admin 放行 + 隔离落盘)。
 *
 * ★ 路径基准(真机实测,别照抄直觉):会话源用 `./examples` 时,**会话 cwd 就是 `<repo>/examples`
 *   本身**,不是仓库根 —— `GET /publish-sources` 给出的候选是 `./plugin-code-review-agent`
 *   这种形态,而非 `./examples/plugin-code-review-agent`。相对路径一律以此为基准;
 *   `examples/` 之外的夹具只能走绝对路径。
 *
 * 三条断言各锁一条需求:
 *  - 成功预览卡片可见,且**含未签名声明**(Req 2.1)—— 这条是"预览≠发布"的用户可见证据;
 *  - 清单 kind 与命令不符 → 拒绝并指路(Req 3.2);
 *  - 裸 publish(无 --dry-run)→ PUBLISH_NOT_AVAILABLE(Req 6.1)。
 *
 * 夹具选型(设计阶段实测,勿改):
 *  - `e2e/fixtures/publish-sample-agent` —— 自建最小 agent 包,**无构建依赖**;
 *  - `examples/plugin-code-review-agent` —— kind=plugin,用作"类别不符"的真实来源;
 *  - **不要**用 examples 下那两个真实 agent 包:它们的 `.pi/web/dist` 是 gitignored
 *    构建产物,fresh worktree 上 `compile()` 恒失败于 WEBEXT_SOURCE_WITHOUT_DIST。
 */

const SOURCE = "./examples";

/**
 * 最小 agent 夹具的**绝对**路径:它在 `e2e/fixtures/` 下,不在会话 cwd(`<repo>/examples`)之内,
 * 故相对路径无法指到 —— 用 `process.cwd()`(仓库根)拼绝对路径,与 playwright.config 同惯例
 * (该文件按 CJS 转译,`import.meta` 会直接语法错)。
 */
const SAMPLE_AGENT = path.join(process.cwd(), "e2e", "fixtures", "publish-sample-agent");

async function startSession(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
}

/**
 * 键入完整命令并等命令面板关闭后提交 —— 与 agent-plugin-commands.e2e 同一手法:
 * 有 argSpec 的命令在有候选时会拦截 Enter,故必须先等候选清空。
 */
async function submitCommand(
  page: import("@playwright/test").Page,
  text: string,
): Promise<void> {
  const input = page.locator("[data-pi-input-textarea]");
  await input.click();
  await input.fill(text);
  await expect(page.locator("[data-pi-command-palette]")).toHaveCount(0, { timeout: 10000 });
  await input.press("Enter");
}

test("publish 预览成功 → 卡片含包身份、文件计数与**未签名声明**", async ({ page }) => {
  await startSession(page);
  await submitCommand(page, `/agent publish ${SAMPLE_AGENT} --dry-run`);

  const card = page.locator("[data-pi-publish-preview]");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toHaveAttribute("data-pi-publish-ok", "true");
  await expect(card.locator("[data-pi-publish-id]")).toContainText("e2e/publish-sample@0.1.0");

  // ★ Req 2:用户必须看得到"这只是预览、且未签名",否则会把预览当成发布许可。
  await expect(card.locator("[data-pi-publish-disclaimer]")).toBeVisible();
  await expect(card.locator("[data-pi-publish-unsigned]")).toBeVisible();
  await expect(card.locator("[data-pi-publish-grant-unchecked]")).toBeVisible();

  // 不得出现让人以为已发布的措辞。
  await expect(card).not.toContainText("已发布");
});

test("清单 kind 与命令不符 → 拒绝并指向另一条命令", async ({ page }) => {
  await startSession(page);
  // code-review 的清单是 kind=plugin,用 /agent publish 预览它应被拦下。
  // 相对路径,基准 = 会话 cwd(`<repo>/examples`)。
  await submitCommand(page, "/agent publish ./plugin-code-review-agent --dry-run");

  const card = page.locator("[data-pi-publish-preview]");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toHaveAttribute("data-pi-publish-ok", "false");
  await expect(card.locator("[data-pi-publish-error]")).toContainText("PUBLISH_KIND_MISMATCH");
  await expect(card.locator("[data-pi-publish-hint]")).toContainText("/plugin publish");
});

test("裸 publish(无 --dry-run)→ PUBLISH_NOT_AVAILABLE,并指引 --dry-run", async ({ page }) => {
  await startSession(page);
  await submitCommand(page, `/agent publish ${SAMPLE_AGENT}`);

  const card = page.locator("[data-pi-publish-preview]");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toHaveAttribute("data-pi-publish-ok", "false");
  await expect(card.locator("[data-pi-publish-error]")).toContainText("PUBLISH_NOT_AVAILABLE");
  await expect(card.locator("[data-pi-publish-hint]")).toContainText("--dry-run");
});
