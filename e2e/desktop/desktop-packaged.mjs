#!/usr/bin/env node
/**
 * 桌面壳「已打包产物真实会话」黑盒 e2e（spec electron-to-tauri 任务 4.7，Req 10.1/10.3）。
 *
 * 启动**实际打包产物**（.app 内的二进制，走 packaged 分支：`resource_dir()` 定位 dist、
 * 主可执行同目录定位随包 node），跑一次真实会话。
 *
 * ★ 这是唯一能捕获下列回归的验证——未打包 e2e 一律抓不到：
 *   - `bundle.resources` 未把 `dist/` 纳入，或 `node_modules` 被剥空
 *   - sidecar 落盘位置推导错误（node 在 `Contents/MacOS/`，dist 在 `Contents/Resources/`，
 *     两者来源不同，混用即崩）
 *
 * 前置：`pnpm build:dist` + `node scripts/fetch-node-sidecar.mjs`
 *       + `pnpm --filter @blksails/pi-web-desktop exec tauri build --bundles app`
 * 跑法：`node e2e/desktop/desktop-packaged.mjs`（或 `pnpm e2e:desktop:packaged`）
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  check,
  cleanupAgentDir,
  countShellNodeProcesses,
  launchShell,
  makeAgentDir,
  reportAndExit,
  runSessionViaBrowser,
  startMockProvider,
  stopShell,
  waitNoShellNodeProcesses,
  waitPortFree,
  waitReady,
} from "./shared.mjs";

const PORT = 34840;
const REPLY_TOKEN = "PIWEBTAURIPACKAGEDOK";
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/electron-to-tauri/evidence");

const APP = join(ROOT, "desktop/src-tauri/target/release/bundle/macos/pi-web.app");
const APP_BIN = join(APP, "Contents/MacOS/pi-web");
const APP_NODE = join(APP, "Contents/MacOS/node");
const APP_SERVER = join(APP, "Contents/Resources/dist/server.mjs");

async function main() {
  if (process.platform !== "darwin") {
    console.error("本 e2e 仅在 macOS 上有意义（.app 形态）；其他平台请见 CI 的对应目标。");
    process.exit(1);
  }
  if (!existsSync(APP_BIN)) {
    console.error(
      `✗ 缺少打包产物：${APP_BIN}\n  请先执行：\n` +
        `    pnpm build:dist\n` +
        `    node scripts/fetch-node-sidecar.mjs\n` +
        `    pnpm --filter @blksails/pi-web-desktop exec tauri build --bundles app`,
    );
    process.exit(1);
  }

  // 打包结构断言：这两条正是 design 的 R4 风险，且只有打包态能验。
  check("随包 node 落在主可执行同目录(Contents/MacOS/node)", existsSync(APP_NODE));
  check("自包含产物落在资源目录(Contents/Resources/dist/server.mjs)", existsSync(APP_SERVER));

  const mock = await startMockProvider(REPLY_TOKEN);
  const agentDir = makeAgentDir(mock.port);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const shell = launchShell({
    exePath: APP_BIN,
    port: PORT,
    env: {
      PI_WEB_AGENT_DIR: agentDir,
      PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
      PI_WEB_DEFAULT_CWD: ROOT,
    },
  });

  try {
    const ready = await waitReady(PORT, 90_000);
    check("打包 app 拉起本地回环后端(server 从 Resources/dist 起, node_modules 未被剥空)", ready);
    if (!ready) return;

    const session = await runSessionViaBrowser(PORT, REPLY_TOKEN, {
      screenshotPath: join(EVIDENCE_DIR, "desktop-packaged.png"),
    });
    check("打包 app 真实会话跑通", session.sawToken);
    check(`mock provider 被真实 runner 调用(≥1 次, 实际 ${mock.getCalls()})`, mock.getCalls() >= 1);
  } finally {
    await stopShell(shell.proc);
    check("退出后本地端口释放", await waitPortFree(PORT));
    // 打包态的 sidecar 路径与未打包不同，须按 .app 内的绝对路径匹配。
    const clean = await waitNoShellNodeProcesses(APP_NODE);
    check(`退出后无孤儿随包 node 进程(残留 ${countShellNodeProcesses(APP_NODE)})`, clean);

    mock.server.close();
    cleanupAgentDir(agentDir);
  }
  reportAndExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
