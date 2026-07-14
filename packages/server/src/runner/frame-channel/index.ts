/**
 * frame-channel · 桶导出。
 *
 * runner 子进程父子 IPC 帧通道的共享原语单一权威:流视图接口、seam key 常量、上行 writer、
 * 单一入站帧通道、装配期声明帧、统一释放。
 */
export type {
  DataListener,
  ListenerOp,
  ReadableLike,
  WritableLike,
} from "./stream-views.js";
export {
  SESSION_STATE_SEAM_KEY,
  SURFACE_REGISTRY_SEAM_KEY,
  ATTACHMENT_TOOL_CONTEXT_KEY,
} from "./seam-keys.js";
export { makeLineWriter } from "./line-writer.js";
export {
  createInboundFrameRouter,
  type FrameChannel,
  type FrameHandler,
  type HandlerCtx,
  type SafeParser,
  type CreateFrameChannelInput,
} from "./frame-router.js";
export { emitAssemblyFrame } from "./assembly-frame.js";
export { disposeAll, type Disposable } from "./dispose.js";
