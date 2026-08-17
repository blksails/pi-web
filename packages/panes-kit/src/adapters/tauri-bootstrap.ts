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
import {
  createPaneGuestRealmBridge,
  encodePaneRelayEnvelope,
  type PaneRelayEnvelope,
} from "./relay.js";

export function installTauriPaneBootstrap(options: {
  readonly instanceId: string;
  readonly window: Window;
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  /** 对应 `listen(TAURI_PANE_RELAY_GUEST_EVENT, …)`(本 webview 作用域)。 */
  onRelayMessage(listener: (envelope: unknown) => void): () => void;
}): () => void {
  let disposed = false;
  let connected = false;
  let readyEnvelope: PaneRelayEnvelope | undefined;
  let readyInFlight = false;
  let retryDelay = 50;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const messageType = (envelope: unknown): unknown => {
    const message = typeof envelope === "object" && envelope !== null
      ? (envelope as { message?: unknown }).message
      : undefined;
    return typeof message === "object" && message !== null
      ? (message as { type?: unknown }).type
      : undefined;
  };
  const scheduleReady = (): void => {
    if (disposed || connected || readyEnvelope === undefined || retryTimer !== undefined) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      sendReady();
    }, retryDelay);
  };
  const sendReady = (): void => {
    if (disposed || connected || readyEnvelope === undefined || readyInFlight) return;
    readyInFlight = true;
    const envelope = readyEnvelope;
    void new Promise<boolean>((resolve) => {
      let settled = false;
      const deadline = setTimeout(() => {
        settled = true;
        resolve(false);
      }, 400);
      void options.invoke(TAURI_PANE_RELAY_TO_HOST_COMMAND, { envelope })
        .then(() => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve(true);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve(false);
        });
    })
      .then((delivered) => {
        retryDelay = delivered ? 100 : Math.min(1_000, retryDelay * 2);
      })
      .finally(() => {
        readyInFlight = false;
        scheduleReady();
      });
  };
  const bridge = createPaneGuestRealmBridge({
    instanceId: options.instanceId,
    window: options.window,
    sendToHost: (envelope) => {
      if (messageType(envelope) === "pane:ready") {
        readyEnvelope = envelope;
        sendReady();
        return;
      }
      void options.invoke(TAURI_PANE_RELAY_TO_HOST_COMMAND, {
        envelope: encodePaneRelayEnvelope(envelope),
      }).catch(() => undefined);
    },
  });
  const off = options.onRelayMessage((envelope) => {
    const candidate = envelope as PaneRelayEnvelope;
    if (messageType(candidate) === "pane:connected") {
      connected = true;
      readyEnvelope = undefined;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    bridge.deliverFromHost(envelope);
  });
  return () => {
    disposed = true;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    off();
    bridge.dispose();
  };
}
