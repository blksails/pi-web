import { defineConfig, devices } from "@playwright/test";

/**
 * 沙盒(e2b baked)浏览器 e2e 的 playwright 配置。
 *
 * 与主配置 `playwright.config.ts`(离线 stub + 自管 webServer)不同:
 *  - server 全部**外部编排**(`e2e/sandbox-browser.local.mjs`:门控 → MinIO → bake →
 *    dev:e2b:local / dev-all 基线),本配置不起 webServer;
 *  - 对 **dev 面**(vite)跑,而非 dist 产物 —— source 声明的 `.pi/web` 由 vite dev 车道
 *    动态解析,无需 webext fixtures 预构建(故无 globalSetup);
 *  - 真实 LLM/图像/视觉调用 → 长超时、串行、单 worker、失败不重试(昂贵操作不盲重)。
 *
 * baseURL 经 env 注入:PI_E2E_BASE_URL(编排器按 phase 分别设 :5184 / :5185)。
 */
const BASE_URL = process.env.PI_E2E_BASE_URL ?? "http://localhost:5184";
const PROJECT = process.env.PI_E2E_PROJECT ?? "sandbox";

export default defineConfig({
  testDir: "./e2e/sandbox-browser",
  testMatch: /.*\.e2e\.ts/,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: PROJECT,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: BASE_URL,
      },
    },
  ],
});
