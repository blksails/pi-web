/**
 * pi-web 桌面版主进程入口骨架(spec pi-web-desktop task 1.3)。
 *
 * 本文件在 task 1.3 仅为可编译/可打包的空骨架。完整启动编排
 * (运行模式判定 → 定位/拉起 standalone server → 就绪后加载本地 UI → 退出收尾)
 * 在 task 3.1 填充,并组合 task 2.1–2.5 的模块。
 */
import { app } from "electron";

app.whenReady().then(() => {
  // 启动编排接线见 task 3.1。
});

// 所有窗口关闭后退出(macOS 惯例保留在 dock,由 task 3.1 细化)。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
