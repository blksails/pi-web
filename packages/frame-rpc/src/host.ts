/**
 * 宿主侧：接收闸 + 握手驱动。
 *
 * 为什么 origin 校验在这条链路上「反过来用」：子帧是 `sandbox="allow-scripts"`（**刻意不含**
 * `allow-same-origin`）⇒ 不透明 origin，`event.origin` 恒为 `"null"`。于是
 *  - `origin` 从「拒收条件」降级为**期望值断言**（收到别的 origin 反而说明不是我们那个沙箱）；
 *  - 真正的身份锚是 **`event.source === iframe.contentWindow` 引用相等**。
 *
 * 握手用 **ping-pong 轮询**，不是单向 ready：子帧比父帧先就绪时，单向 ready 会静默丢包
 * （父帧还没挂监听器），表现为随机的「模块永远转圈」。
 *
 * 握手包是这条链路上**唯一**的裸 `postMessage`（不透明 origin 只能 `targetOrigin: "*"`），
 * 故**不得携带任何机密**；握手一成，业务流量全部改走 transfer 交付的 `MessagePort`。
 */
import {
  isGuestReadyMessage,
  OPAQUE_ORIGIN,
  type HostHandshakeMessage,
} from "./protocol.js";
import {
  createRpcEndpoint,
  type PortLike,
  type RpcEndpoint,
  type RpcEndpointOptions,
} from "./endpoint.js";

/** 结构化的最小 DOM 面（不 import `lib.dom`，便于在 node 下直测）。 */
export interface FrameWindowLike {
  postMessage(
    data: unknown,
    targetOrigin: string,
    transfer?: readonly unknown[],
  ): void;
}

export interface FrameLike {
  readonly contentWindow: FrameWindowLike | null;
}

export interface MessageEventLike {
  readonly origin?: unknown;
  readonly source?: unknown;
  readonly data?: unknown;
}

export interface HostWindowLike {
  addEventListener(
    type: "message",
    listener: (ev: MessageEventLike) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (ev: MessageEventLike) => void,
  ): void;
}

export interface ChannelLike {
  readonly port1: PortLike;
  readonly port2: unknown;
}

export interface HandshakeGuardOptions {
  /** 握手时保存的 `iframe.contentWindow`；**引用相等**是此链路唯一可用的身份锚。 */
  readonly expectedSource: unknown;
  /** 期望的 origin；沙箱不透明 origin 场景为 `"null"`。 */
  readonly expectedOrigin?: string;
}

/**
 * 接收侧三道闸，顺序不可换：① origin 断言 → ② source 引用相等 → ③ 形状校验。
 * 任一不过一律 **丢弃**（不抛、不记录内容——记录即把不可信数据带进日志）。
 */
export function acceptsFrameMessage(
  event: MessageEventLike,
  opts: HandshakeGuardOptions,
): boolean {
  const expectedOrigin = opts.expectedOrigin ?? OPAQUE_ORIGIN;
  if (event.origin !== expectedOrigin) return false;
  if (opts.expectedSource === undefined || opts.expectedSource === null)
    return false;
  if (event.source !== opts.expectedSource) return false;
  return isGuestReadyMessage(event.data);
}

export interface ConnectSandboxFrameOptions {
  /** 目标 `<iframe>`（只用到 `contentWindow`）。 */
  readonly frame: FrameLike;
  /** 交给子帧的实例标识（非机密：走的是裸窗口通道）。 */
  readonly instanceId: string;
  /** 初始可见性，默认 `true`。 */
  readonly visible?: boolean;
  /** 端点选项（`handlers` 即宿主对子帧开放的方法表）。 */
  readonly endpoint?: RpcEndpointOptions;
  /** ping 间隔，默认 120ms。 */
  readonly pingIntervalMs?: number;
  /** 放弃握手的时限，默认 15000ms。 */
  readonly handshakeTimeoutMs?: number;
  /** 期望 origin，默认 `"null"`。 */
  readonly expectedOrigin?: string;
  /** 监听 `message` 的窗口，默认 `globalThis`。 */
  readonly hostWindow?: HostWindowLike;
  /** 通道工厂，默认 `new MessageChannel()`（注入点用于 node 直测）。 */
  readonly createChannel?: () => ChannelLike;
  /** 握手成功。 */
  readonly onConnect?: (endpoint: RpcEndpoint) => void;
  /** 超时未握上手。 */
  readonly onHandshakeTimeout?: () => void;
}

