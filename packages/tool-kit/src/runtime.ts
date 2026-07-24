/**
 * `@blksails/pi-web-tool-kit/runtime` sub-entry — **execution layer** (node-only).
 *
 * Imports that pull in pi SDK, undici, or Node-only APIs belong here and
 * NEVER in `src/index.ts` (the main entry is front-end safe).
 *
 * Exported:
 *  - Engine execution: `runEndpoint`, `RunEndpointOptions`
 *  - Env resolver:     `resolveVars`, `resolveVarsOptional`, `checkRequiredVars`
 *  - Proxy fetch:      `proxyFetch`
 *  - Image normalize:  `normalizeImageDataUri`
 *  - Attachment seam:  `getAttachmentToolContext`, `SEAM_KEY`
 *  - Attachment store: `persistPicked`, `previewAssetsFromPicked`, `resolveInputToDataUri`, `PersistedAsset`
 *  - AIGC extension:   `aigcExtension`, `registerImageGeneration`, `registerImageEdit`
 *  - Image tool orchestrator (复用):`runImageTool`, `buildModelsDescription`, `optionalModelEnum`
 *  - Memory extension: `memoryExtension`, `createMemoryStore`, file/supabase stores
 *  - Structured user prompt: `askUserQuestionTool`
 *  - Execution-layer & route types
 */

// ── Engine ────────────────────────────────────────────────────────────────────
export { runEndpoint } from "./engine/endpoint-adapter.js";
export type { RunEndpointOptions } from "./engine/endpoint-adapter.js";

export {
  resolveVars,
  resolveVarsOptional,
  checkRequiredVars,
} from "./engine/var-resolver.js";

export { proxyFetch } from "./engine/proxy-fetch.js";

export { normalizeImageDataUri } from "./engine/normalize-image.js";

export type {
  EndpointBehavior,
  PickedResult,
  Pricing,
  RunStage,
  ToolProgress,
  BuildBodyContext,
  AsyncSpec,
  LocalExecuteHook,
} from "./engine/endpoint-types.js";

// ── Attachment ────────────────────────────────────────────────────────────────
export { getAttachmentToolContext, SEAM_KEY } from "./attachment/seam.js";

export {
  persistPicked,
  previewAssetsFromPicked,
  resolveInputToDataUri,
} from "./attachment/persist.js";
export type { PersistedAsset } from "./attachment/persist.js";

// ── Surface(agent-authoritative-surface · agent 侧门面 + 进程内注册表 seam)─────
export {
  createSurface,
  SurfaceCommandError,
  getSurfaceRegistry,
  SURFACE_REGISTRY_SEAM_KEY,
} from "./surface/index.js";
export type {
  SurfaceCtx,
  SurfaceConfig,
  SurfaceHandle,
  SurfaceCommandHandler,
  SurfaceCommandHandlerResult,
  CreateSurfaceDeps,
  SurfaceRegistry,
  SurfaceDispatch,
} from "./surface/index.js";

// ── panes 工作区 LLM 遥控(panes-workspace surface + pane_* 工具)────────────────
export {
  panesWorkspaceExtension,
  makePanesWorkspaceExtension,
} from "./panes/workspace-extension.js";
export type { PanesWorkspaceExtensionOptions } from "./panes/workspace-extension.js";

// ── pane 自带 tools 的绑定单元(pane 元信息 + extensions + routes 一体注册)──────
export { composePaneAgentModules } from "./panes/agent-modules.js";
export type {
  PaneAgentModule,
  PaneExtensionFactory,
  ComposedPaneAgentModules,
} from "./panes/agent-modules.js";

// ── AIGC extension(进程内 ExtensionFactory)───────────────────────────────────
export { aigcExtension } from "./aigc/extension.js";
export { registerImageGeneration } from "./aigc/tools/image-generation.js";
export { registerImageEdit } from "./aigc/tools/image-edit.js";

// ── aigc-canvas surface(domain="canvas" 的 AAS 实例;画廊 = attachment 物化视图)──────
export {
  canvasSurfaceExtension,
  makeCanvasSurfaceExtension,
  createCanvasCommands,
  rebuildGalleryFromAttachments,
  CANVAS_DOMAIN,
} from "./aigc/canvas/index.js";
export type {
  CanvasExtensionDeps,
  CanvasCommandDeps,
} from "./aigc/canvas/index.js";
export type {
  GalleryState,
  GalleryAsset,
  CanvasLineage,
} from "./aigc/canvas/index.js";

// ── vision extension(image_vision 工具 + /img_vision 命令;image-vision-tool)────
export { visionExtension, makeVisionExtension } from "./vision/extension.js";
export { createVisionRunner, envDefaultModel } from "./vision/run-vision-tool.js";
export { listVisionModels, modelKey } from "./vision/select-model.js";
export { resolveImageSource, pickLatestImage } from "./vision/resolve-image.js";
export { fail as visionFail } from "./vision/errors.js";
export { VISION_MODEL_ENV, DEFAULT_QUESTION } from "./vision/types.js";
export type {
  VisionResult,
  VisionOk,
  VisionFail,
  VisionFailureReason,
  VisionParams,
  VisionRunnerDeps,
  ResolvedImage,
  CompleteFn,
} from "./vision/types.js";

// ── Image-tool orchestrator(供自定义图像工具复用)──────────────────────────────
export {
  runImageTool,
  buildModelsDescription,
  optionalModelEnum,
} from "./aigc/run-image-tool.js";
export type { RunImageToolOptions, RunImageToolDeps } from "./aigc/run-image-tool.js";
export type { ImageRoute, InteractionParam, ToolExecuteDetails } from "./aigc/types.js";

// ── archive-tools(zip / unzip / unrar;node-only)──────────────────────────────
export {
  normalizeRoot,
  isInsideRoot,
  resolveUnderRoot,
  resolveUnderRootReal,
  resolveZipEntry,
  createZip,
  listZipEntries,
  extractZip,
  writeZipEntries,
  extractRar,
  detectRarBackend,
  writePlaceholderRar,
  rimraf,
} from "./archive/index.js";
export type {
  PathResolveResult,
  ArchiveResult,
  ArchiveErr,
  ArchiveOk,
  ArchiveErrorCode,
  ZipEntryMeta,
  RarBackend,
} from "./archive/index.js";

// ── memory-extension (long-term memory; file / supabase; node-only) ──────────
export {
  memoryExtension,
  makeMemoryExtension,
  registerMemoryTools,
  createMemoryStore,
  memoryConfigFromEnv,
  MemoryConfigError,
  MEMORY_ENV_KEYS,
  FileMemoryStore,
  SupabaseMemoryStore,
  normalizeMemoryName,
  isValidMemoryName,
  parseMemoryDocument,
  serializeMemoryDocument,
  memoryErr,
  toMeta,
} from "./memory/index.js";

export type {
  MemoryScope,
  MemoryEntry,
  MemoryEntryMeta,
  MemoryWriteInput,
  MemoryVisibility,
  MemoryListFilter,
  MemoryDeleteOpts,
  MemoryStore,
  MemoryErrorCode,
  MemoryOk,
  MemoryErr,
  MemoryResult,
  MemoryConfig,
  MemoryBackendKind,
  CreateMemoryStoreOptions,
  SupabaseMemoryStoreOptions,
  RegisterMemoryToolsOptions,
} from "./memory/index.js";

// ── AskUserQuestion tool(structured select interaction;node-only)────────────
export { askUserQuestionTool } from "./ask-user-question/tool.js";
