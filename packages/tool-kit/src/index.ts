/**
 * `@blksails/pi-web-tool-kit` 主入口 —— **声明层**(前端安全)。
 *
 * 仅导出前端安全的纯数据/类型。**禁止**从此入口直接或间接顶层 import pi SDK / pi-ai /
 * undici 等运行时库:执行层(AIGC extension、runImageTool、runEndpoint 等)一律走
 * `@blksails/pi-web-tool-kit/runtime` 子入口,以守 Next/webpack externals 边界(Req 6.4)。
 *
 * detoolspec-unify-builtin-tools:移除 `engine/types`(声明式工具框架)、`AIGC_TOOLS`、
 * `imageGeneration`/`imageEdit`(ToolSpec 数据)的主入口导出。AIGC 改以 extension 形态从 runtime 导出。
 */

// 内置斜杠命令声明(builtin-plugin-command);纯数据 + 类型,前端安全。
export { BUILTIN_COMMANDS } from "./commands/builtin.js";
export type {
  BuiltinCommandSpec,
  BuiltinCommandTarget,
  BuiltinSubcommand,
} from "./commands/types.js";

// 状态注入桥作者接入点(state-injection-bridge):读 globalThis seam,前端安全降级。
export {
  getSessionState,
  SESSION_STATE_SEAM_KEY,
  type SessionStateAccess,
} from "./session-state.js";

// AIGC slash 补全候选声明(agent-slash-completion);纯数据 + 仅类型,前端安全。
export { aigcSlashCompletions } from "./aigc/slash-completions.js";

export {
  SIZE_OPTIONS,
  DASHSCOPE_SIZE_OPTIONS,
  DEFAULT_SIZE_OPTIONS,
} from "./aigc/size-options.js";

export {
  parseSize,
  formatSize,
  planGenSize,
  planModelAndTargetSize,
  resolveUserSize,
  GEN_STEP,
} from "./aigc/size-fit.js";

// AIGC 图像模型展示目录(aigc-tool-settings);纯数据,前端/server 安全,供 /settings 模型开关列举。
export {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
  CLOUDFLARE_AIGC_CATALOG,
  type AigcCatalogEntry,
} from "./aigc/model-catalog.js";

// Cloudflare 通路的启用判据(spec cloudflare-aigc-provider)。runner 侧 aigcExtension 与
// 宿主侧 /aigc/models 目录装配共用这一个函数,避免判据漂移。纯函数、零 pi SDK,前端安全。
export {
  isCloudflareConfigured,
  CLOUDFLARE_REQUIRED_ENV,
  CLOUDFLARE_AIGC_JSON_KEYS,
  cloudflareEnvFromAigcConfig,
  mergeCloudflareRuntimeEnv,
} from "./aigc/providers/cloudflare.js";
// 运行时 re-read aigc.json → CLOUDFLARE_* bag(release 桌面无 .env.local)。
export {
  readAigcConfigFile,
  resolveCloudflareRuntimeEnv,
  cloudflareSpawnEnvFragment,
  isCloudflareConfiguredAtRuntime,
  type ResolveCloudflareRuntimeEnvOptions,
  type ReadFileSync,
} from "./aigc/cloudflare-runtime.js";

// 网关实例(图像侧)的跨进程契约解析(spec desktop-aigc-egress 任务 3.2)。
// 从**主入口**转出是刻意的:本模块不在顶层读 `process.env`(env 一律由入参传入),
// 故属声明层安全。契约互锁测试要同时 import 它与适配层那份解析器,需要一个稳定入口。
export {
  resolveGatewayImageInstances,
  type GatewayImageInstance,
} from "./aigc/gateway-instances.js";
// 按实例生成的图像路由(spec desktop-aigc-egress 任务 3.3)。同样是纯声明层:
// 基址与凭据**变量名**都来自入参,不读 env、不含 pi SDK。
export {
  createGatewayImageRoutes,
  createGatewayImageRoutesForAll,
  selectGatewayImageModels,
  GATEWAY_IMAGE_MODEL_WHITELIST,
  type GatewayImageRouteSet,
} from "./aigc/gateway-image-routes.js";
