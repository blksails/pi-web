/**
 * Desktop adapter 共用中继原语(spec isolated-panes 任务 5.x)。
 *
 * 两侧对偶:
 *  - 宿主侧 `createRelayPanePort`:把「发送/订阅原生 IPC 信封」适配成按 instanceId+epoch
 *    绑定的 `PanePort`(Req 9.4);
 *  - Guest Realm 侧 `createPaneGuestRealmBridge`(Tauri init script 用;第三方桌面壳如
 *    Electron preload 亦可复用):在 Guest Realm 内重建「window 握手 + MessageChannel」,
 *    `connectPaneGuest` 零改动(Req 9.1)。
 *
 * 信封只包路由标识,`message` 原样透传——中继不解析、不改写协议消息(Req 9.3)。
 * 编译需要 DOM lib(MessageChannel/MessagePort)。
 */
import type { PanePort } from "../host-ports.js";

export interface PaneRelayEnvelope {
  readonly instanceId: string;
  /** 绑定的实例 epoch;`pane:ready` 发生在握手前,以 0 表示未绑定。 */
  readonly epoch: number;
  readonly message: unknown;
}

export function isPaneRelayEnvelope(value: unknown): value is PaneRelayEnvelope {
  const candidate = value as Partial<PaneRelayEnvelope> | null | undefined;
  return typeof candidate?.instanceId === "string"
    && typeof candidate.epoch === "number"
    && "message" in (candidate as object);
}

function messageType(message: unknown): unknown {
  return typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined;
}

export interface RelayPanePortOptions {
  readonly instanceId: string;
  readonly epoch: number;
  send(envelope: PaneRelayEnvelope): void;
  subscribe(listener: (envelope: unknown) => void): () => void;
}

export function createRelayPanePort(options: RelayPanePortOptions): PanePort {
  let closed = false;
  const subscriptions = new Set<() => void>();
  return {
    post(message) {
      if (closed) return;
      options.send({ instanceId: options.instanceId, epoch: options.epoch, message });
    },
    listen(listener) {
      const unsubscribe = options.subscribe((raw) => {
        if (closed || !isPaneRelayEnvelope(raw) || raw.instanceId !== options.instanceId) return;
        // pane:ready 无 epoch(握手前),放行;其余须精确匹配绑定 epoch。
        if (raw.epoch !== options.epoch && messageType(raw.message) !== "pane:ready") return;
        listener(raw.message);
      });
      subscriptions.add(unsubscribe);
      return () => {
        unsubscribe();
        subscriptions.delete(unsubscribe);
      };
    },
    close() {
      closed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.clear();
    },
  };
}

export interface PaneGuestRealmBridgeOptions {
  readonly instanceId: string;
  /** Guest Realm 的顶层 window(pane WebView 内 `parent === window`)。 */
  readonly window: Window;
  sendToHost(envelope: PaneRelayEnvelope): void;
}

export interface PaneGuestRealmBridge {
  deliverFromHost(envelope: unknown): void;
  dispose(): void;
}

/**
 * 语义与浏览器 iframe 路径逐条对齐:
 *  - 页面 `pane:ready` → 上转宿主;
 *  - 宿主 `pane:connected`(epoch 更大)→ 新建 MessageChannel,port2 随消息交给页面,
 *    port1 与原生 IPC 互转;同 epoch 重发幂等丢弃,旧 epoch 通道关闭后自然失联(Req 9.4)。
 */
export function createPaneGuestRealmBridge(options: PaneGuestRealmBridgeOptions): PaneGuestRealmBridge {
  let currentEpoch = 0;
  let currentPort: MessagePort | undefined;
  let disposed = false;

  const onWindowMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== options.window || messageType(event.data) !== "pane:ready") return;
    options.sendToHost({ instanceId: options.instanceId, epoch: 0, message: event.data });
  };
  options.window.addEventListener("message", onWindowMessage);

  return {
    deliverFromHost(raw) {
      if (disposed || !isPaneRelayEnvelope(raw) || raw.instanceId !== options.instanceId) return;
      if (messageType(raw.message) === "pane:connected") {
        if (raw.epoch <= currentEpoch) return;
        currentPort?.close();
        const channel = new MessageChannel();
        currentEpoch = raw.epoch;
        currentPort = channel.port1;
        const epoch = raw.epoch;
        channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
          options.sendToHost({ instanceId: options.instanceId, epoch, message: data });
        };
        options.window.postMessage(raw.message, "*", [channel.port2]);
        return;
      }
      if (raw.epoch !== currentEpoch || currentPort === undefined) return;
      currentPort.postMessage(raw.message);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.window.removeEventListener("message", onWindowMessage);
      currentPort?.close();
      currentPort = undefined;
    },
  };
}
