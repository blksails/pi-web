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
// 传输无关会话核心:`RpcTransport` 端口 + `PiRpcSession`。local 走 `PiRpcProcess`。
//
// ★ 具体传输实现(e2b / ws-runner)与其配置解析、模板解析**不在本包**
//   —— 它们值依赖 `e2b` SDK,而内核包的依赖声明不得出现云沙箱 SDK
//   (spec: core-package-extraction,R1.2)。core 走源码直连分发,消费方 `tsc` 会
//   编译到每个文件,故"声明成 optional peer"在本仓不是可选项:缺类型即编译失败。
//   实现住在兼容层包的 `sandbox-transport` 模块,并由其经主 barrel 原样导出
//   —— 对既有消费方,`E2bTransport` 等符号的导入路径逐字不变。
export type { RpcTransport } from "./transport.js";
export { PiRpcSession } from "./pi-rpc-session.js";
export {
  SpawnError,
  ChannelClosedError,
  ChildCrashError,
  type Diagnostic,
  type DiagnosticKind,
} from "./pi-rpc-process.errors.js";
