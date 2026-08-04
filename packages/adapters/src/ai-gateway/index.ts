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
  envSafeInstanceId,
  instanceEnvPrefix,
  type AiGatewayConfig,
} from "./config.js";
export {
  EnvKeyResolver,
  InstanceEnvKeyResolver,
  PerUserKeyResolver,
  NotImplementedError,
  type KeyResolver,
  type KeyResolveInput,
  type InstanceEnvKeyResolverOptions,
} from "./key-resolver.js";
export {
  createAiGatewayRoutes,
  aiGatewayScope,
  type CreateAiGatewayRoutesDeps,
  type AiGatewayInstanceRouteEntry,
} from "./routes.js";
export {
  GatewayModelCatalog,
  mergeModelCatalog,
  type GatewayModelEntry,
  type GatewayModelCatalogDeps,
  type ModelPrecedence,
} from "./model-catalog.js";
// spec ai-gateway-session-models:会话侧模型来源(装配层需 env 常量以构造 spawn env)。
export {
  AI_GATEWAY_PROVIDER_NAME,
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
  AI_GATEWAY_SESSION_INSTANCES_ENV,
  registerAiGatewayProvider,
  resolveAiGatewaySessionSpecFromEnv,
  resolveAiGatewaySessionSpecsFromEnv,
  declaredAiGatewaySessionProviderNamesFromEnv,
  sessionInstanceEnvPrefix,
  isSessionCapableGatewayModel,
  type AiGatewaySessionSpec,
  type AiGatewaySessionSpecEntry,
  type AiGatewaySessionLogger,
} from "./session-model-source.js";
// spec multi-gateway-providers 任务 3.1/3.3:多实例 env 解析 + 每实例目录聚合器(装配层
// 接通多实例见任务 3.6,`lib/app/pi-handler.ts`)。
export {
  GATEWAY_INSTANCES_ENV,
  DEFAULT_GATEWAY_INSTANCE_ID,
  resolveGatewayInstances,
  declaredGatewayInstanceIdsFromEnv,
  createGatewayCatalogs,
  type GatewayInstanceConfig,
  type GatewayCatalogAggregatorDeps,
} from "./instances.js";
