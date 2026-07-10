#!/usr/bin/env node
/**
 * 桌面壳「未打包真实会话」黑盒 e2e（spec electron-to-tauri 任务 4.5，Req 10.1/10.6）。
 *
 * 启动未打包壳二进制 → 断言其拉起的本地回环端点可用 → 经该端点完成一次经 mock provider 的
 * 真实会话（含 pi runner 子进程被调用）→ 优雅退出后断言无孤儿、端口释放。
 *
 * 前置：`pnpm build:dist` + `cargo build --manifest-path desktop/src-tauri/Cargo.toml`
 *       + `node scripts/fetch-node-sidecar.mjs`（由 shared.ensurePrerequisites 校验）
 * 跑法：`node e2e/desktop/desktop-real.mjs`（或 `pnpm e2e:desktop:real`）
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  check,
  cleanupAgentDir,
  countShellNodeProcesses,
  ensurePrerequisites,
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

const PORT = 34810;
const REPLY_TOKEN = "PIWEBTAURIREALOK";
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/electron-to-tauri/evidence");

async function main() {
  ensurePrerequisites();
  const mock = await startMockProvider(REPLY_TOKEN);
  const agentDir = makeAgentDir(mock.port);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const shell = launchShell({
    port: PORT,
    env: {
      // 外部显式设置 agentDir：壳自己不生成它，但必须继承（与 Electron 行为等价）。
      PI_WEB_AGENT_DIR: agentDir,
      PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
      PI_WEB_DEFAULT_CWD: ROOT,
    },
  });

  try {
    const ready = await waitReady(PORT, 60_000);
    check("未打包壳拉起本地回环后端并就绪", ready);
    if (!ready) return;

    const session = await runSessionViaBrowser(PORT, REPLY_TOKEN, {
      screenshotPath: join(EVIDENCE_DIR, "desktop-real.png"),
    });
    check("默认 source 自动激活真实会话(URL 含 /session/)", session.onSessionUrl);
    check("经壳拉起的后端收到真实 runner 的流式回包", session.sawToken);
    check(`mock provider 被真实 runner 调用(≥1 次, 实际 ${mock.getCalls()})`, mock.getCalls() >= 1);
  } finally {
    await stopShell(shell.proc);
    // 退出收尾：端口释放 + 无孤儿（二者都需要收敛窗口，进程表清理晚于端口释放）。
    check("退出后本地端口释放(server 进程树已收尾)", await waitPortFree(PORT));
    const clean = await waitNoShellNodeProcesses();
    check(`退出后无孤儿随包 node 进程(残留 ${countShellNodeProcesses()})`, clean);

    mock.server.close();
    cleanupAgentDir(agentDir);
  }
  reportAndExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
