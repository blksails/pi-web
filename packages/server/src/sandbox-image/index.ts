/**
 * sandbox-image 聚合导出面(`sandbox-baked-agent-image` spec)。
 *
 * 烘焙镜像的纯函数内核:标识派生(template-name)——构建期脚本与会话期
 * rpc-channel/template-resolve 共用,保证命名一致;烘焙计划(bake-plan)——
 * 收集/排除/Dockerfile 文本/tag 决策,经 BakeFsPort 注入读盘。仅依赖 node 内建。
 */
export {
  deriveSlug,
  deriveImageName,
  deriveTemplateName,
  type SourceIdentityInput,
} from "./template-name.js";
export {
  computeBakePlan,
  isBakeExcluded,
  BAKE_EXCLUDES,
  PI_WEB_DIST_EXCEPTION,
  BAKE_BUNDLE_EXTERNALS,
  type BakeFsPort,
  type BakePlan,
  type BakePlanError,
  type BakePlanOptions,
  type Result,
} from "./bake-plan.js";
