/**
 * agent-loader: jiti-import a user entry and normalize its default export into a
 * single `CreateAgentSessionRuntimeFactory`.
 *
 * Three accepted default-export shapes:
 *  - (a) an {@link AgentDefinition} object → mapped to a factory via option-mapper.
 *  - (b) a `(ctx: AgentContext) => AgentDefinition | Promise<AgentDefinition>`
 *        factory → called with `ctx`, then the result is mapped.
 *  - (c) a `CreateAgentSessionRuntimeFactory` (`createRuntime`) → used directly,
 *        no re-mapping. Distinguished from (b) by the {@link RUNTIME_FACTORY_BRAND}
 *        marker, attachable via {@link markRuntimeFactory}.
 *
 * User code runs only inside this (subprocess) loader via jiti.
 *
 * 两个关注点已析出(SRP),本文件 re-export 其公开符号以保持既有 import 面:
 *  - jiti `alias` 构造(用户入口的模块解析)→ `module-aliases.ts`
 *  - 声明字段的权威校验与归一化 → `declaration-validators.ts`
 */
import type {
  AgentAttachmentCatalogDecl,
  AgentContext,
  AgentDefinition,
} from "@blksails/pi-web-core/agent-definition.js";
import { createJiti } from "jiti";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
import type { SlashCompletionDecl } from "@blksails/pi-web-protocol";
import { buildRuntimeFactory } from "./option-mapper.js";
import type { SystemResourceOverrides } from "./option-mapper.js";
import type { ResolveProjectTrust } from "./project-trust.js";
import { buildResolutionAliases } from "./module-aliases.js";
import {
  InvalidAgentDefinitionError,
  normalizeAgentRoutes,
  normalizeAttachmentCatalog,
  normalizeAttachmentProfile,
  type NormalizedAgentRouteDecl,
} from "./declaration-validators.js";

export { buildResolutionAliases } from "./module-aliases.js";
export {
  InvalidAgentDefinitionError,
  normalizeAgentRoutes,
  normalizeAttachmentCatalog,
  normalizeAttachmentProfile,
} from "./declaration-validators.js";
export type { NormalizedAgentRouteDecl } from "./declaration-validators.js";

/** Normalized internal representation shared by all three shapes. */
export type NormalizedAgentRuntimeFactory = CreateAgentSessionRuntimeFactory & {
  /**
   * pi-web: agent 声明的静态 slash 补全候选(`AgentDefinition.slashCompletions`),
   * 经 `buildRuntimeFactory` 附加。shape (c) 自建 runtime factory 不附(为空)。
   */
  slashCompletions?: readonly SlashCompletionDecl[];
  /**
   * pi-web: agent 声明的 HTTP routes(`AgentDefinition.routes`),经装配期权威
   * 校验并归一化后附加;无声明(或空声明)时不附,归一化结果与现状逐字段一致
   * (Req 1.1)。shape (c) 自建 runtime factory 无定义对象,不附。
   */
  routes?: readonly NormalizedAgentRouteDecl[];
  /**
   * pi-web: agent 声明的附件写目标 profile 名(`AgentDefinition.attachmentProfile`,
   * spec agent-attachment-profile),经装配期**形状**校验(非空、与后端名同规字符格式)后
   * 附加;白名单校验(对照宿主拓扑)由 runner 在装配期另行执行,本字段仅形状合法性保证
   * (Req 1.1/1.3)。无声明时不附。shape (c) 自建 runtime factory 无定义对象,不附。
   */
  attachmentProfile?: string;
  /**
   * pi-web: agent 声明的动态附件目录(`AgentDefinition.attachmentCatalog`,
   * spec agent-attachment-catalog),经装配期**形状**校验(list/resolve 均为函数)后
   * 附加;未声明返回 `undefined`,与现状逐字段一致(Req 1.1)。handler 只存活于子进程,
   * 下游 catalog 桥(runner)消费,装配期声明帧只取 `available:true` 投影。
   * shape (c) 自建 runtime factory 无定义对象,不附。
   */
  attachmentCatalog?: AgentAttachmentCatalogDecl;
};

/**
 * Brand marking a function as a shape-(c) `CreateAgentSessionRuntimeFactory`,
 * so the loader can tell it apart from a shape-(b) `(ctx) => definition`.
 */
export const RUNTIME_FACTORY_BRAND = "__piRuntimeFactory" as const;

/** Attach the runtime-factory brand to a `createRuntime` factory (shape c). */
export function markRuntimeFactory(
  factory: CreateAgentSessionRuntimeFactory,
): CreateAgentSessionRuntimeFactory {
  Object.defineProperty(factory, RUNTIME_FACTORY_BRAND, {
    value: true,
    enumerable: false,
  });
  return factory;
}

