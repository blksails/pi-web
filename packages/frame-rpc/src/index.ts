/**
 * `@blksails/pi-web-frame-rpc` —— 宿主 ↔ 沙箱 iframe 的最小可信通信地基。
 *
 * 面向的是「把第三方 / 模型生成的 UI 放进 `sandbox="allow-scripts"` 子帧」这一类需求：
 * 隔离由 sandbox 属性给，**通信本身**则需要一套不会把隔离白送掉的协议。本包提供的就是那套协议
 * 与两侧参考实现，零依赖、框架无关。
 *
 * 三块：
 *  - `protocol`：固定词表与形状校验（词表外一律丢弃）。
 *  - `host`：三道闸（origin 断言 → source 引用相等 → 形状校验）+ ping-pong 握手驱动 +
 *    `MessagePort` 交付。
 *  - `guest`：子帧侧对等实现（应答握手、接管端口、可见性回调）。
 *
 * 两侧共用 `createRpcEndpoint`：**双向** req/ack/res + 事件，带 ack 短超时、响应长超时、
 * 入站并发上限、后台静音、错误不外泄。
 */
export {
  FRAME_RPC_VERSION,
  OPAQUE_ORIGIN,
  isGuestReadyMessage,
  isHostHandshakeMessage,
  isSafeMethodName,
  type GuestReadyMessage,
  type HostHandshakeMessage,
  type PortMessage,
} from "./protocol.js";

export {
  createRpcEndpoint,
  type PortLike,
  type RpcEndpoint,
  type RpcEndpointOptions,
  type RpcHandler,
} from "./endpoint.js";

export {
  acceptsFrameMessage,
  connectSandboxFrame,
  type ChannelLike,
  type ConnectSandboxFrameOptions,
  type FrameLike,
  type FrameWindowLike,
  type HandshakeGuardOptions,
  type HostWindowLike,
  type MessageEventLike,
  type SandboxFrameConnection,
} from "./host.js";

export {
  connectToHost,
  type ConnectToHostOptions,
  type GuestConnection,
  type GuestMessageEventLike,
  type GuestWindowLike,
} from "./guest.js";
