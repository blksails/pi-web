/**
 * 桌面壳 preload 桥(spec pi-web-desktop task 2.2,Req 5.3)。
 *
 * 在隔离上下文(contextIsolation + sandbox)下经 contextBridge 暴露**最小**、受控的 API。
 * M1 仅暴露一个只读版本标记以确立安全基线(不授予任何 Node/系统集成能力);后续桌面
 * 能力(如原生对话框桥)在 M2 按需扩展。
 */
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("piWebDesktop", {
  /** 标识渲染进程运行于 pi-web 桌面壳(供前端可选做壳内适配)。 */
  readonly: true,
  platform: process.platform,
});