function isBrandedRuntimeFactory(
  value: unknown,
): value is CreateAgentSessionRuntimeFactory {
  return (
    typeof value === "function" &&
    (value as unknown as Record<string, unknown>)[RUNTIME_FACTORY_BRAND] === true
  );
}

/**
 * Map a definition (shapes a/b) to a runtime factory and attach the
 * normalized routes / attachment profile / attachment catalog when — and
 * only when — the definition declares them (no declaration → the factory is
 * field-by-field identical to the status quo, Req 1.1). Invalid declarations
 * throw before the factory is built.
 */
function buildFactoryWithRoutes(
  def: AgentDefinition,
  agentPath: string,
  trust: ResolveProjectTrust,
  systemResources: SystemResourceOverrides,
): NormalizedAgentRuntimeFactory {
  const routes = normalizeAgentRoutes(def.routes, agentPath);
  const attachmentProfile = normalizeAttachmentProfile(
    def.attachmentProfile,
    agentPath,
  );
  const attachmentCatalog = normalizeAttachmentCatalog(
    def.attachmentCatalog,
    agentPath,
  );
  const factory: NormalizedAgentRuntimeFactory = buildRuntimeFactory(
    def,
    trust,
    systemResources,
  );
  if (routes.length > 0) {
    factory.routes = routes;
  }
  if (attachmentProfile !== undefined) {
    factory.attachmentProfile = attachmentProfile;
  }
  if (attachmentCatalog !== undefined) {
    factory.attachmentCatalog = attachmentCatalog;
  }
  return factory;
}

/**
 * A plain object that could be an {@link AgentDefinition}. We do not enforce any
 * field presence (every field is optional), only that it is a non-null,
 * non-array object.
 */
function isDefinitionObject(value: unknown): value is AgentDefinition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the default export.
 *
 * The runner targets ESM/TS user entries (`export default ...`). When jiti
 * returns a namespace object, an explicit `default` key is required: a module
 * with only named exports (no `export default`) is treated as "missing
 * default", even though jiti's interop would otherwise surface the namespace
 * as `.default`. A non-object module value is used as-is.
 */
function getDefaultExport(mod: unknown): unknown {
  if (typeof mod === "object" && mod !== null) {
    return "default" in mod ? (mod as { default: unknown }).default : undefined;
  }
  return mod;
}

/**
 * Load a user agent entry and normalize it into a single runtime factory.
 *
 * @param agentPath Absolute or jiti-resolvable path to the user entry module.
 * @param ctx       Context handed to shape-(b) factories.
 * @param trust     Trust hook wired into the resource loader for shapes a/b.
 * @param systemResources 「扩展 → 系统资源」开关(`--no-skills`/`--no-extensions`),
 *        应用于 shape (a)/(b)。shape (c) 自建运行时,不适用(作者自负资源载入)。
 */
export async function loadAgentDefinition(
  agentPath: string,
  ctx: AgentContext,
  trust: ResolveProjectTrust,
  systemResources: SystemResourceOverrides = {},
  importPath = agentPath,
): Promise<NormalizedAgentRuntimeFactory> {
  const jiti = createJiti(import.meta.url, { alias: buildResolutionAliases() });

  let mod: unknown;
  try {
    mod = await jiti.import(importPath);
  } catch (error) {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `failed to import module (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }

  const def = getDefaultExport(mod);

  if (def === undefined || def === null) {
    throw new InvalidAgentDefinitionError(
      agentPath,
      "module has no default export (expected an AgentDefinition object, a (ctx) => AgentDefinition factory, or a marked CreateAgentSessionRuntimeFactory)",
    );
  }

  // Shape (c): a branded createRuntime factory — used directly, no re-mapping.
  if (isBrandedRuntimeFactory(def)) {
    return def;
  }

  // Shape (b): a (ctx) => AgentDefinition | Promise<AgentDefinition> factory.
  if (typeof def === "function") {
    let produced: unknown;
    try {
      produced = await (def as (c: AgentContext) => unknown)(ctx);
    } catch (error) {
      throw new InvalidAgentDefinitionError(
        agentPath,
        `factory function threw (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }
    if (!isDefinitionObject(produced)) {
      throw new InvalidAgentDefinitionError(
        agentPath,
        `factory function returned a non-definition value (got ${produced === null ? "null" : typeof produced})`,
      );
    }
    return buildFactoryWithRoutes(produced, agentPath, trust, systemResources);
  }

  // Shape (a): a definition object.
  if (isDefinitionObject(def)) {
    return buildFactoryWithRoutes(def, agentPath, trust, systemResources);
  }

  throw new InvalidAgentDefinitionError(
    agentPath,
    `default export is neither a definition object nor a function (got ${typeof def})`,
  );
}
