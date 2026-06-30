import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Playwright config for the app-shell browser e2e.
 *
 * The browser drives the full closed loop against the REAL Next server with a
 * deterministic, offline stub agent (PI_WEB_STUB_AGENT=1) — no API key, no cost.
 *
 * Dual-backend session persistence:
 *  - project `fs`     → server on PORT (SESSION_STORE=fs,  temp SESSION_STORE_ROOT)
 *  - project `sqlite` → server on PORT+1 (SESSION_STORE=sqlite, temp SESSION_STORE_PATH)
 * Most specs run only on `fs`; `session-persistence.e2e.ts` runs on BOTH so the
 * persist → URL → cold-resume → continue loop is verified on each backend.
 * Temp storage paths are exposed via env for the spec to assert on-disk artifacts.
 *
 * Run modes:
 *  1) Self-managed:  pnpm exec playwright install chromium-headless-shell
 *                    pnpm build && pnpm e2e
 *  2) External servers (CI / when a dev server must stay up — avoids `next build`
 *     clobbering a running `next dev`'s shared .next):
 *       pnpm build
 *       SESSION_STORE=fs     SESSION_STORE_ROOT=$FS_ROOT  ...stub env... next start -p 3100 &
 *       SESSION_STORE=sqlite SESSION_STORE_PATH=$DB       ...stub env... next start -p 3101 &
 *       PI_WEB_E2E_EXTERNAL_SERVER=1 PI_WEB_E2E_FS_ROOT=$FS_ROOT PI_WEB_E2E_SQLITE_PATH=$DB pnpm e2e
 */
const PORT_FS = Number(process.env.PI_WEB_E2E_PORT ?? 3100);
const PORT_SQLITE = PORT_FS + 1;
const externalServer = process.env.PI_WEB_E2E_EXTERNAL_SERVER === "1";

// Isolated temp storage per run; exposed via env so the spec can assert artifacts.
const fsRoot =
  process.env.PI_WEB_E2E_FS_ROOT ??
  fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-fs-"));
const sqlitePath =
  process.env.PI_WEB_E2E_SQLITE_PATH ??
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-sqlite-")), "sessions.db");
process.env.PI_WEB_E2E_FS_ROOT = fsRoot;
process.env.PI_WEB_E2E_SQLITE_PATH = sqlitePath;

// Isolated pi agent config dir for the e2e servers (PI_WEB_AGENT_DIR override).
// Two reasons:
//  1. Tests that save config via the Settings UI (logging enabled/namespaces)
//     write into this temp dir instead of polluting the real ~/.pi/agent.
//  2. Logging now defaults to OFF; the logging e2e seeds logging.json with
//     enabled:true here so the log-display assertions still exercise the
//     "enabled" path (default-off behavior is covered by unit tests).
const agentDir =
  process.env.PI_WEB_E2E_AGENT_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-agent-"));
process.env.PI_WEB_E2E_AGENT_DIR = agentDir;
fs.mkdirSync(agentDir, { recursive: true });
fs.writeFileSync(
  path.join(agentDir, "logging.json"),
  JSON.stringify({ enabled: true, level: "debug" }, null, 2),
  "utf8",
);

const stubEnv = {
  PI_WEB_STUB_AGENT: "1",
  PI_WEB_DEFAULT_SOURCE: "./examples/hello-agent",
  PI_WEB_DEFAULT_MODEL: "stub-model",
  PI_WEB_AGENT_DIR: agentDir,
  // bang shell 命令(spec bang-shell-command)e2e 开启档:服务端权威门控开启,
  // 配合 build 期 NEXT_PUBLIC_PI_WEB_BASH_ENABLED=1(前端体验)端到端验证。
  // 关闭档(前端关 ! 当普通消息 / 后端关 404)由单元/集成测试覆盖,避免双 build 成本。
  PI_WEB_BASH_ENABLED: "1",
};

// Forward an isolated build dir to the servers so `next start` serves the
// e2e-only build (NEXT_DIST_DIR=.next-e2e) — never the .next a running
// `next dev` is using. No-op when unset.
const distEnv: Record<string, string> = process.env.NEXT_DIST_DIR
  ? { NEXT_DIST_DIR: process.env.NEXT_DIST_DIR }
  : {};

// 自管 webServer 用 `next start`,而 next.config 默认 output:"standalone"(CLI 打包),
// 二者不兼容。next start 在启动时重读 config,故运行期也须置 PI_WEB_DISABLE_STANDALONE=1
// (仅 build 期设不够),否则 next start 拒绝服务。external server 模式自带该 env。
const disableStandaloneEnv = { PI_WEB_DISABLE_STANDALONE: "1" };

export default defineConfig({
  testDir: "./e2e/browser",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "fs",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${PORT_FS}`,
      },
    },
    {
      // sqlite backend runs ONLY the persistence spec (the rest are backend-agnostic).
      name: "sqlite",
      testMatch: /session-persistence\.e2e\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${PORT_SQLITE}`,
      },
    },
  ],
  ...(externalServer
    ? {}
    : {
        webServer: [
          {
            command: `node_modules/.bin/next start -p ${PORT_FS}`,
            url: `http://127.0.0.1:${PORT_FS}`,
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
              ...stubEnv,
              ...distEnv,
              ...disableStandaloneEnv,
              SESSION_STORE: "fs",
              SESSION_STORE_ROOT: fsRoot,
            },
          },
          {
            command: `node_modules/.bin/next start -p ${PORT_SQLITE}`,
            url: `http://127.0.0.1:${PORT_SQLITE}`,
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
              ...stubEnv,
              ...distEnv,
              ...disableStandaloneEnv,
              SESSION_STORE: "sqlite",
              SESSION_STORE_PATH: sqlitePath,
            },
          },
        ],
      }),
});
