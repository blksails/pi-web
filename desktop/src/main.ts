/**
 * pi-web 桌面版主进程编排入口(spec pi-web-desktop task 3.1)。
 *
 * 串联启动链:判定运行模式 → 定位产物入口(dev 分支直接加载开发地址,不拉起)→ 受监管
 * 拉起 standalone server → 就绪后窗口加载本地回环 UI;失败走可见错误呈现(重试/退出);
 * app 退出(before-quit)触发进程树收尾。不注入 agent 配置目录覆盖 → 会话默认落 ~/.pi/agent
 * 与 CLI 共享(Req 7)。组合 task 2.1–2.5 模块,并注入 bin/pi-web.mjs 的 CLI 纯原语。
 */
import { app, BrowserWindow } from "electron";
// CLI 纯原语(esbuild 构建期内联;类型见 bin-pi-web.d.ts)。
import {
  findFreePort,
  waitForReady,
  standaloneServerJs,
  buildEnv,
} from "../../bin/pi-web.mjs";
import { resolveRuntimeMode } from "./runtime-mode.js";
import { resolveServerEntry } from "./resolve-artifact.js";
import { createMainWindow } from "./window.js";
import { ServerSupervisor } from "./server-supervisor.js";
import { showStartupError } from "./startup-error.js";
import { registerDirectoryPickerBridge } from "./dialog-bridge.js";

const HOST = "127.0.0.1";
const START_PORT = Number(process.env.PI_WEB_DESKTOP_PORT ?? 3000);

const supervisor = new ServerSupervisor({ findFreePort, waitForReady });
let mainWindow: BrowserWindow | undefined;
let quitting = false;

function ensureWindow(): BrowserWindow {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = createMainWindow();
  return mainWindow;
}

/**
 * 一次启动尝试:建/复用窗口 → 按模式加载 dev 地址或拉起 standalone → 就绪加载本地 UI;
 * 失败呈现可读错误并提供重试(重跑 launch)/退出。
 */
async function launch(): Promise<void> {
  const win = ensureWindow();
  const mode = resolveRuntimeMode(process.env, app.isPackaged);

  // dev:加载已运行的开发服务器,不拉起 standalone(保留前端热更新;Req 8.1/8.2)。
  if (mode.kind === "dev") {
    await win.loadURL(mode.devUrl);
    return;
  }

  // 产物入口:打包态用资源目录;unpackaged 用 CLI 布局(e2e 可经 PI_WEB_DESKTOP_SERVER_JS 覆盖,
  // 避开 esbuild 内联后 import.meta.url 路径漂移)。
  const cliStandaloneJs = process.env.PI_WEB_DESKTOP_SERVER_JS ?? standaloneServerJs();
  const serverJs = resolveServerEntry(mode, {
    resourcesPath: process.resourcesPath,
    cliStandaloneJs,
  });
  if (serverJs === null) return;

  // server 基础环境:经 CLI buildEnv 组装 source/cwd 等;**不提供 agentDir** → 服务器读默认
  // ~/.pi/agent,与 CLI 共享会话/配置/附件(Req 7.1/7.2/7.3)。PORT/HOSTNAME 由 supervisor 覆盖。
  const defaultCwd = process.env.PI_WEB_DEFAULT_CWD ?? process.cwd();
  const baseEnv = buildEnv(
    {
      source: process.env.PI_WEB_DEFAULT_SOURCE,
      cwd: process.env.PI_WEB_DEFAULT_CWD,
    },
    defaultCwd,
    process.env,
  );

  const outcome = await supervisor.start({ serverJs, host: HOST, startPort: START_PORT, baseEnv });
  if (outcome.ok) {
    if (!win.isDestroyed()) await win.loadURL(outcome.value.url);
    return;
  }
  await showStartupError(outcome.error, {
    onRetry: () => {
      void launch();
    },
    onQuit: () => app.quit(),
  });
}

app.whenReady().then(() => {
  // 注册原生目录选择 IPC 桥(渲染层经 piWebDesktop.pickDirectory 触达);以主窗口为父窗体。
  registerDirectoryPickerBridge(() => mainWindow);
  void launch();
});

// macOS:dock 点击且无窗口 → 重开。
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void launch();
});

// 非 macOS:窗口全关即退出(触发 before-quit 收尾)。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 退出前先收尾 server 进程树,收尾完成再真正退出(Req 6.1)。preventDefault 一次,避免重入。
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void supervisor.stop().finally(() => app.quit());
});
