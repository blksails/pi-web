/**
 * model-catalog — chat/image 双命名空间目录组装服务(model-catalog spec)。
 *
 * 纯组装模块:零 env 读取、零 IO、零 pi SDK 值导入(依赖仅 ai-gateway 纯函数、
 * config 纯过滤器与 tool-kit 主入口纯类型),可安全经 server 包 barrel 重导出。
 */
export {
  createModelCatalogService,
  type CatalogImageEntry,
  type ModelCatalogService,
  type ModelCatalogServiceDeps,
} from "./service.js";
