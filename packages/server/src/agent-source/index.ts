/**
 * agent-source-resolver — 公共导出面。
 *
 * 下游(如 extension-management)应从此公共面导入 TrustDecision / TrustFragment /
 * applyTrust 等,而非深层实现路径。`SpawnSpec` 不在此重导出——下游应直接从
 * `@blksails/pi-web-protocol`(其拥有者)导入。
 */
export { AgentSourceResolver, resolve } from "./resolver.js";
export { applyTrust } from "./trust-apply.js";
export { defaultTrustPolicy, resolveTrustPolicy } from "./trust-policy.js";
export { decideMode } from "./mode-decide.js";
export { probeEntry, ENTRY_PRIORITY } from "./entry-probe.js";
export { identify } from "./source-type.js";
export {
  ensureGitSource,
  deriveCachePath,
  defaultGitCacheRoot,
  runGit,
  nonInteractiveGitEnv,
} from "./git-clone.js";
export { assemble } from "./assemble-spawn.js";
export { SourceKindError, GitResolveError, EntryOverrideError, AgentSourceError } from "./errors.js";

export type {
  ResolvedSource,
  AgentMode,
  TrustDecision,
  TrustFragment,
  ResolveOptions,
  SourceResolverPlugin,
  GitSource,
  EntryProbe,
  IdentifiedSource,
  AgentSourceResolver as AgentSourceResolverType,
} from "./types.js";
