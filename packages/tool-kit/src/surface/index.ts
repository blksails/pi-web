/**
 * `@blksails/pi-web-tool-kit` surface 子模块 barrel(agent-authoritative-surface)。
 *
 * agent 侧门面 `createSurface` + 进程内注册表 seam。经 runtime 子入口重导出
 * (`create-surface.ts` 含 pi ExtensionAPI 类型导入 → runtime-only)。
 */
export {
  createSurface,
  SurfaceCommandError,
  type SurfaceCtx,
  type SurfaceConfig,
  type SurfaceHandle,
  type SurfaceCommandHandler,
  type SurfaceCommandHandlerResult,
  type CreateSurfaceDeps,
} from "./create-surface.js";
export {
  getSurfaceRegistry,
  SURFACE_REGISTRY_SEAM_KEY,
  type SurfaceRegistry,
  type SurfaceDispatch,
} from "./surface-registry.js";
