import type { PaneHostMessage } from "./contract.js";

/** Browser MessagePort、Electron preload relay 与 Tauri event relay 的共同最小面。 */
export interface PanePort {
  post(message: PaneHostMessage, transfer?: readonly Transferable[]): void;
  listen(listener: (message: unknown) => void): () => void;
  close(): void;
}

export interface PaneViewHandle {
  readonly port: PanePort;
  show(): void;
  hide(): void;
  reload(): void;
  /** 路由暂离时隐藏并断开宿主监听，保留原生 Webview 供恢复；非原生载体可不实现。 */
  suspend?(): void;
  dispose(): void;
}

/** Desktop adapters 实现此接口；核心不依赖 Electron/Tauri SDK。 */
export interface PaneViewAdapter<TMount> {
  mount(target: TMount): Promise<PaneViewHandle> | PaneViewHandle;
}

export function fromMessagePort(port: MessagePort): PanePort {
  return {
    post(message, transfer = []) {
      port.postMessage(message, [...transfer]);
    },
    listen(listener) {
      const onMessage = (event: MessageEvent<unknown>): void => listener(event.data);
      port.addEventListener("message", onMessage);
      port.start();
      return () => port.removeEventListener("message", onMessage);
    },
    close() {
      port.close();
    },
  };
}
