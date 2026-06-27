/**
 * AgentDefinition → pi SDK option mapping.
 *
 * Splits an {@link AgentDefinition} into:
 *  - resource-class fields → `createAgentSessionServices` `resourceLoaderOptions`
 *    (systemPrompt / extension paths + factories / skills / prompts / contextFiles)
 *  - session-class fields → `createAgentSessionFromServices` inputs
 *    (model / thinkingLevel / scopedModels / tools / excludeTools / noTools / customTools)
 *
 * and assembles a `CreateAgentSessionRuntimeFactory`. Optional fields that are
 * absent are never injected, preserving pi's default discovery behaviour.
 */
import { basename, extname } from "node:path";
import type { AgentDefinition, AgentModel } from "./agent-definition.js";
import {
  type AgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  type CreateAgentSessionFromServicesOptions,
  type ExtensionFactory,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { ResolveProjectTrust } from "./project-trust.js";

type ResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions["resourceLoaderOptions"]
>;

type SessionModel = NonNullable<CreateAgentSessionFromServicesOptions["model"]>;

/** The SDK `LoadExtensionsResult` — the `base` type passed to `extensionsOverride`. */
type LoadExtensionsResult = Parameters<
  NonNullable<ResourceLoaderOptions["extensionsOverride"]>
>[0];
/** A single loaded extension as carried by `LoadExtensionsResult.extensions`. */
type LoadedExtension = LoadExtensionsResult["extensions"][number];

/**
 * Derive an extension's name from its `path`: the basename without extension.
 * Compared against `allowExtensions` entries. Kept as a small in-file helper to
 * ease unit testing and calibration against real extension samples.
 */
function extensionName(ext: LoadedExtension): string {
  return basename(ext.path, extname(ext.path));
}

/**
 * Result of mapping the resource-class fields of an {@link AgentDefinition}.
 * Exposed for unit testing the mapping in isolation.
 */
export interface MappedResourceLoaderOptions {
  resourceLoaderOptions: ResourceLoaderOptions;
}

/**
 * pi-web「扩展 → 系统资源」面板开关,由 runner `--no-skills`/`--no-extensions` 透传至此。
 * `true` = 关闭(不载入);`undefined` = 默认载入。二者相互独立。
 */
export interface SystemResourceOverrides {
  readonly noSkills?: boolean;
  readonly noExtensions?: boolean;
}

/**
 * Result of mapping the session-class fields of an {@link AgentDefinition}.
 * Models are intentionally left unresolved here (still `AgentModel`); the
 * factory resolves `{ provider, modelId }` refs against the registry once
 * services exist. Exposed for unit testing.
 */
export interface MappedSessionFields {
  model?: AgentModel;
  thinkingLevel?: AgentDefinition["thinkingLevel"];
  scopedModels?: AgentDefinition["scopedModels"];
  tools?: string[];
  excludeTools?: string[];
  noTools?: AgentDefinition["noTools"];
  customTools?: CreateAgentSessionFromServicesOptions["customTools"];
}

/** True when `m` is a lightweight `{ provider, modelId }` reference. */
export function isModelRef(
  m: AgentModel,
): m is { provider: string; modelId: string } {
  // A fully-resolved pi Model carries an `api` discriminator; the lightweight
  // ref has only `provider` + `modelId`.
  return !("api" in m);
}

/**
 * Map the resource-class fields of a definition to `resourceLoaderOptions`,
 * binding the trust hook via `resourceLoaderReloadOptions` is handled by the
 * caller (the factory). Absent fields are omitted entirely.
 */
export function mapResourceLoaderOptions(
  def: AgentDefinition,
  opts: {
    forcedExtensionPaths?: readonly string[];
    /** 系统资源开关 `--no-skills`:`true` → 清空 skills 覆盖(优先于 `def.skills`)。 */
    noSkills?: boolean;
    /** 系统资源开关 `--no-extensions`:`true` → `noExtensions=true`(强制注入路径仍载入)。 */
    noExtensions?: boolean;
  } = {},
): MappedResourceLoaderOptions {
  const resourceLoaderOptions: ResourceLoaderOptions = {};
  // 强制注入路径(如 pi-sandbox):不论 agent 的 extensions/allowExtensions 如何,
  // 始终随会话加载。SDK 在 noExtensions 下仍加载 additionalExtensionPaths;whitelist
  // (extensionsOverride)分支须额外放行其 basename(见下)。
  const forced = (opts.forcedExtensionPaths ?? []).filter((p) => p.length > 0);
  const forcedBasenames = new Set(forced.map((p) => basename(p)));

  if (def.systemPrompt !== undefined) {
    const prompt =
      typeof def.systemPrompt === "function" ? def.systemPrompt() : def.systemPrompt;
    // The resource loader applies the override on top of any discovered prompt.
    resourceLoaderOptions.systemPromptOverride = () => prompt;
  }

  const additionalPaths: string[] = [...forced];
  if (def.extensions !== undefined) {
    const factories: ExtensionFactory[] = [];
    for (const item of def.extensions) {
      if (typeof item === "string") {
        additionalPaths.push(item);
      } else {
        factories.push(item);
      }
    }
    if (factories.length > 0) {
      resourceLoaderOptions.extensionFactories = factories;
    }
  }
  if (additionalPaths.length > 0) {
    resourceLoaderOptions.additionalExtensionPaths = additionalPaths;
  }

  // allowExtensions: close-all / whitelist semantics for disk-discovered system
  // extensions. Absent → not injected (SDK default discovery preserved).
  //
  // KNOWN LIMITATION (research.md R-1): a NON-EMPTY allowExtensions still loads
  // every discovered extension first, then filters via `extensionsOverride` — so
  // a closed extension's module code runs once before being dropped. For strong
  // isolation (discovery skipped entirely, no closed-extension code executed),
  // use `allowExtensions: []`, which maps to `noExtensions = true`.
  if (def.allowExtensions !== undefined) {
    const allow = new Set(def.allowExtensions);
    if (allow.size === 0) {
      // Close all: skip discovery; closed-extension code never runs. Explicitly
      // appended items are still preserved by the SDK.
      resourceLoaderOptions.noExtensions = true;
    } else {
      // Whitelist: discover, then keep named extensions + explicitly appended ones.
      const explicitPaths = new Set(
        (def.extensions ?? [])
          .filter((e): e is string => typeof e === "string")
          .map((p) => basename(p)),
      );
      resourceLoaderOptions.extensionsOverride = (base) => ({
        // `...base` preserves `errors` and `runtime` untouched.
        ...base,
        extensions: base.extensions.filter((ext) => {
          if (ext.path.startsWith("<inline:")) return true; // factory-appended item
          if (forcedBasenames.has(basename(ext.path))) return true; // 强制注入(沙箱)豁免白名单
          if (explicitPaths.has(basename(ext.path))) return true; // string-path appended item
          return allow.has(extensionName(ext)); // named whitelist
        }),
      });
    }
  }

  if (def.skills !== undefined) {
    resourceLoaderOptions.skillsOverride = def.skills;
  }
  if (def.promptTemplates !== undefined) {
    resourceLoaderOptions.promptsOverride = def.promptTemplates;
  }
  if (def.contextFiles !== undefined) {
    resourceLoaderOptions.agentsFilesOverride = def.contextFiles;
  }

  // 系统资源开关(pi-web「扩展 → 系统资源」面板,经 runner `--no-skills`/`--no-extensions`)。
  // 置于 def.* 映射之后,使「关闭」无条件优先于 agent 自声明(对齐 pi CLI 行为)。
  if (opts.noSkills === true) {
    // 清空 skills 覆盖:返回空集(保留 diagnostics)。优先于 def.skills(Req 1.4)。
    resourceLoaderOptions.skillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics });
  }
  if (opts.noExtensions === true) {
    // 跳过磁盘发现的系统/包 extensions;additionalExtensionPaths(强制注入的沙箱)仍由
    // SDK 加载,沙箱安全门不破(Req 2.3)。白名单 extensionsOverride 在「全关」下无意义,清除。
    resourceLoaderOptions.noExtensions = true;
    delete resourceLoaderOptions.extensionsOverride;
  }

  return { resourceLoaderOptions };
}

