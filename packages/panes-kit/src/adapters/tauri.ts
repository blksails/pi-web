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
import { createRelayPanePort } from "./relay.js";

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
  show(): void;
  hide(): void;
  reload(): void;
  close(): void;
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
  }): Promise<TauriPaneWebview> | TauriPaneWebview;
}

export interface TauriPaneMountTarget {
  readonly instanceId: string;
  readonly paneId: string;
  readonly epoch: number;
  readonly url: string;
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
      const label = paneWebviewLabel(target.instanceId);
      await env.invoke(TAURI_PANE_RELAY_BIND_COMMAND, {
        instanceId: target.instanceId,
        epoch: target.epoch,
        label,
      });
      const view = await env.createPaneWebview({ label, url: target.url, instanceId: target.instanceId });
      const port = createRelayPanePort({
        instanceId: target.instanceId,
        epoch: target.epoch,
        // 发送失败(旧 epoch 被 Rust 拒绝、webview 已关)按失联处理,不抛给宿主循环。
        send: (envelope) => void Promise.resolve(env.invoke(TAURI_PANE_RELAY_TO_GUEST_COMMAND, { envelope })).catch(() => undefined),
        subscribe: (listener) => env.onRelayMessage(listener),
      });
      return {
        port,
        show: () => view.show(),
        hide: () => view.hide(),
        reload: () => view.reload(),
        dispose: () => {
          port.close();
          // epoch 匹配才解绑:同 instanceId 已被更高 epoch 重绑时,旧 handle 不误伤新绑定。
          void Promise.resolve(env.invoke(TAURI_PANE_RELAY_UNBIND_COMMAND, {
            instanceId: target.instanceId,
            epoch: target.epoch,
          })).catch(() => undefined);
          view.close();
        },
      };
    },
  };
}
