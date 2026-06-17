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

/**
 * Result of mapping the resource-class fields of an {@link AgentDefinition}.
 * Exposed for unit testing the mapping in isolation.
 */
export interface MappedResourceLoaderOptions {
  resourceLoaderOptions: ResourceLoaderOptions;
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
): MappedResourceLoaderOptions {
  const resourceLoaderOptions: ResourceLoaderOptions = {};

  if (def.systemPrompt !== undefined) {
    const prompt =
      typeof def.systemPrompt === "function" ? def.systemPrompt() : def.systemPrompt;
    // The resource loader applies the override on top of any discovered prompt.
    resourceLoaderOptions.systemPromptOverride = () => prompt;
  }

  if (def.extensions !== undefined) {
    const paths: string[] = [];
    const factories: ExtensionFactory[] = [];
    for (const item of def.extensions) {
      if (typeof item === "string") {
        paths.push(item);
      } else {
        factories.push(item);
      }
    }
    if (paths.length > 0) {
      resourceLoaderOptions.additionalExtensionPaths = paths;
    }
    if (factories.length > 0) {
      resourceLoaderOptions.extensionFactories = factories;
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
): CreateAgentSessionRuntimeFactory {
  const { resourceLoaderOptions } = mapResourceLoaderOptions(def);
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
