/**
 * Tauri pane webview 初始化脚本(Guest Realm 侧,spec isolated-panes 任务 5.2)。
 *
 * 与 Electron preload 对偶:经注入的 invoke/listen 原语把原生 IPC 接到
 * `createPaneGuestRealmBridge`,页面照常调 `connectPaneGuest`,Guest API 零分叉。
 *
 * 真实 init script 装配示例(集成方在创建 pane webview 时内联):
 * ```ts
 * import { invoke } from "@tauri-apps/api/core";
 * import { listen } from "@tauri-apps/api/event";
 * installTauriPaneBootstrap({
 *   instanceId,
 *   window,
 *   invoke,
 *   onRelayMessage: (listener) => {
 *     const off = listen(TAURI_PANE_RELAY_GUEST_EVENT, ({ payload }) => listener(payload));
 *     return () => void off.then((dispose) => dispose());
 *   },
 * });
 * ```
 */
import { TAURI_PANE_RELAY_TO_HOST_COMMAND } from "./tauri.js";
import { createPaneGuestRealmBridge } from "./relay.js";

export function installTauriPaneBootstrap(options: {
  readonly instanceId: string;
  readonly window: Window;
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  /** 对应 `listen(TAURI_PANE_RELAY_GUEST_EVENT, …)`(本 webview 作用域)。 */
  onRelayMessage(listener: (envelope: unknown) => void): () => void;
}): () => void {
  const bridge = createPaneGuestRealmBridge({
    instanceId: options.instanceId,
    window: options.window,
    sendToHost: (envelope) => void options.invoke(TAURI_PANE_RELAY_TO_HOST_COMMAND, { envelope }).catch(() => undefined),
  });
  const off = options.onRelayMessage((envelope) => bridge.deliverFromHost(envelope));
  return () => {
    off();
    bridge.dispose();
  };
}
