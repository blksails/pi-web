/**
 * 桌面壳能力桥的前端访问器(spec electron-to-tauri 任务 5.2,Req 6.1/6.7)。
 *
 * 桌面壳把窗口导航到本地回环 UI;普通浏览器部署下不存在任何桥。本模块集中该桥的类型契约
 * 与读取,避免各处直接 `(window as any)` 访问,并使「是否桌面态」的门控收敛为单一入口:
 * 浏览器/SSR 态返回 undefined ⇒ 相关入口不渲染。
 *
 * 探测顺序(三态):
 *   1. `window.piWebDesktop` —— Electron 时代 preload 经 contextBridge 注入的桥。保留以向后兼容。
 *   2. `window.__TAURI__` —— Tauri 壳(`withGlobalTauri: true`)在**远端回环页面**注入的全局。
 *      据此合成一个同形状的桥,`pickDirectory` 走 `invoke('pick_directory')`。
 *   3. 都没有 → undefined(浏览器/SSR 态)。
 *
 * ★ **不得 import 任何 `@tauri-apps/*` npm 包**:窗口加载的是 server 提供的远端页面,
 *   它无法加载随包模块;只能使用 `withGlobalTauri` 暴露的全局对象。
 *
 * 契约须与 `desktop/src-tauri/src/dialog.rs` 暴露的命令保持一致(变更任一侧需同步另一侧)。
 */

/** 桌面壳注入到渲染层的受控能力桥。 */
export interface PiWebDesktopBridge {
  /** 恒为 true —— 标识运行于 pi-web 桌面壳。 */
  readonly readonly: true;
  /** 运行平台(如 "darwin"/"win32"/"linux")。 */
  readonly platform: string;
  /**
   * 打开系统原生「选择文件夹」对话框;返回被选目录绝对路径,取消/失败返回 undefined。
   * 可选:旧版壳或未来形态可能不提供该方法。
   */
  readonly pickDirectory?: () => Promise<string | undefined>;
  /**
   * 桌面凭据持久化到 OS keychain(desktop-cloud-login,Req 2.1/2.3)。成功 resolve,失败
   * (ACL 拒绝/IPC 故障)resolve `false`,绝不 reject。可选:非桌面壳/旧壳不提供。
   */
  readonly storeCredential?: (credential: string) => Promise<boolean>;
  /** 清除 keychain 中的桌面凭据(登出,Req 2.5)。失败静默 resolve `false`,绝不 reject。 */
  readonly clearCredential?: () => Promise<boolean>;
}

/** Tauri `withGlobalTauri` 注入的全局对象中,本模块用到的最小形状。 */
interface TauriGlobal {
  readonly core?: {
    readonly invoke?: (
      cmd: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}

type BridgeWindow = Window & {
  piWebDesktop?: PiWebDesktopBridge;
  __TAURI__?: TauriGlobal;
};

/** 由 `navigator` 归一化出的平台标识;取不到时给一个稳定的占位值。 */
function detectPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Windows/.test(ua)) return "win32";
  if (/Linux|X11/.test(ua)) return "linux";
  return "unknown";
}

/**
 * 基于 Tauri 全局合成一个与 Electron 壳同形状的桥。
 *
 * `pickDirectory` 的 rejection 必须被吞掉并 resolve 为 undefined —— Rust 侧命令承诺
 * 「取消/异常一律无结果、绝不 reject」,前端在传输层出错时也应保持同一语义(Req 6.5)。
 */
function bridgeFromTauri(tauri: TauriGlobal): PiWebDesktopBridge {
  const invoke = tauri.core?.invoke;
  if (typeof invoke !== "function") {
    // 全局存在但 invoke 不可用:仍算桌面态(不渲染浏览器专属 UI),但无目录选择能力。
    return { readonly: true, platform: detectPlatform() };
  }
  return {
    readonly: true,
    platform: detectPlatform(),
    pickDirectory: async (): Promise<string | undefined> => {
      try {
        const picked = await invoke("pick_directory");
        return typeof picked === "string" && picked.length > 0 ? picked : undefined;
      } catch (err) {
        // 未授权(ACL 拒绝)或 IPC 故障:降级为「无结果」,不向上抛。
        console.error("[desktop-bridge] pick_directory 调用失败:", err);
        return undefined;
      }
    },
    storeCredential: async (credential: string): Promise<boolean> => {
      try {
        await invoke("store_credential", { credential });
        return true;
      } catch (err) {
        console.error("[desktop-bridge] store_credential 调用失败:", err);
        return false;
      }
    },
    clearCredential: async (): Promise<boolean> => {
      try {
        await invoke("clear_credential");
        return true;
      } catch (err) {
        console.error("[desktop-bridge] clear_credential 调用失败:", err);
        return false;
      }
    },
  };
}

/**
 * 读取桌面壳能力桥。浏览器/SSR 态(无 `window` 或无任何注入)返回 undefined。
 */
export function getPiWebDesktopBridge(): PiWebDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as BridgeWindow;

  // 1) Electron 壳(向后兼容)。
  if (w.piWebDesktop !== undefined) return w.piWebDesktop;

  // 2) Tauri 壳:远端回环页面下 `withGlobalTauri` 注入 `window.__TAURI__`。
  if (w.__TAURI__ !== undefined) return bridgeFromTauri(w.__TAURI__);

  // 3) 普通浏览器。
  return undefined;
}
