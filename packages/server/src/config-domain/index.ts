/**
 * config-domain —— 配置域注册表端口(spec: host-contract-ports,任务 5.3;Req 7.1-7.5)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §6。
 *
 * pi-SDK-free:本模块只依赖 `zod` 与 `@blksails/pi-web-protocol` 的纯类型/纯数据导出
 * (`FormSchema` 与各域 zod/表单 IR),无任何 pi SDK 值导入,可安全经 server 主 barrel
 * 重导出(由任务 6.2 收口)。
 */
export {
  ConfigDomainRegistrationError,
  type ConfigDomainDescriptor,
  type ConfigDomainRegistrationErrorCode,
  type ConfigDomainRegistry,
} from "./types.js";
export { createConfigDomainRegistry } from "./registry.js";
export { registerHostConfigDomains } from "./default-domains.js";
