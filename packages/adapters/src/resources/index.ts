export { createPiResourceManager, PiResourceManager } from "./manager.js";
export { createResourceRoutes } from "./routes.js";
export type { ResourceRoutesOptions, ResourceAgentTarget } from "./routes.js";
export {
  assertValidSkillSubmission,
  buildSkillMarkdown,
  MAX_SKILL_BYTES,
  SkillValidationError,
  validateSkillSubmission,
} from "./skill-validator.js";
export type {
  SkillSubmission,
  SkillValidationCode,
  SkillValidationDiagnostic,
  SkillValidationReport,
  SkillValidationSeverity,
} from "./skill-validator.js";
export {
  RESOURCE_SCOPES,
  type ConfiguredResourcePackage,
  type CreateSkillInput,
  type CreateTemplateInput,
  type ManagedResource,
  type ManagedResourceDocument,
  type ManagedResourceKind,
  type ResourceCatalog,
  type ResourceManager,
  type ResourceManagerOptions,
  type ResourcePermissions,
  type ResourceScope,
  type ResourceScopePermission,
} from "./types.js";
