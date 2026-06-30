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

// ── AIGC extension(进程内 ExtensionFactory)───────────────────────────────────
export { aigcExtension } from "./aigc/extension.js";
export { registerImageGeneration } from "./aigc/tools/image-generation.js";
export { registerImageEdit } from "./aigc/tools/image-edit.js";

// ── Image-tool orchestrator(供自定义图像工具复用)──────────────────────────────
export {
  runImageTool,
  buildModelsDescription,
  optionalModelEnum,
} from "./aigc/run-image-tool.js";
export type { RunImageToolOptions, RunImageToolDeps } from "./aigc/run-image-tool.js";
export type { ImageRoute, InteractionParam, ToolExecuteDetails } from "./aigc/types.js";
