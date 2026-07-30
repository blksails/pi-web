/**
 * module-aliases — 为 jiti 装载用户 agent 入口构造 `alias` 映射。
 *
 * 自 `agent-loader.ts` 原样析出(SRP:载入/归一化 与 **模块解析** 是两件事)。
 * 行为逐字保持;`agent-loader.ts` 继续 re-export `buildResolutionAliases`。
 *
 * 关注点:用户入口文件可能位于任何目录(examples/、用户工程、沙箱镜像内),它自己
 * **解析不到** pi SDK 与 agent-kit;而 runner 所在位置可以。本模块把裸 specifier
 * 映射到从这里可解析的绝对路径。
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