export interface SandboxFrameConnection {
  /** 已连接则返回端点，否则 `null`。 */
  endpoint(): RpcEndpoint | null;
  /** 推可见性（窗口通道）并同步端点的静音开关。 */
  setVisible(visible: boolean): void;
  destroy(): void;
}

function defaultChannel(): ChannelLike {
  const ctor = (globalThis as unknown as {
    MessageChannel?: new () => ChannelLike;
  }).MessageChannel;
  if (ctor === undefined) {
    throw new Error("MessageChannel is unavailable; inject createChannel");
  }
  return new ctor();
}

export function connectSandboxFrame(
  opts: ConnectSandboxFrameOptions,
): SandboxFrameConnection {
  const hostWindow =
    opts.hostWindow ?? (globalThis as unknown as HostWindowLike);
  const makeChannel = opts.createChannel ?? defaultChannel;
  const pingMs = opts.pingIntervalMs ?? 120;
  const giveUpMs = opts.handshakeTimeoutMs ?? 15_000;

  let endpoint: RpcEndpoint | null = null;
  let visible = opts.visible ?? true;
  let destroyed = false;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

  const post = (msg: HostHandshakeMessage, transfer?: readonly unknown[]): void => {
    const target = opts.frame.contentWindow;
    if (target === null) return;
    // 不透明 origin 下 targetOrigin 只能是 "*"；故此通道上永不放机密。
    if (transfer === undefined) target.postMessage(msg, "*");
    else target.postMessage(msg, "*", transfer);
  };

  const stopHandshake = (): void => {
    if (pingTimer !== undefined) clearInterval(pingTimer);
    if (giveUpTimer !== undefined) clearTimeout(giveUpTimer);
    pingTimer = undefined;
    giveUpTimer = undefined;
  };

  const onWindowMessage = (ev: MessageEventLike): void => {
    if (destroyed || endpoint !== null) return;
    const guard: HandshakeGuardOptions =
      opts.expectedOrigin === undefined
        ? { expectedSource: opts.frame.contentWindow }
        : {
            expectedSource: opts.frame.contentWindow,
            expectedOrigin: opts.expectedOrigin,
          };
    if (!acceptsFrameMessage(ev, guard)) return;
    stopHandshake();
    const channel = makeChannel();
    endpoint = createRpcEndpoint(channel.port1, opts.endpoint ?? {});
    endpoint.setActive(visible);
    // **顺序要紧**：可见性先于 init 发出。两者同走窗口通道故严格有序；而 port 上的首条消息
    // 必然晚于子帧处理 `init`，于是子帧一定「先看到可见性、再收到 RPC」。反过来放会让
    // 可见性与 port 请求分属两条通道，投递顺序无保证。
    post({ t: "visibility", v: 1, visible });
    post({ t: "init", v: 1, instanceId: opts.instanceId }, [channel.port2]);
    opts.onConnect?.(endpoint);
  };

  hostWindow.addEventListener("message", onWindowMessage);
  post({ t: "ping", v: 1 });
  pingTimer = setInterval(() => post({ t: "ping", v: 1 }), pingMs);
  giveUpTimer = setTimeout(() => {
    if (endpoint !== null) return;
    stopHandshake();
    opts.onHandshakeTimeout?.();
  }, giveUpMs);

  return {
    endpoint: () => endpoint,
    setVisible(next): void {
      if (destroyed || visible === next) return;
      visible = next;
      post({ t: "visibility", v: 1, visible: next });
      endpoint?.setActive(next);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stopHandshake();
      hostWindow.removeEventListener("message", onWindowMessage);
      // 尽力而为：让子帧在管道关闭前先知道自己已不可见（停 rAF / 停轮询）。
      post({ t: "visibility", v: 1, visible: false });
      endpoint?.destroy();
      endpoint = null;
    },
  };
}
