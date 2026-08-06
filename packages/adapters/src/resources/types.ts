import type { PackageManager } from "@earendil-works/pi-coding-agent";

export const RESOURCE_SCOPES = ["company", "agent", "personal"] as const;
export type ResourceScope = (typeof RESOURCE_SCOPES)[number];
export type ManagedResourceKind = "skill" | "template";

/** Public DTO mirror; pi keeps ConfiguredPackage internal to its package-manager module. */
export interface ConfiguredResourcePackage {
  readonly source: string;
  readonly scope: "user" | "project";
  readonly filtered: boolean;
  readonly installedPath?: string;
}

export interface ManagedResource {
  readonly kind: ManagedResourceKind;
  readonly scope: ResourceScope;
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly path: string;
}

export interface ResourceCatalog {
  readonly skills: readonly ManagedResource[];
  readonly templates: readonly ManagedResource[];
  readonly packages: readonly ConfiguredResourcePackage[];
}

export interface ResourceManagerOptions {
  readonly cwd: string;
  readonly agentDir: string;
  /** Company resources are explicit; no implicit company directory is loaded. */
  readonly companyRoot?: string;
  readonly packageManager?: PackageManager;
}

export interface CreateSkillInput {
  readonly scope: ResourceScope;
  readonly name: string;
  readonly description?: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface CreateTemplateInput {
  readonly scope: ResourceScope;
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface ResourceManager {
  list(): Promise<ResourceCatalog>;
  createSkill(input: CreateSkillInput): Promise<ManagedResource>;
  createTemplate(input: CreateTemplateInput): Promise<ManagedResource>;
  remove(kind: ManagedResourceKind, scope: ResourceScope, name: string): Promise<void>;
  installPackage(scope: ResourceScope, source: string): Promise<void>;
  removePackage(scope: ResourceScope, source: string): Promise<boolean>;
}
