#!/usr/bin/env node
/**
 * 桌面壳「干净无 Node 机器」验证 + 退出收尾 e2e
 * （spec electron-to-tauri 任务 4.6，Req 5.4/10.1/10.2/4.5）。
 *
 * ★ 本项**不可降级为「假定可用」**：它是「随包 JS 运行时」这一整条设计的唯一端到端证据。
 *
 * 沿用 Electron 时代「藏起系统 node」的思路：从传给壳的 PATH 中**剥除所有含 node 可执行
 * 文件的目录**，再启动壳跑真实会话。若仍成功，则证明 server 与 pi runner 孙进程用的是
 * **随包 node**（经 `PI_WEB_NODE_BIN` 下达），而非系统 PATH 上的 node。
 *
 * 并验证退出收尾：关闭应用后端口释放、无孤儿进程。
 *
 * 跑法：`node e2e/desktop/desktop-no-node.mjs`（或 `pnpm e2e:desktop:nonode`）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
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

const PORT = 34820;
const REPLY_TOKEN = "PIWEBTAURINONODEOK";
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/electron-to-tauri/evidence");

/** 从 PATH 剥除所有含 node/node.exe 的目录。 */
function pathWithoutNode(origPath) {
  return (origPath ?? "")
    .split(delimiter)
    .filter((d) => {
      if (!d) return false;
      try {
        return !existsSync(join(d, "node")) && !existsSync(join(d, "node.exe"));
      } catch {
        return true;
      }
    })
    .join(delimiter);
}

/** 在给定 PATH 下 `node` 是否仍可解析。 */
function nodeResolvable(path) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["node"], {
      env: { ...process.env, PATH: path },
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  ensurePrerequisites();

  const strippedPath = pathWithoutNode(process.env.PATH);
  // ★ 先证明剥离确实生效，否则后面的「成功」毫无意义。
  check("已从 PATH 剥除系统 node(which node 失效)", !nodeResolvable(strippedPath));

  const mock = await startMockProvider(REPLY_TOKEN);
  const agentDir = makeAgentDir(mock.port);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const shell = launchShell({
    port: PORT,
    env: {
      PATH: strippedPath,
      PI_WEB_AGENT_DIR: agentDir,
      PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
      PI_WEB_DEFAULT_CWD: ROOT,
    },
  });

  try {
    const ready = await waitReady(PORT, 60_000);
    check("无系统 node 下壳仍拉起本地回环后端", ready);
    if (!ready) return;

    const session = await runSessionViaBrowser(PORT, REPLY_TOKEN, {
      screenshotPath: join(EVIDENCE_DIR, "desktop-no-node.png"),
    });
    check("无系统 node 下真实会话跑通(runner 用随包 node — Req 5.4)", session.sawToken);
    check(`mock provider 被真实 runner 调用(≥1 次, 实际 ${mock.getCalls()})`, mock.getCalls() >= 1);
  } finally {
    await stopShell(shell.proc);
    check("关闭应用后本地端口释放(server 进程树已收尾 — Req 4.5)", await waitPortFree(PORT));
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
