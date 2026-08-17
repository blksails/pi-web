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
 * 信封只包路由标识；Tauri JSON 中继对附件字节做可逆编码。
 * 编译需要 DOM lib(MessageChannel/MessagePort)。
 */
import type { PanePort } from "../host-ports.js";

export interface PaneRelayEnvelope {
  readonly instanceId: string;
  /** 绑定的实例 epoch;`pane:ready` 发生在握手前,以 0 表示未绑定。 */
  readonly epoch: number;
  readonly message: unknown;
}

/**
 * Tauri invoke 走 JSON 序列化，ArrayBuffer 会丢失。仅对附件上传请求做
 * 可逆编码；浏览器 MessagePort 路径仍保留原生 ArrayBuffer。
 */
function isAttachmentPutMessage(value: unknown): value is {
  readonly type: "pane:request";
  readonly operation: "attachment.put";
  readonly bytes: unknown;
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly type?: unknown; readonly operation?: unknown; readonly bytes?: unknown };
  return candidate.type === "pane:request" && candidate.operation === "attachment.put" && "bytes" in candidate;
}

function bytesToRelayValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  return value;
}

function relayValueToBytes(value: unknown): ArrayBuffer | undefined {
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return Uint8Array.from(value).buffer;
  }
  // JSON.stringify(Uint8Array) 可能产生数字键对象，兼容该序列化形态。
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^\d+$/.test(key))
      .sort(([a], [b]) => Number(a) - Number(b));
    if (entries.length > 0 && entries.every(([, item]) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)) {
      return Uint8Array.from(entries.map(([, item]) => Number(item))).buffer;
    }
  }
  return undefined;
}

/** 将 pane 信封编码为可经 Tauri invoke 传输的 JSON 形态。 */
export function encodePaneRelayEnvelope(envelope: PaneRelayEnvelope): PaneRelayEnvelope {
  if (!isAttachmentPutMessage(envelope.message)) return envelope;
  return {
    ...envelope,
    message: { ...envelope.message, bytes: bytesToRelayValue(envelope.message.bytes) },
  };
}

/** 将 Tauri relay 收到的附件字节还原为协议要求的 ArrayBuffer。 */
export function decodePaneRelayEnvelope(envelope: PaneRelayEnvelope): PaneRelayEnvelope {
  if (!isAttachmentPutMessage(envelope.message)) return envelope;
  const bytes = relayValueToBytes(envelope.message.bytes);
  return bytes === undefined
    ? envelope
    : { ...envelope, message: { ...envelope.message, bytes } };
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
        listener(decodePaneRelayEnvelope(raw).message);
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
  // 宿主 bind 时常先 push signals 再发 connected；IPC 顺序下 signal 可能早到。
  // 通道未立前按信封缓冲，否则边车 chrome 永远收不到首份 tabs 快照（顶栏空白）。
  const pendingToPage: PaneRelayEnvelope[] = [];

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
        // 先把 connected 交给页面拿 port，再灌缓冲（含 pi.workspace 快照）。
        const queued = pendingToPage.splice(0);
        for (const envelope of queued) {
          if (envelope.epoch !== epoch && envelope.epoch !== 0) continue;
          currentPort.postMessage(envelope.message);
        }
        return;
      }
      if (raw.epoch !== 0 && currentPort !== undefined && raw.epoch !== currentEpoch) return;
      if (currentPort === undefined) {
        pendingToPage.push(raw);
        return;
      }
      currentPort.postMessage(raw.message);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingToPage.length = 0;
      options.window.removeEventListener("message", onWindowMessage);
      currentPort?.close();
      currentPort = undefined;
    },
  };
}
