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
export { compileGlobs } from "./glob.js";
export { resolveCompletions } from "./resolve.js";
export {
  createFileProvider,
  FILE_PROVIDER_ID,
  FILE_KIND,
  type FileProviderOptions,
} from "./providers/file-provider.js";
export {
  createAttachmentProvider,
  ATTACHMENT_PROVIDER_ID,
  ATTACHMENT_KIND,
  type AttachmentLister,
} from "./providers/attachment-provider.js";
export {
  createAgentSlashProvider,
  AGENT_SLASH_PROVIDER_ID,
  type SlashCompletionSource,
} from "./providers/agent-slash-provider.js";
