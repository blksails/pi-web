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
import type {
  AgentContext,
  AgentDefinition,
  AgentRouteHandler,
} from "./agent-definition.js";
import { createJiti } from "jiti";
import type { CreateAgentSessionRuntimeFactory } from "@earendil-works/pi-coding-agent";
import type { AgentRouteMethod, SlashCompletionDecl } from "@blksails/pi-web-protocol";
import { buildRuntimeFactory } from "./option-mapper.js";
import type { SystemResourceOverrides } from "./option-mapper.js";
import type { ResolveProjectTrust } from "./project-trust.js";

/**
 * 归一化后的单条 agent route 声明(spec agent-declared-routes)。
 *
 * 与作者声明面(`AgentRouteDecl`)的差别:`methods` 已补缺省(`["GET"]`)且必填。
 * 纯数据投影(name/methods/description)与 protocol 的 `AgentRouteDeclDto` 一致;
 * `handler` 仅存活于子进程内(归一化发生在子进程,函数不过进程边界——下游
 * wiring 消费 handler,装配期声明帧只取纯数据投影)。
 */
export interface NormalizedAgentRouteDecl {
  readonly name: string;
  readonly methods: readonly AgentRouteMethod[];
  readonly description?: string;
  readonly handler: AgentRouteHandler;
}

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

/** route 名称格式(Req 1.2):小写字母/数字开头,仅含小写字母/数字/连字符。 */
const ROUTE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** route 允许的 HTTP 方法白名单(Req 1.2)。 */
const ALLOWED_ROUTE_METHODS: ReadonlySet<string> = new Set(["GET", "POST"]);

/**
 * 权威校验并归一化 `AgentDefinition.routes`(spec agent-declared-routes,Req 1.2/1.3)。
 *
 * 规则:名称匹配 {@link ROUTE_NAME_PATTERN}、同一定义内唯一、methods ⊆ {GET, POST}
 * 且非空(空集合的 route 永不可达,视为声明错误而非静默忽略)、handler 必须是函数
 * (归一化产物携带 handler 引用,下游 wiring 依赖);`methods` 缺省补 `["GET"]`。
 *
 * 非法声明抛 {@link InvalidAgentDefinitionError},消息含 route 名称与失败原因
 * (→ runner 启动失败 → 会话创建失败,而非静默忽略)。无声明返回空数组。
 */
function normalizeAgentRoutes(
  routes: AgentDefinition["routes"],
  agentPath: string,
): readonly NormalizedAgentRouteDecl[] {
  if (routes === undefined) {
    return [];
  }
  const fail = (routeName: unknown, reason: string): never => {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid routes declaration: route ${JSON.stringify(routeName)}: ${reason}`,
    );
  };
  if (!Array.isArray(routes)) {
    throw new InvalidAgentDefinitionError(
      agentPath,
      `invalid routes declaration: "routes" must be an array (got ${typeof routes})`,
    );
  }

  const seen = new Set<string>();
  return routes.map((decl, index): NormalizedAgentRouteDecl => {
    if (typeof decl !== "object" || decl === null) {
      return fail(index, `declaration at index ${index} must be an object (got ${decl === null ? "null" : typeof decl})`);
    }
    const { name, methods, description, handler } = decl;

    if (typeof name !== "string" || !ROUTE_NAME_PATTERN.test(name)) {
      return fail(
        name ?? index,
        "name must be a non-empty string matching ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits and hyphens, starting with a letter or digit)",
      );
    }
    if (seen.has(name)) {
      return fail(name, "duplicate route name within one agent definition");
    }
    seen.add(name);

    let normalizedMethods: readonly AgentRouteMethod[];
    if (methods === undefined) {
      normalizedMethods = ["GET"];
    } else {
      if (!Array.isArray(methods) || methods.length === 0) {
        return fail(name, 'methods must be a non-empty array of "GET" / "POST" (omit the field to default to ["GET"])');
      }
      for (const method of methods) {
        if (typeof method !== "string" || !ALLOWED_ROUTE_METHODS.has(method)) {
          return fail(name, `method ${JSON.stringify(method)} is not allowed (allowed methods: GET, POST)`);
        }
      }
      normalizedMethods = [...new Set(methods)];
    }

    if (typeof handler !== "function") {
      return fail(name, `handler must be a function (got ${handler === null ? "null" : typeof handler})`);
    }

    return {
      name,
      methods: normalizedMethods,
      ...(description !== undefined ? { description } : {}),
      handler,
    };
  });
}

/**
 * Map a definition (shapes a/b) to a runtime factory and attach the
 * normalized routes when — and only when — the definition declares any
 * (no declaration → the factory is field-by-field identical to the status
 * quo, Req 1.1). Invalid declarations throw before the factory is built.
 */
function buildFactoryWithRoutes(
  def: AgentDefinition,
  agentPath: string,
  trust: ResolveProjectTrust,
  systemResources: SystemResourceOverrides,
): NormalizedAgentRuntimeFactory {
  const routes = normalizeAgentRoutes(def.routes, agentPath);
  const factory: NormalizedAgentRuntimeFactory = buildRuntimeFactory(
    def,
    trust,
    systemResources,
  );
  if (routes.length > 0) {
    factory.routes = routes;
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
 * Build jiti `alias` entries so a user entry can `import` the pi SDK (and,
 * optionally, `@blksails/pi-web-agent-kit`) regardless of where the entry file lives.
 *
 * The runner's location can resolve these packages (they are workspace deps of
 * `@blksails/pi-web-server`); a user `examples/` file generally cannot. Aliasing maps
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
    // Subpath exports need explicit aliases: jiti's alias does *prefix*
    // substitution, so `@earendil-works/pi-ai/compat` would become
    // `<piAiDir>/compat` — a path that does not exist (the file lives under
    // `dist/`), and the package's own `exports` map is never consulted for the
    // rewritten specifier. Worse, `pi-ai`'s `exports["./compat"]` declares only
    // an `import` condition, so even an unaliased CJS `require` would fail.
    // Map the subpath straight at its built file. Without this, any agent entry
    // that (transitively) imports `@earendil-works/pi-ai/compat` — e.g. via
    // tool-kit's `visionExtension` — dies with
    // `Cannot find module .../pi-ai/compat` at runner boot.
    const piAiDir = join(realScope, "pi-ai");
    const compatFile = join(piAiDir, "dist", "compat.js");
    if (existsSync(compatFile)) {
      alias["@earendil-works/pi-ai/compat"] = compatFile;
    }
  }
  // `@blksails/pi-web-agent-kit` is a types-only workspace package that may not be a
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
    alias["@blksails/pi-web-agent-kit"] = join(kitDir, "src", "index.ts");
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
