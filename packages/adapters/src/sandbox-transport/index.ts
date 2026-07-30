/**
 * sandbox-transport — 云沙箱**传输实现**与其配置/模板解析(adapters 层)。
 *
 * 本模块由 core-package-extraction 任务 4.1 从内核包的 `rpc-channel` 摘出。摘出的判据
 * 不是"看着像适配器",而是一条硬约束:这四个文件值依赖 `e2b` SDK,而内核包的依赖声明
 * **不得**出现云沙箱 SDK(R1.2)。内核包走**源码直连**分发,消费方的 `tsc` 会编译到
 * 每一个文件 —— 故"把 e2b 声明成 optional peer"在本仓不是可选项:缺类型即编译失败。
 *
 * 传输**抽象**(`RpcTransport` 端口、`PiRpcSession` 核心)留在内核包;本模块只放绑定
 * 具体厂商的那一半。两者的接缝就是 `RpcTransport`。
 *
 * ★ 导出面与摘出前逐字一致,且仍经兼容层主 barrel 导出 —— 既有消费方零改动。
 */
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
// 三级沙箱模板解析(spec sandbox-baked-agent-image:显式映射→门控派生→全局→清晰错误)。
export {
  resolveSandboxTemplate,
  templateResolveMissingMessage,
  type TemplateResolveInput,
  type TemplateResolveSource,
  type TemplateResolution,
} from "./template-resolve.js";
