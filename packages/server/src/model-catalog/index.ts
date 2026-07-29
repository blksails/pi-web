/**
 * model-catalog — chat/image 双命名空间目录组装服务(model-catalog spec)。
 *
 * 纯组装模块:零 env 读取、零 IO、零 pi SDK 值导入、**零适配器依赖**(依赖仅
 * config 纯过滤器与 tool-kit 主入口纯类型),可安全经 server 包 barrel 重导出。
 *
 * 网关的合并能力经 `mergeCatalog` 注入(spec: core-package-extraction 任务 3.1)——
 * 本模块因此不再值导入 `ai-gateway`,内核提取的最后一条继承欠债由此清零。
 */
export {
  createModelCatalogService,
  type CatalogImageEntry,
  type ModelCatalogService,
  type ModelCatalogServiceDeps,
} from "./service.js";
export type { GatewayModelEntry, MergeModelCatalog, ModelPrecedence } from "./types.js";
