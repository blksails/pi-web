/**
 * 能力面清单端口出口(spec: host-contract-ports,任务 5.2;Req 6.1-6.7)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §5。
 *
 * pi-SDK-free:本模块三个文件均为纯类型、纯常量、纯函数,**无 pi SDK 值导入**(实为零外部
 * 依赖,连 node builtins 也不用),可安全经 server 主 barrel `export *` 重导出 ——
 * 主入口那条 `export * from "./host-manifest/index.js"` 由任务 6.2 添加,不在本任务边界内。
 */
export {
  CapabilityCompositionError,
  type CapabilityCompositionErrorCode,
  type CapabilityDecision,
  type CapabilityDescriptor,
  type CapabilityFactory,
  type ComposeCapabilitiesInput,
} from "./types.js";
export { HOST_CAPABILITY_IDS_V1 } from "./capability-ids.js";
export { composeCapabilities } from "./compose.js";
