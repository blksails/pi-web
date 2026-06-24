/**
 * `@blksails/server` runner module — bootstrap runner public surface.
 *
 * Re-exports the loader, option mapper, project-trust wiring and runner entry
 * helpers. The process entry lives in `runner.ts`.
 */
export {
  InvalidAgentDefinitionError,
  loadAgentDefinition,
  markRuntimeFactory,
  type NormalizedAgentRuntimeFactory,
  RUNTIME_FACTORY_BRAND,
} from "./agent-loader.js";
export {
  buildRuntimeFactory,
  isModelRef,
  mapResourceLoaderOptions,
  mapSessionFields,
  type MappedResourceLoaderOptions,
  type MappedSessionFields,
} from "./option-mapper.js";
export {
  makeResolveProjectTrust,
  type ResolveProjectTrust,
} from "./project-trust.js";
export {
  main,
  parseRunnerArgs,
  type RunnerArgs,
  RunnerArgsError,
  startRunner,
} from "./runner.js";
export {
  wireAttachmentBridge,
  ATTACHMENT_TOOL_CONTEXT_KEY,
  type WireAttachmentBridgeInput,
  type AttachmentBridgeWiring,
} from "./attachment-wiring.js";
