/**
 * frame-rpc 线上词表 —— 宿主与沙箱子帧之间**唯一**被承认的消息形状。
 *
 * 分两条通道，语义严格不同：
 *  - **窗口通道**（裸 `postMessage`）：只跑握手与可见性。子帧是 `sandbox="allow-scripts"`
 *    的**不透明 origin**，`targetOrigin` 只能写 `"*"`（MDN 对 opaque origin 的规定），
 *    故窗口通道上的包**不得携带任何机密**。
 *  - **端口通道**（握手交付的 `MessagePort`）：跑业务 RPC。点对点、不可被第三方监听。
 *
 * 词表固定：不在此列的 `t` 一律**丢弃**（不抛、不记录内容——记录即把不可信数据带进日志）。
 */

/** 协议版本；不匹配的包一律丢弃（没有向下兼容的隐式降级）。 */
export const FRAME_RPC_VERSION = 1 as const;

/** 不透明 origin 序列化后的字面量。 */
export const OPAQUE_ORIGIN = "null";

/** 宿主 → 子帧（窗口通道，裸 postMessage，无机密）。 */
export type HostHandshakeMessage =
  | { readonly t: "ping"; readonly v: 1 }
  | { readonly t: "init"; readonly v: 1; readonly instanceId: string }
  | { readonly t: "visibility"; readonly v: 1; readonly visible: boolean };

/** 子帧 → 宿主（窗口通道）——只此一种，其余一律丢弃。 */
export interface GuestReadyMessage {
  readonly t: "ready";
  readonly v: 1;
}

/** 端口通道消息（双向对称）。 */
export type PortMessage =
  | {
      readonly t: "req";
      readonly id: string;
      readonly method: string;
      readonly params?: unknown;
    }
  | { readonly t: "ack"; readonly id: string }
  | {
      readonly t: "res";
      readonly id: string;
      readonly ok: true;
      readonly result?: unknown;
    }
  | {
      readonly t: "res";
      readonly id: string;
      readonly ok: false;
      readonly error: string;
    }
  | { readonly t: "evt"; readonly name: string; readonly data?: unknown };

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 子帧 → 宿主的握手包形状校验（词表固定，版本必须匹配）。 */
export function isGuestReadyMessage(data: unknown): data is GuestReadyMessage {
  return (
    isRecord(data) && data["t"] === "ready" && data["v"] === FRAME_RPC_VERSION
  );
}

/** 宿主 → 子帧的握手/可见性包形状校验。 */
export function isHostHandshakeMessage(
  data: unknown,
): data is HostHandshakeMessage {
  if (!isRecord(data) || data["v"] !== FRAME_RPC_VERSION) return false;
  switch (data["t"]) {
    case "ping":
      return true;
    case "init":
      return typeof data["instanceId"] === "string";
    case "visibility":
      return typeof data["visible"] === "boolean";
    default:
      return false;
  }
}

/**
 * 可安全回显给对端的 method 名字符集。回显不可信输入本身是放大面（日志注入 / 终端转义），
 * 故只在**形状受控**时回显，其余场景用不带名字的通用错误。
 */
const SAFE_METHOD_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function isSafeMethodName(method: string): boolean {
  return SAFE_METHOD_RE.test(method);
}
