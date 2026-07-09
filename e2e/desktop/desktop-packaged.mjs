#!/usr/bin/env node
/**
 * 桌面壳「已打包产物真实会话」黑盒 e2e（spec electron-to-tauri 任务 4.7，Req 10.1/10.3）。
 *
 * 启动**实际打包产物**（.app 内的二进制，走 packaged 分支：`resource_dir()` 定位随包载荷、
 * 主可执行同目录定位随包 node），经历一次**真实的首启解包**后跑一次真实会话。
 *
 * ★ 这是唯一能捕获下列回归的验证——未打包 e2e 一律抓不到（它们走仓库内 `dist/` 分支，
 *   根本不解包）：
 *   - `bundle.resources` 未把 `payload/` 纳入，或安装包里仍残留未压缩的 `dist/` 树
 *   - 解包出的产物根缺条目（如 `node_modules` 被剥空）
 *   - 三条路径来源混用：node 在 `Contents/MacOS/`、载荷在 `Contents/Resources/payload/`、
 *     解包结果在 `~/.pi/web/runtime/<version>-<digest12>/dist/`
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
  expectedRuntimeDir,
  makeRuntimeRoot,
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
const APP_PAYLOAD = join(APP, "Contents/Resources/payload");
const APP_LEGACY_DIST = join(APP, "Contents/Resources/dist");

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

  // 打包结构断言：这三条正是 design 的 R1/R4 风险，且只有打包态能验。
  check("随包 node 落在主可执行同目录(Contents/MacOS/node)", existsSync(APP_NODE));
  check("随包载荷落在资源目录(Contents/Resources/payload/)", existsSync(join(APP_PAYLOAD, "payload.json")));
  check("安装包不再内嵌未压缩的 dist/ 树", !existsSync(APP_LEGACY_DIST));

  // 隔离的运行时根：既保证首启一定解包，也不污染用户真实的 ~/.pi/web（Req 8.4）。
  const runtime = makeRuntimeRoot();
  const runtimeDir = expectedRuntimeDir(APP_PAYLOAD);
  const targetDir = join(runtime.dir, runtimeDir);
  check("解包前运行时目录不存在(本次必然经历真实首启解包)", !existsSync(targetDir));

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
      PI_WEB_RUNTIME_ROOT: runtime.dir,
    },
  });

  try {
    const ready = await waitReady(PORT, 120_000); // 首启含真实解包
    check("打包 app 首启解包并拉起本地回环后端", ready);
    if (!ready) return;

    check("运行时目录已落地且带完整性标记(.ok)", existsSync(join(targetDir, ".ok")));
    check("解包出的产物根含 node_modules(未被剥空)", existsSync(join(targetDir, "dist", "node_modules")));
    check("解包出的产物根含入口 server.mjs", existsSync(join(targetDir, "dist", "server.mjs")));

    const session = await runSessionViaBrowser(PORT, REPLY_TOKEN, {
      screenshotPath: join(EVIDENCE_DIR, "desktop-packaged.png"),
    });
    check("打包 app 真实会话跑通", session.sawToken);
    check(`mock provider 被真实 runner 调用(≥1 次, 实际 ${mock.getCalls()})`, mock.getCalls() >= 1);
  } finally {
    await stopShell(shell.proc);
    check("退出后本地端口释放", await waitPortFree(PORT));
    runtime.cleanup();
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
