/**
 * 桌面壳目录选择 IPC 桥(spec desktop-directory-picker task 2.1/3.1,Req 2.1/2.2/2.5/3.3/4.3/5.1)。
 *
 * 隔离态(contextIsolation + sandbox)下,渲染层无 Node 能力、亦无法弹原生对话框;唯一能弹
 * 系统「选择文件夹」对话框处即主进程。此模块注册一个受控的 `piweb:pick-directory` handler:
 * 以主窗口为父窗体弹目录对话框,仅回传被选目录的**绝对路径字符串**(取消/无选择/异常一律
 * 返回 undefined),绝不回传目录内容或任何 fs 元数据。异常经 try/catch 降级为「取消」语义并打
 * stderr,不使 IPC reject —— 前端据此保持来源框原值、不建会话(Req 5.1)。
 */
import { dialog, ipcMain } from "electron";
import type { BrowserWindow } from "electron";

/** 渲染层调用的 IPC 通道名;须与 preload 的 `ipcRenderer.invoke` 一致。 */
export const PICK_DIRECTORY_CHANNEL = "piweb:pick-directory";

/** `dialog.showOpenDialog` 的最小结构契约(便于纯函数测试,不依赖 Electron 运行时)。 */
export interface OpenDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}
export type ShowOpenDialog = (
  win: BrowserWindow | undefined,
) => Promise<OpenDialogResult>;

/**
 * 目录选择核心(纯逻辑,便于单测):弹目录对话框并归一化结果。
 * 选中→绝对路径;取消/无选择→undefined;异常→降级为 undefined + stderr 记录(不抛)。
 */
export async function runDirectoryPicker(
  showOpenDialog: ShowOpenDialog,
  win: BrowserWindow | undefined,
): Promise<string | undefined> {
  try {
    const result = await showOpenDialog(win);
    if (result.canceled || result.filePaths.length === 0) return undefined;
    return result.filePaths[0];
  } catch (err) {
    // 失败即取消语义:降级为 undefined,记录到 stderr 供观测(主进程日志,非浏览器面板)。
    console.error("[desktop] pick-directory failed:", err);
    return undefined;
  }
}

/**
 * 注册目录选择 IPC handler。应在 `app.whenReady()` 后调用一次;`getWindow` 用于取当前主窗口
 * 作为对话框父窗体(无窗口时以无父窗体弹出)。
 */
export function registerDirectoryPickerBridge(
  getWindow: () => BrowserWindow | undefined,
): void {
  const showOpenDialog: ShowOpenDialog = (win) =>
    win
      ? dialog.showOpenDialog(win, {
          properties: ["openDirectory", "createDirectory"],
        })
      : dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
  ipcMain.handle(PICK_DIRECTORY_CHANNEL, () =>
    runDirectoryPicker(showOpenDialog, getWindow()),
  );
}
