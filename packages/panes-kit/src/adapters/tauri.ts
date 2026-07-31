/**
 * Tauri WebView adapter(宿主主窗口侧,spec isolated-panes 任务 5.2)。
 *
 * Rust 端(desktop/src-tauri/src/pane_relay.rs)只做「instanceId+epoch 绑定 + webview
 * 标签鉴权」的信封路由,不解析消息(Req 9.3/9.4)。本模块经注入的 `TauriPaneEnv`
 * (invoke/listen/createPaneWebview)工作,不硬依赖 @tauri-apps/api——集成方传入真实
 * 原语,测试可注入伪造。
 *
 * 独立 WebView 的创建(label、URL、初始化脚本装配 `./tauri-bootstrap`)由集成方在
 * `createPaneWebview` 内完成;pane webview 的能力面由 capabilities 按 `pane-*` 标签
 * 收窄(仅事件监听 + `pane_relay_to_host`),不授予导航、shell、opener 等任何权限。
 */
import type { PaneViewAdapter, PaneViewHandle } from "../host-ports.js";
import { createRelayPanePort, isPaneRelayEnvelope } from "./relay.js";

export const TAURI_PANE_RELAY_BIND_COMMAND = "pane_relay_bind";
export const TAURI_PANE_RELAY_UNBIND_COMMAND = "pane_relay_unbind";
export const TAURI_PANE_RELAY_TO_GUEST_COMMAND = "pane_relay_to_guest";
export const TAURI_PANE_RELAY_TO_HOST_COMMAND = "pane_relay_to_host";
/** Rust → 宿主主窗口的上行事件名。 */
export const TAURI_PANE_RELAY_HOST_EVENT = "pane-relay-host";
/** Rust → pane webview 的下行事件名。 */
export const TAURI_PANE_RELAY_GUEST_EVENT = "pane-relay-guest";

/** pane webview 标签约定:capabilities 以 `pane-*` 模式匹配收窄权限。 */
export function paneWebviewLabel(instanceId: string): string {
  return `pane-${instanceId}`;
}

export interface TauriPaneWebview {
  show(): void | Promise<void>;
  hide(): void | Promise<void>;
  reload(): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface TauriPaneEnv {
  /** 对应 @tauri-apps/api `invoke`(宿主主窗口发起)。 */
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  /** 对应 `listen(TAURI_PANE_RELAY_HOST_EVENT, ({ payload }) => listener(payload))`。 */
  onRelayMessage(listener: (envelope: unknown) => void): () => void;
  createPaneWebview(options: {
    readonly label: string;
    readonly url: string;
    readonly instanceId: string;
    readonly container?: HTMLElement;
    readonly visible?: boolean;
  }): Promise<TauriPaneWebview> | TauriPaneWebview;
}

export interface TauriPaneMountTarget {
  readonly instanceId: string;
  readonly paneId: string;
  readonly epoch: number;
  readonly url: string;
  readonly container?: HTMLElement;
  readonly visible?: boolean;
}

export function createTauriPaneViewAdapter(
  env: TauriPaneEnv,
  options: { readonly allowedProtocols?: readonly string[] } = {},
): PaneViewAdapter<TauriPaneMountTarget> {
  const allowedProtocols = options.allowedProtocols ?? ["https:"];
  return {
    async mount(target): Promise<PaneViewHandle> {
      if (!allowedProtocols.includes(new URL(target.url).protocol)) {
        throw new Error(`Pane document protocol is not declared: ${target.url}`);
      }
      // WebView 在最终槽内隐藏加载，可能早于 mount() 返回便发出 pane:ready。
      // 先占中继监听并缓冲本实例消息，免握手事件落入订阅空窗。
      const earlyMessages: unknown[] = [];
      const relayListeners = new Set<(envelope: unknown) => void>();
      const stopRelay = env.onRelayMessage((envelope) => {
        if (!isPaneRelayEnvelope(envelope) || envelope.instanceId !== target.instanceId) return;
        if (relayListeners.size === 0) {
          earlyMessages.push(envelope);
          return;
        }
        for (const listener of relayListeners) listener(envelope);
      });
      // WebView label 含 epoch：普通路由 remount 复用同一 label/child WebView；
      // 会话切换或显式 reload 提升 epoch，先关闭旧 child 再创建新载体，避免竞态。
      const label = paneWebviewLabel(`${target.instanceId}-${target.epoch}`);
      let view: TauriPaneWebview;
      try {
        await env.invoke(TAURI_PANE_RELAY_BIND_COMMAND, {
          instanceId: target.instanceId,
          epoch: target.epoch,
          label,
        });
        view = await env.createPaneWebview({
          label,
          url: target.url,
          instanceId: target.instanceId,
          container: target.container,
          visible: target.visible,
        });
      } catch (error) {
        stopRelay();
        throw error;
      }
      const port = createRelayPanePort({
        instanceId: target.instanceId,
        epoch: target.epoch,
        // 发送失败(旧 epoch 被 Rust 拒绝、webview 已关)按失联处理,不抛给宿主循环。
        send: (envelope) => void Promise.resolve(env.invoke(TAURI_PANE_RELAY_TO_GUEST_COMMAND, { envelope })).catch(() => undefined),
        subscribe(listener) {
          relayListeners.add(listener);
          const queued = earlyMessages.splice(0);
          for (const envelope of queued) listener(envelope);
          return () => relayListeners.delete(listener);
        },
      });
      let disposed = false;
      let controls = Promise.resolve();
      const enqueue = (
        action: () => void | Promise<void>,
        allowDisposed = false,
      ): void => {
        controls = controls
          .then(async () => {
            if (disposed && !allowDisposed) return;
            await action();
          })
          .catch(() => undefined);
      };
      return {
        port,
        show: () => enqueue(() => view.show()),
        hide: () => enqueue(() => view.hide()),
        reload: () => enqueue(() => view.reload()),
        suspend: () => {
          if (disposed) return;
          port.close();
          stopRelay();
          void Promise.resolve(env.invoke(TAURI_PANE_RELAY_UNBIND_COMMAND, {
            instanceId: target.instanceId,
            epoch: target.epoch,
          })).catch(() => undefined);
          enqueue(() => view.hide());
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          port.close();
          stopRelay();
          // epoch 匹配才解绑:同 instanceId 已被更高 epoch 重绑时,旧 handle 不误伤新绑定。
          void Promise.resolve(env.invoke(TAURI_PANE_RELAY_UNBIND_COMMAND, {
            instanceId: target.instanceId,
            epoch: target.epoch,
          })).catch(() => undefined);
          enqueue(async () => {
            await view.hide();
            await view.close();
          }, true);
        },
      };
    },
  };
}
