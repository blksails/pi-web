/**
 * 子帧侧：应答握手 + 接管端口。
 *
 * 与宿主侧的**不对称**处（照抄宿主的校验会写错）：
 *  - 子帧**无法**校验 origin —— 宿主 origin 对子帧是任意的，硬编码就把库锁死在一个部署上。
 *    子帧唯一可用的身份锚是 **`event.source === window.parent`**（顶层打开时无父帧，直接拒收）。
 *  - 子帧**必须**接受**重复的 `init`**：宿主 React 树重挂时会重新握手，若沿用宿主那边
 *    「已连接则忽略」的写法，子帧会永远抱着一根已死的管道。此处改为**换管道**（旧的销毁）。
 *
 * 子帧不主动 ping：由宿主轮询、子帧应答，故宿主先就绪 / 子帧先就绪都能握上。
 */
import {
  isHostHandshakeMessage,
  type GuestReadyMessage,
} from "./protocol.js";
import {
  createRpcEndpoint,
  type PortLike,
  type RpcEndpoint,
  type RpcEndpointOptions,
} from "./endpoint.js";

export interface GuestMessageEventLike {
  readonly source?: unknown;
  readonly data?: unknown;
  readonly ports?: readonly unknown[];
}

export interface GuestWindowLike {
  addEventListener(
    type: "message",
    listener: (ev: GuestMessageEventLike) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (ev: GuestMessageEventLike) => void,
  ): void;
  readonly parent?: unknown;
}

export interface ConnectToHostOptions {
  /** 本帧对宿主开放的方法表。 */
  readonly handlers?: RpcEndpointOptions["handlers"];
  /** 其余端点选项（事件回调 / 超时 / 静音名单…）。 */
  readonly endpoint?: Omit<RpcEndpointOptions, "handlers">;
  /** 收到 `init`（每次握手一次；重挂会再来一次）。 */
  readonly onInit?: (instanceId: string, endpoint: RpcEndpoint) => void;
  /** 宿主推来的可见性。子帧据此启停 rAF / 轮询 / 播放。 */
  readonly onVisibility?: (visible: boolean) => void;
  /** 本帧的 window，默认 `globalThis`。 */
  readonly guestWindow?: GuestWindowLike;
  /** 宿主窗口引用，默认 `guestWindow.parent`。 */
  readonly expectedSource?: unknown;
}

export interface GuestConnection {
  endpoint(): RpcEndpoint | null;
  /** 宿主最近一次告知的可见性。 */
  isVisible(): boolean;
  destroy(): void;
}

function isPortLike(v: unknown): v is PortLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PortLike).postMessage === "function" &&
    typeof (v as PortLike).addEventListener === "function"
  );
}

export function connectToHost(
  opts: ConnectToHostOptions = {},
): GuestConnection {
  const win = opts.guestWindow ?? (globalThis as unknown as GuestWindowLike);
  const expectedSource = opts.expectedSource ?? win.parent;

  let endpoint: RpcEndpoint | null = null;
  let visible = true;
  let destroyed = false;

  const onMessage = (ev: GuestMessageEventLike): void => {
    if (destroyed) return;
    // 身份锚：只认父帧。顶层打开（无父帧 / parent === self）时 expectedSource 不成立即拒收。
    if (expectedSource === undefined || expectedSource === null) return;
    if (ev.source !== expectedSource) return;
    const data = ev.data;
    if (!isHostHandshakeMessage(data)) return; // 词表外 / 版本不符 → 丢弃
    switch (data.t) {
      case "ping": {
        const ready: GuestReadyMessage = { t: "ready", v: 1 };
        // 宿主 origin 未知 ⇒ 只能 "*"；故此包同样不得携带机密。
        (expectedSource as { postMessage(d: unknown, o: string): void }).postMessage(
          ready,
          "*",
        );
        return;
      }
      case "visibility": {
        visible = data.visible;
        endpoint?.setActive(data.visible);
        opts.onVisibility?.(data.visible);
        return;
      }
      case "init": {
        const port = ev.ports?.[0];
        if (!isPortLike(port)) return;
        // 重挂即换管道：旧端点必须销毁，否则泄漏监听器且永远等不到回应。
        endpoint?.destroy();
        const endpointOpts: RpcEndpointOptions = {
          ...(opts.endpoint ?? {}),
          ...(opts.handlers !== undefined ? { handlers: opts.handlers } : {}),
        };
        endpoint = createRpcEndpoint(port, endpointOpts);
        endpoint.setActive(visible);
        opts.onInit?.(data.instanceId, endpoint);
        return;
      }
      default:
        return;
    }
  };

  win.addEventListener("message", onMessage);

  return {
    endpoint: () => endpoint,
    isVisible: () => visible,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener("message", onMessage);
      endpoint?.destroy();
      endpoint = null;
    },
  };
}
