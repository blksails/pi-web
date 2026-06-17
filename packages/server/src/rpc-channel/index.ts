/**
 * rpc-channel — 传输无关 RPC 通道(端口 + 本地实现)聚合导出面。
 */
export type {
  PiRpcChannel,
  ChannelHealth,
  LineListener,
  Unsubscribe,
} from "./pi-rpc-channel.js";
export { JsonlLineReader } from "./jsonl-reader.js";
export { PiRpcProcess, type ExitInfo } from "./pi-rpc-process.js";
export {
  SpawnError,
  ChannelClosedError,
  ChildCrashError,
  type Diagnostic,
  type DiagnosticKind,
} from "./pi-rpc-process.errors.js";
