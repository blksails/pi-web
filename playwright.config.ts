import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the app-shell browser e2e.
 *
 * The browser drives the full closed loop against the REAL Next server with a
 * deterministic, offline stub agent (PI_WEB_STUB_AGENT=1) — no API key, no cost,
 * no flakiness.
 *
 * Two run modes:
 *  1) Self-managed (default):
 *       pnpm exec playwright install chromium-headless-shell
 *       pnpm build
 *       pnpm e2e
 *     Playwright builds-then-starts the prebuilt server itself.
 *  2) External server (most robust; what CI / constrained envs should use):
 *       pnpm build
 *       PI_WEB_STUB_AGENT=1 PI_WEB_DEFAULT_SOURCE=./examples/hello-agent \
 *         PI_WEB_DEFAULT_MODEL=stub-model node_modules/.bin/next start -p 3100 &
 *       PI_WEB_E2E_EXTERNAL_SERVER=1 pnpm e2e
 */
const PORT = Number(process.env.PI_WEB_E2E_PORT ?? 3100);

// When PI_WEB_E2E_EXTERNAL_SERVER=1, the server is managed externally (already
// built + started with the stub env) and Playwright reuses it. Otherwise
// Playwright builds+starts the prebuilt server itself.
const externalServer = process.env.PI_WEB_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e/browser",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(externalServer
    ? {}
    : {
        webServer: {
          // Expects a prior `pnpm build` (the `.next` production build).
          // Use `pnpm e2e:build` to build then run.
          command: `node_modules/.bin/next start -p ${PORT}`,
          url: `http://127.0.0.1:${PORT}`,
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            PI_WEB_STUB_AGENT: "1",
            PI_WEB_DEFAULT_SOURCE: "./examples/hello-agent",
            PI_WEB_DEFAULT_MODEL: "stub-model",
          },
        },
      }),
});
