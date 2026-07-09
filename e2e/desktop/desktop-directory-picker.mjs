#!/usr/bin/env node
/**
 * 桌面版原生目录选择桥闭环 e2e(spec desktop-directory-picker task 4.1,Req 2.1/2.2/3.1/3.3/3.4)。
 * 可重复,产出新鲜证据。
 *
 * 用 Playwright 的 `_electron` 驱动**真实(未打包)Electron 壳**,证明只有真实壳能证的机制:
 *   渲染层 window.piWebDesktop.pickDirectory() → preload contextBridge → ipcRenderer.invoke →
 *   主进程 ipcMain handler → dialog.showOpenDialog → 路径回传到渲染层。
 * (「浏览」按钮→回填输入框的 UI 接线由 jsdom 单测 test/agent-source-picker.test.tsx 覆盖;桌面壳
 * 首屏恒 autostart 进会话,故此处直测桥机制而非 picker 可见性。)
 *
 * 原生对话框无法被 Playwright 点选,故用 `app.evaluate` 在主进程猴补 `dialog.showOpenDialog`
 * 返回固定临时目录(标准做法,零生产测试钩子)。
 *
 * 前置:`pnpm build:dist` + `pnpm --filter @blksails/pi-web-desktop build`(desktop dist)。
 * 跑法:`node e2e/desktop/desktop-directory-picker.mjs`。
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.PI_WEB_DIST_DIR ?? "dist";
const DIST_SERVER = join(ROOT, DIST, "server.mjs");
const DESKTOP_MAIN = join(ROOT, "desktop", "dist", "main.js");
const DESKTOP_PORT = 34811;
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/desktop-directory-picker/evidence");

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(DIST_SERVER)) {
    console.error(`产物缺失:${DIST_SERVER}\n请先 \`pnpm build:dist\``);
    process.exit(1);
  }
  if (!existsSync(DESKTOP_MAIN)) {
    console.error(`桌面 bundle 缺失:${DESKTOP_MAIN}\n请先 \`pnpm --filter @blksails/pi-web-desktop build\``);
    process.exit(1);
  }

  const require = createRequire(join(ROOT, "desktop", "package.json"));
  const electronPath = require("electron"); // electron npm 默认导出=二进制路径

  const agentDir = mkdtempSync(join(tmpdir(), "pi-desktop-dirpick-agent-"));
  // 猴补对话框将「选中」的临时目录(须真实存在,模拟用户选的文件夹)。
  const stubDir = mkdtempSync(join(tmpdir(), "pi-desktop-dirpick-chosen-"));

  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [DESKTOP_MAIN],
      cwd: ROOT,
      env: {
        ...process.env,
        PI_WEB_DESKTOP_SERVER_JS: DIST_SERVER,
        PI_WEB_DESKTOP_PORT: String(DESKTOP_PORT),
        PI_WEB_AGENT_DIR: agentDir,
        // 关键:不设 PI_WEB_DEFAULT_SOURCE → 停在选源页(展示 AgentSourcePicker)。
        PI_WEB_DEFAULT_CWD: ROOT,
        ELECTRON_RUN_AS_NODE: undefined,
        PI_WEB_DIST_DIR: DIST,
      },
    });

    // 主进程猴补 dialog.showOpenDialog 返回固定临时目录(替换属性,dialog-bridge 调用时查找生效)。
    await app.evaluate(async ({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
    }, stubDir);

    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    check("Electron 窗口加载本地回环 UI", /^http:\/\/127\.0\.0\.1:/.test(page.url()));

    // 渲染层:preload contextBridge 暴露 piWebDesktop.pickDirectory(受控最小 API,Req 3.1/3.4)。
    const shape = await page.evaluate(() => ({
      hasBridge: typeof window.piWebDesktop === "object" && window.piWebDesktop !== null,
      hasPick: typeof window.piWebDesktop?.pickDirectory === "function",
      readonly: window.piWebDesktop?.readonly,
    }));
    check("preload 暴露 piWebDesktop 桥(保留 readonly)", shape.hasBridge && shape.readonly === true);
    check("桥暴露 pickDirectory 方法(Req 3.1/3.4)", shape.hasPick);

    // 渲染层调用 pickDirectory → 经 IPC 触达主进程猴补的 dialog → 回传桩目录(Req 2.1/2.2/3.3)。
    const returned = await page.evaluate(() => window.piWebDesktop.pickDirectory());
    check("pickDirectory 经桥回传被选目录绝对路径(Req 2.2/3.3)", returned === stubDir);

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, "desktop-directory-picker.png"), fullPage: true });
    console.log(`证据截图: ${join(EVIDENCE_DIR, "desktop-directory-picker.png")}`);
  } catch (err) {
    check(`桌面目录选择 e2e: ${err?.message ?? err}`, false);
  } finally {
    if (app) await app.close().catch(() => {});
    await sleep(300);
    try {
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(stubDir, { recursive: true, force: true });
    } catch {
      // best-effort。
    }
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
