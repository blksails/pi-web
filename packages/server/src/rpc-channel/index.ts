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
// 传输无关会话核心 + e2b 云沙盒传输(spec e2b-sandbox-transport):
// `RpcTransport` 端口、`PiRpcSession` 核心、`E2bTransport` adapter 与其配置解析。
// local 仍走 `PiRpcProcess`(一期不迁移);e2b 经 `PiRpcSession(new E2bTransport(...))` 复用核心。
export type { RpcTransport } from "./transport.js";
export { PiRpcSession } from "./pi-rpc-session.js";
export { E2bTransport, type E2bTransportConfig } from "./e2b-transport.js";
// WS-runner 数据面传输(无 envd,连沙箱内 agent-runner;agent-sandbox/ACS 用)。
export {
  SandboxWsTransport,
  type SandboxWsTransportConfig,
} from "./sandbox-ws-transport.js";
export {
  e2bTransportConfigFromEnv,
  e2bDataPlaneFromEnv,
  selectTransport,
  E2B_CONFIG_MISSING_MESSAGE,
  type TransportSelection,
  type ResolvedE2bConfig,
  type E2bDataPlane,
} from "./e2b-config.js";
export {
  SpawnError,
  ChannelClosedError,
  ChildCrashError,
  type Diagnostic,
  type DiagnosticKind,
} from "./pi-rpc-process.errors.js";
