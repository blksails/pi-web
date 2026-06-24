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
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentContext, AgentDefinition } from "./agent-definition.js";
import { createJiti } from "jiti";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
import { buildRuntimeFactory } from "./option-mapper.js";
import type { SystemResourceOverrides } from "./option-mapper.js";
import type { ResolveProjectTrust } from "./project-trust.js";

/** Normalized internal representation shared by all three shapes. */
export type NormalizedAgentRuntimeFactory = CreateAgentSessionRuntimeFactory;

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

/** Thrown when a user entry's default export cannot be normalized. */
export class InvalidAgentDefinitionError extends Error {
  constructor(
    public readonly agentPath: string,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid agent definition at "${agentPath}": ${reason}`, options);
    this.name = "InvalidAgentDefinitionError";
  }
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
 * Build jiti `alias` entries so a user entry can `import` the pi SDK (and,
 * optionally, `@blksails/agent-kit`) regardless of where the entry file lives.
 *
 * The runner's location can resolve these packages (they are workspace deps of
 * `@blksails/server`); a user `examples/` file generally cannot. Aliasing maps
 * the bare specifiers to absolute package locations resolvable from here.
 */
export function buildResolutionAliases(): Record<string, string> {
  const alias: Record<string, string> = {};
  // pi's `exports` map blocks resolving `package.json`, so walk node_modules
  // from the runner upward to find the package directory, then alias the bare
  // specifier to it (jiti honours the package's own `exports`).
  const piDir = locatePackageDir(
    "@earendil-works/pi-coding-agent",
    fileURLToPath(import.meta.url),
  );
  if (piDir !== undefined) {
    alias["@earendil-works/pi-coding-agent"] = piDir;
    // pi-ai/pi-agent-core are nested next to pi-coding-agent in its real (pnpm)
    // node_modules. Alias them too so user entries may import e.g. `Type`.
    const realScope = dirname(realpathSync(piDir));
    for (const sibling of ["pi-ai", "pi-agent-core", "pi-tui"]) {
      const dir = join(realScope, sibling);
      if (existsSync(join(dir, "package.json"))) {
        alias[`@earendil-works/${sibling}`] = dir;
      }
    }
  }
  // `@blksails/agent-kit` is a types-only workspace package that may not be a
  // declared dependency of the runner (so it is not symlinked into
  // node_modules). Locate the workspace package directory directly so example/
  // user entries authored with `defineAgent` resolve regardless of location.
  const kitDir = locateWorkspacePackageDir(
    join("packages", "agent-kit"),
    fileURLToPath(import.meta.url),
  );
  if (kitDir !== undefined) {
    // Alias to the entry source file directly (agent-kit's `exports` maps "."
    // → "./src/index.ts"); jiti loads the TS entry without package resolution.
    alias["@blksails/agent-kit"] = join(kitDir, "src", "index.ts");
  }

  return alias;
}

/** Walk upward from `fromPath` for a `relDir` containing a `package.json`. */
function locateWorkspacePackageDir(
  relDir: string,
  fromPath: string,
): string | undefined {
  let dir = dirname(fromPath);
  for (;;) {
    const candidate = join(dir, relDir);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Walk `node_modules` directories upward from `fromPath` to find `spec`. */
function locatePackageDir(spec: string, fromPath: string): string | undefined {
  let dir = dirname(fromPath);
  for (;;) {
    const candidate = join(dir, "node_modules", spec);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
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
): Promise<NormalizedAgentRuntimeFactory> {
  const jiti = createJiti(import.meta.url, { alias: buildResolutionAliases() });

  let mod: unknown;
  try {
    mod = await jiti.import(agentPath);
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
    return buildRuntimeFactory(produced, trust, systemResources);
  }

  // Shape (a): a definition object.
  if (isDefinitionObject(def)) {
    return buildRuntimeFactory(def, trust, systemResources);
  }

  throw new InvalidAgentDefinitionError(
    agentPath,
    `default export is neither a definition object nor a function (got ${typeof def})`,
  );
}
