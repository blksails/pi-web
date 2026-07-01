/**
 * agent-source-list — 只读 agent source 枚举(agent-sources-list)。
 *
 * 对外暴露端点工厂、provider 工厂与类型;数据来源为「目录扫描 ∪ 注册表文件」两路合并。
 */
export {
  createAgentSourcesRoutes,
  type AgentSourcesRoutesOptions,
} from "./agent-sources-routes.js";
export { createScanSourceProvider } from "./scan-provider.js";
export { createRegistrySourceProvider } from "./registry-provider.js";
export {
  createCompositeSourceProvider,
  compareAgentSourceRecords,
} from "./composite-provider.js";
export {
  createFavoritesRoutes,
  type FavoritesRoutesOptions,
} from "./favorites-routes.js";
export {
  createFavoritesStore,
  type FavoritesStore,
  type FavoritesStoreOptions,
} from "./favorites-store.js";
export type {
  AgentSourceProvider,
  AgentSourceRecord,
  ScanProviderOptions,
  RegistryProviderOptions,
} from "./types.js";
