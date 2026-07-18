/**
 * ai-gateway · 模块公共出口(barrel)。
 *
 * 导出装配期配置解析(`resolveAiGatewayConfig`)、Key 解析器(`KeyResolver` 及其
 * 实现)与主对话转发路由(`createAiGatewayRoutes`)。与 `llm-gateway/index.ts` 同构。
 */
export {
  resolveAiGatewayConfig,
  AiGatewayConfigError,
  AI_GATEWAY_BASE_URL_ENV,
  AI_GATEWAY_TIMEOUT_MS_ENV,
  AI_GATEWAY_CATALOG_TTL_MS_ENV,
  AI_GATEWAY_MODEL_PRECEDENCE_ENV,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CATALOG_TTL_MS,
  type AiGatewayConfig,
} from "./config.js";
export {
  EnvKeyResolver,
  PerUserKeyResolver,
  NotImplementedError,
  type KeyResolver,
  type KeyResolveInput,
} from "./key-resolver.js";
export {
  createAiGatewayRoutes,
  type CreateAiGatewayRoutesDeps,
} from "./routes.js";
export {
  GatewayModelCatalog,
  mergeModelCatalog,
  type GatewayModelEntry,
  type GatewayModelCatalogDeps,
  type ModelPrecedence,
} from "./model-catalog.js";
