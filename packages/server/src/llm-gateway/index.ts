/**
 * llm-gateway · 模块公共出口(barrel)。
 *
 * 当前仅导出 provider 登记表(design.md ProviderRegistry,Req 3.1)。网关路由
 * (`createLlmGatewayRoutes`)由后续任务(2.2)交付后在此追加导出。
 */
export {
  resolveLlmGatewayProviderTable,
  lookupLlmGatewayProvider,
  llmGatewayTokenEnvName,
  LLM_GATEWAY_PROVIDERS_ENV,
  LlmGatewayProviderConfigError,
  type LlmGatewayProviderEntry,
  type LlmGatewayProviderTable,
} from "./provider-registry.js";
