/**
 * 桌面壳 preload 桥(spec pi-web-desktop task 2.2 + desktop-directory-picker task 2.2)。
 *
 * 在隔离上下文(contextIsolation + sandbox)下经 contextBridge 暴露**最小**、受控的 API。
 * M1 暴露只读版本标记确立安全基线;M2 追加原生目录选择桥 `pickDirectory` —— 经
 * `ipcRenderer.invoke` 触达主进程的 `piweb:pick-directory` handler(Req 3.1/3.3/3.4)。
 * sandbox 下 `ipcRenderer` 仍可用;仅暴露这一个受控方法,不授予任何通用文件系统访问或
 * Node 集成能力。窗口的隔离标志(contextIsolation/sandbox/nodeIntegration)不受本文件影响。
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("piWebDesktop", {
  /** 标识渲染进程运行于 pi-web 桌面壳(供前端可选做壳内适配)。 */
  readonly: true,
  platform: process.platform,
  /**
   * 打开系统原生「选择文件夹」对话框。返回被选目录的绝对路径;用户取消或选择失败返回
   * undefined。仅回传路径字符串,不暴露目录内容。
   */
  pickDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke("piweb:pick-directory"),
});
