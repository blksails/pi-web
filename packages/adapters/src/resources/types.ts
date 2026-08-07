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
  /** Skill frontmatter 的人类可读标题。 */
  readonly title?: string;
  readonly description: string;
  readonly argumentHint?: string;
  /** 模板的源数据标题，用于聊天快捷卡片。 */
  readonly sourceTitle?: string;
  /** 模板的源数据封面(URL 或 image data URI)。 */
  readonly coverImage?: string;
  readonly path: string;
}

export interface ManagedResourceDocument extends ManagedResource {
  readonly content: string;
}

export interface ResourceScopePermission {
  readonly visible: boolean;
  readonly editable: boolean;
  readonly canPublish: boolean;
}

export interface ResourcePermissions {
  readonly company: ResourceScopePermission;
  readonly agent: ResourceScopePermission;
  readonly personal: ResourceScopePermission;
}

export interface ResourceCatalog {
  readonly skills: readonly ManagedResource[];
  readonly templates: readonly ManagedResource[];
  readonly packages: readonly ConfiguredResourcePackage[];
  /** 当前请求身份在三层资源上的有效能力。 */
  readonly permissions?: ResourcePermissions;
  /** 当前 GET 请求选中的 Agent。 */
  readonly agent?: { readonly id: string; readonly name: string };
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
  readonly title?: string;
  readonly description?: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface CreateTemplateInput {
  readonly scope: ResourceScope;
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly sourceTitle?: string;
  readonly coverImage?: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface ResourceManager {
  list(): Promise<ResourceCatalog>;
  read(
    kind: ManagedResourceKind,
    scope: ResourceScope,
    name: string,
  ): Promise<ManagedResourceDocument>;
  createSkill(input: CreateSkillInput): Promise<ManagedResource>;
  createTemplate(input: CreateTemplateInput): Promise<ManagedResource>;
  remove(kind: ManagedResourceKind, scope: ResourceScope, name: string): Promise<void>;
  installPackage(scope: ResourceScope, source: string): Promise<void>;
  removePackage(scope: ResourceScope, source: string): Promise<boolean>;
}
