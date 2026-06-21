/**
 * completion-provider-framework — 服务端公共出口。
 */
export type {
  CompletionCtx,
  CompletionProvider,
  CompletionRef,
  ResolvedContext,
} from "./types.js";
export { providerKind } from "./types.js";
export {
  createCompletionRegistry,
  type CompletionRegistry,
  type CompletionRegistryOptions,
} from "./registry.js";
export { mergeCompletions } from "./merge.js";
export { normalizeTrigger } from "./normalize.js";
export { serializeToken, parseTokens } from "./token.js";
export { resolveCompletions } from "./resolve.js";
export {
  createFileProvider,
  FILE_PROVIDER_ID,
  FILE_KIND,
  type FileProviderOptions,
} from "./providers/file-provider.js";
