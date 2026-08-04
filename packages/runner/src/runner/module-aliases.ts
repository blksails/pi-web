/**
 * module-aliases — 为 jiti 装载用户 agent 入口构造 `alias` 映射。
 *
 * 自 `agent-loader.ts` 原样析出(SRP:载入/归一化 与 **模块解析** 是两件事)。
 * 行为逐字保持;`agent-loader.ts` 继续 re-export `buildResolutionAliases`。
 *
 * 关注点:用户入口文件可能位于任何目录(examples/、用户工程、沙箱镜像内),它自己
 * **解析不到** pi SDK 与 workspace packages;而 runner 所在位置可以。本模块把裸 specifier
 * 映射到从这里可解析的绝对路径。
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build jiti `alias` entries so a user entry can import pi-web workspace packages
 * regardless of where the entry file lives. External agents do not have the
 * monorepo's `node_modules` ancestry, so relying on normal package resolution
 * makes them exit before sending `runner_ready`.
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
  // Workspace packages may be absent from an external agent's node_modules.
  // Locate their source directories directly so example/user entries authored
  // with `defineAgent` resolve regardless of location.
  const workspacePackages: ReadonlyArray<readonly [string, string]> = [
    ["@blksails/pi-web-agent-kit", "agent-kit/src/index.ts"],
    ["@blksails/pi-web-canvas-kit", "canvas-kit/src/index.ts"],
    ["@blksails/pi-web-canvas-ui", "canvas-ui/src/index.ts"],
    ["@blksails/pi-web-canvas-ui/pane", "canvas-ui/src/pane.ts"],
    ["@blksails/pi-web-logger", "logger/src/index.ts"],
    ["@blksails/pi-web-panes-kit", "panes-kit/src/index.ts"],
    ["@blksails/pi-web-panes-kit/contract", "panes-kit/src/contract.ts"],
    [
      "@blksails/pi-web-panes-kit/workspace-protocol",
      "panes-kit/src/workspace-protocol.ts",
    ],
    ["@blksails/pi-web-panes-kit/react", "panes-kit/src/react/index.ts"],
    ["@blksails/pi-web-primitives", "primitives/src/index.ts"],
    ["@blksails/pi-web-protocol", "protocol/src/index.ts"],
    ["@blksails/pi-web-tool-kit", "tool-kit/src/index.ts"],
    ["@blksails/pi-web-tool-kit/runtime", "tool-kit/src/runtime.ts"],
    [
      "@blksails/pi-web-tool-kit/aigc-canvas-schema",
      "tool-kit/src/aigc/canvas/schema.ts",
    ],
    ["@blksails/pi-web-tool-kit/commands", "tool-kit/src/commands/index.ts"],
    ["@blksails/pi-web-tool-kit/extension-entry", "tool-kit/src/extension-tools/entry-path.ts"],
    ["@blksails/pi-web-tool-kit/auto-title-entry", "tool-kit/src/auto-title/entry-path.ts"],
    ["@blksails/pi-web-tool-kit/mcp-entry", "tool-kit/src/mcp/entry-path.ts"],
    ["@blksails/pi-web-kit", "web-kit/src/index.ts"],
  ];
  for (const [specifier, relativeEntry] of workspacePackages) {
    const packageDir = locateWorkspacePackageDir(
      join("packages", relativeEntry.split("/")[0]!),
      fileURLToPath(import.meta.url),
    );
    if (packageDir === undefined) continue;
    const entry = join(packageDir, ...relativeEntry.split("/").slice(1));
    if (existsSync(entry)) alias[specifier] = entry;
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
