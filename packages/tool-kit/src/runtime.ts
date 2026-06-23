/**
 * `@pi-web/tool-kit/runtime` sub-entry — **execution layer** (node-only).
 *
 * Imports that pull in pi SDK, undici, or Node-only APIs belong here and
 * NEVER in `src/index.ts` (the main entry is front-end safe).
 *
 * Exported:
 *  - Engine execution: `runEndpoint`, `RunEndpointOptions`
 *  - Env resolver:     `resolveVars`, `resolveVarsOptional`, `checkRequiredVars`
 *  - Proxy fetch:      `proxyFetch`
 *  - Attachment seam:  `getAttachmentToolContext`, `SEAM_KEY`
 *  - Attachment store: `persistPicked`, `resolveInputToDataUri`, `PersistedAsset`
 *  - Tool 编译器:      `compileTool`, `CompileDeps`, `ToolExecuteDetails`
 *  - AIGC 工具集:      `buildAigcTools`, `AIGC_TOOLS`, `BuildAigcToolsOptions`
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

// ── Attachment ────────────────────────────────────────────────────────────────
export { getAttachmentToolContext, SEAM_KEY } from "./attachment/seam.js";

export { persistPicked, resolveInputToDataUri } from "./attachment/persist.js";
export type { PersistedAsset } from "./attachment/persist.js";

// ── Tool 编译器 (node-only — 含 pi SDK 值导入) ────────────────────────────────
export { compileTool } from "./engine/compile-tool.js";
export type { CompileDeps, ToolExecuteDetails } from "./engine/compile-tool.js";

// ── AIGC 工具集 ───────────────────────────────────────────────────────────────
export { buildAigcTools, AIGC_TOOLS } from "./aigc/index.js";
export type { BuildAigcToolsOptions } from "./aigc/index.js";
