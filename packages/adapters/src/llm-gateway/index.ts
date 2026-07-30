/**
 * llm-gateway · 模块公共出口(barrel)。
 *
 * 导出 provider 登记表(design.md ProviderRegistry,Req 3.1)与网关路由
 * (`createLlmGatewayRoutes`,design.md LlmGatewayRoutes,Req 3.1-3.3, 3.7;透传/流式细节
 * 见 2.3)。
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
export {
  createLlmGatewayRoutes,
  type CreateLlmGatewayRoutesDeps,
} from "./gateway-routes.js";
