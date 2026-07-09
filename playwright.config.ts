import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Playwright config for the app-shell browser e2e.
 *
 * The browser drives the full closed loop against the REAL pi-web server with a
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
 *                    pnpm build:dist && pnpm e2e
 *  2) External servers (CI / when a dev server must stay up):
 *       pnpm build:dist
 *       SESSION_STORE=fs     SESSION_STORE_ROOT=$FS_ROOT  ...stub env... PORT=3100 node dist/server.mjs &
 *       SESSION_STORE=sqlite SESSION_STORE_PATH=$DB       ...stub env... PORT=3101 node dist/server.mjs &
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

// 隔离产物目录:`vite build --outDir` / esbuild 的 PI_WEB_DIST 均可指向它,
// 使 e2e 构建不与开发态产物互相覆盖。默认 `dist`。
//
// 旧宿主的 `PI_WEB_DISABLE_STANDALONE=1` hack 随 Next 一并消失:那是因为
// `next.config` 默认 `output:"standalone"` 与 `next start` 不兼容才需要的。
const DIST_DIR = process.env.PI_WEB_DIST_DIR ?? "dist";
const SERVER_ENTRY = path.join(DIST_DIR, "server.mjs");

const stubEnv = {
  PI_WEB_STUB_AGENT: "1",
  PI_WEB_DEFAULT_SOURCE: "./examples/hello-agent",
  PI_WEB_DEFAULT_MODEL: "stub-model",
  PI_WEB_AGENT_DIR: agentDir,
  // bang shell 命令(spec bang-shell-command)e2e 开启档:服务端权威门控开启。
  PI_WEB_BASH_ENABLED: "1",
  // 前端门控现由 `GET /api/bootstrap` 在**运行时**下发(spec vite-spa-migration Req 2.2),
  // 不再需要 build 期内联 —— 故在 server env 里设置即可,一次构建服务两种门控档。
  NEXT_PUBLIC_PI_WEB_BASH_ENABLED: "1",
  // 前端产物目录(server 以仓库根为 cwd 启动,`clientDir()` 默认 `cwd/client` 不存在)。
  PI_WEB_CLIENT_DIR: path.join(process.cwd(), DIST_DIR, "client"),
};

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
            command: `node ${SERVER_ENTRY}`,
            port: PORT_FS,
            stdout: "pipe",
            stderr: "pipe",
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
              ...stubEnv,
              PORT: String(PORT_FS),
              SESSION_STORE: "fs",
              SESSION_STORE_ROOT: fsRoot,
            },
          },
          {
            // ⚠ 两个 webServer 的 command 不能逐字相同(playwright 会视作同一个),
            // 故给 sqlite 档附一个被 server 忽略的 argv 标记以示区分。
            command: `node ${SERVER_ENTRY} --store=sqlite`,
            port: PORT_SQLITE,
            stdout: "pipe",
            stderr: "pipe",
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
              ...stubEnv,
              PORT: String(PORT_SQLITE),
              SESSION_STORE: "sqlite",
              SESSION_STORE_PATH: sqlitePath,
            },
          },
        ],
      }),
});