/**
 * Map the session-class fields of a definition. Absent fields are omitted so
 * the SDK keeps its defaults. Models stay as {@link AgentModel} (resolved
 * later, against the registry).
 */
export function mapSessionFields(def: AgentDefinition): MappedSessionFields {
  const out: MappedSessionFields = {};
  if (def.model !== undefined) out.model = def.model;
  if (def.thinkingLevel !== undefined) out.thinkingLevel = def.thinkingLevel;
  if (def.scopedModels !== undefined) out.scopedModels = def.scopedModels;
  if (def.tools !== undefined) out.tools = def.tools;
  if (def.excludeTools !== undefined) out.excludeTools = def.excludeTools;
  if (def.noTools !== undefined) out.noTools = def.noTools;
  if (def.customTools !== undefined) out.customTools = def.customTools;
  return out;
}

/** Resolve an {@link AgentModel} to a concrete pi Model via the registry. */
function resolveModel(model: AgentModel, registry: ModelRegistry): SessionModel {
  if (!isModelRef(model)) {
    return model as SessionModel;
  }
  const found = registry.find(model.provider, model.modelId);
  if (found === undefined) {
    throw new Error(
      `Model not found in registry: provider="${model.provider}" modelId="${model.modelId}"`,
    );
  }
  return found as SessionModel;
}

