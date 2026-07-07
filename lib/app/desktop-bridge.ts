/**
 * 桌面壳能力桥的前端访问器(spec desktop-directory-picker task 1.2,Req 1.2/1.3/4.2)。
 *
 * 桌面壳(Electron)经 preload 的 contextBridge 在渲染层注入 `window.piWebDesktop`;普通浏览器
 * 部署下该全局不存在。本模块集中该桥的类型契约与读取,避免各处直接 `(window as any)` 访问,
 * 并使「是否桌面态」的门控收敛为单一入口:浏览器/SSR 态返回 undefined ⇒ 相关入口不渲染。
 *
 * 契约须与 `desktop/src/preload.ts` 暴露的形状保持一致(单向对齐,变更任一侧需同步另一侧)。
 */

/** 桌面壳注入到渲染层的受控能力桥。 */
export interface PiWebDesktopBridge {
  /** 恒为 true —— 标识运行于 pi-web 桌面壳。 */
  readonly readonly: true;
  /** 运行平台(process.platform,如 "darwin"/"win32"/"linux")。 */
  readonly platform: string;
  /**
   * 打开系统原生「选择文件夹」对话框;返回被选目录绝对路径,取消/失败返回 undefined。
   * 可选:旧版壳或未来形态可能不提供该方法。
   */
  readonly pickDirectory?: () => Promise<string | undefined>;
}

/**
 * 读取桌面壳注入的能力桥。浏览器/SSR 态(无 `window` 或无注入)返回 undefined。
 */
export function getPiWebDesktopBridge(): PiWebDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = (window as Window & { piWebDesktop?: PiWebDesktopBridge })
    .piWebDesktop;
  return bridge;
}
