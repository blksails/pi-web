/**
 * 桌面壳主窗口(spec pi-web-desktop task 2.2,Req 1.3/5.3/5.4)。
 *
 * 以隔离渲染上下文创建窗口(保持 Electron 安全默认:contextIsolation/nodeIntegration:false/
 * sandbox:true,显式声明防回归),经最小 preload 桥;启动即加载本地加载页避免空白窗口;
 * 外链经 decideExternalOpen 校验后交系统默认浏览器,一律拒绝应用内新窗口。
 */
import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { decideExternalOpen } from "./external-link.js";

/** dist 下的静态资源(build.mjs 把 static/ 拷到 dist/static/)。 */
function loadingPagePath(): string {
  return join(__dirname, "static", "loading.html");
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    backgroundColor: "#0b0b0c",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  // 外链治理:仅非回环 http(s) 交系统浏览器,其余拒绝;一律不在应用内开新窗口(Req 5.4)。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (decideExternalOpen(url) === "open-external") {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // 启动即显示本地加载页,避免空白窗口(Req 1.3);就绪后由 main 切到本地 UI。
  void win.loadFile(loadingPagePath());
  return win;
}