/**
 * Build a `CreateAgentSessionRuntimeFactory` from a normalized definition.
 *
 * The factory, when invoked by `createAgentSessionRuntime`, creates cwd-bound
 * services (wiring `resolveProjectTrust`), resolves model refs against the
 * registry, creates the session from services, and returns the runtime result
 * including `services` and `diagnostics`.
 */
export function buildRuntimeFactory(
  def: AgentDefinition,
  trust: ResolveProjectTrust,
  systemResources: SystemResourceOverrides = {},
): CreateAgentSessionRuntimeFactory {
  // 强制注入入口经 env 由主进程下传(custom 模式);为空则不注入(行为不变)。
  //  - PI_WEB_SANDBOX_ENTRY:沙箱 enforcement(不依赖默认发现)。
  //  - PI_WEB_EXT_TOOLS_ENTRY:pi-web 内置「扩展管理扩展」(install/uninstall/list 工具 +
  //    reload-runtime 命令),对所有 agent 生效(spec extension-install-agent-tools)。
  const sandboxEntry = process.env["PI_WEB_SANDBOX_ENTRY"];
  const extToolsEntry = process.env["PI_WEB_EXT_TOOLS_ENTRY"];
  const forcedExtensionPaths = [
    ...(sandboxEntry !== undefined && sandboxEntry.length > 0 ? [sandboxEntry] : []),
    ...(extToolsEntry !== undefined && extToolsEntry.length > 0 ? [extToolsEntry] : []),
  ];
  const { resourceLoaderOptions } = mapResourceLoaderOptions(def, {
    forcedExtensionPaths,
    ...(systemResources.noSkills !== undefined ? { noSkills: systemResources.noSkills } : {}),
    ...(systemResources.noExtensions !== undefined
      ? { noExtensions: systemResources.noExtensions }
      : {}),
  });
  const session = mapSessionFields(def);

  return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const services: AgentSessionServices = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions,
      resourceLoaderReloadOptions: { resolveProjectTrust: trust },
    });

    const registry = services.modelRegistry;
    const model =
      session.model !== undefined ? resolveModel(session.model, registry) : undefined;
    const scopedModels =
      session.scopedModels !== undefined
        ? session.scopedModels.map((entry) => {
            const resolved: { model: SessionModel; thinkingLevel?: AgentDefinition["thinkingLevel"] } = {
              model: resolveModel(entry.model, registry),
            };
            if (entry.thinkingLevel !== undefined) {
              resolved.thinkingLevel = entry.thinkingLevel;
            }
            return resolved;
          })
        : undefined;

    const fromServices: CreateAgentSessionFromServicesOptions = {
      services,
      sessionManager,
    };
    if (sessionStartEvent !== undefined) fromServices.sessionStartEvent = sessionStartEvent;
    if (model !== undefined) fromServices.model = model;
    if (session.thinkingLevel !== undefined) fromServices.thinkingLevel = session.thinkingLevel;
    if (scopedModels !== undefined) fromServices.scopedModels = scopedModels;
    if (session.tools !== undefined) fromServices.tools = session.tools;
    if (session.excludeTools !== undefined) fromServices.excludeTools = session.excludeTools;
    if (session.noTools !== undefined) fromServices.noTools = session.noTools;
    if (session.customTools !== undefined) fromServices.customTools = session.customTools;

    const created = await createAgentSessionFromServices(fromServices);

    return {
      ...created,
      services,
      diagnostics: services.diagnostics,
    };
  };
}
