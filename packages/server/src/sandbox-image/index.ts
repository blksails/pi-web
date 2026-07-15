/**
 * sandbox-image 聚合导出面(`sandbox-baked-agent-image` spec)。
 *
 * 烘焙镜像的纯函数内核:标识派生(template-name)——构建期脚本与会话期
 * rpc-channel/template-resolve 共用,保证命名一致。仅依赖 node 内建。
 */
export {
  deriveSlug,
  deriveImageName,
  deriveTemplateName,
  type SourceIdentityInput,
} from "./template-name.js";
