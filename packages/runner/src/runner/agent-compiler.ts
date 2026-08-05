/**
 * Agent source → cached ESM bundle。
 *
 * 首次启动只编译一次；后续按 agent 源内容哈希直接载入缓存。开发热重载仍由
 * core watcher 决定何时重启，故编辑过程中不会实时触发编译。
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CODE_EXTENSIONS = new Set([".cjs", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set([".cache", ".git", "dist", "node_modules"]);
const BUNDLE_EXTERNALS = ["@blksails/*", "@earendil-works/*", "node:*"];

export interface PreparedAgentEntry {
  readonly path: string;
  readonly compiled: boolean;
  readonly cacheHit: boolean;
  readonly reason?: string;
}

interface CompileOptions {
  readonly cacheDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

function sourceFiles(root: string, excludedRoot?: string): string[] {
  const files: string[] = [];
  const excluded = excludedRoot === undefined ? undefined : path.resolve(excludedRoot);
  const walk = (dir: string): void => {
    if (excluded !== undefined && (dir === excluded || dir.startsWith(`${excluded}${path.sep}`))) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      const file = path.join(dir, entry.name);
      if (CODE_EXTENSIONS.has(path.extname(entry.name)) || entry.name === "package.json") {
        files.push(file);
      }
    }
  };
  walk(root);
  return files.sort();
}

function sourceHash(root: string, entryPath: string, excludedRoot?: string): string {
  const hash = createHash("sha256");
  const files = sourceFiles(root, excludedRoot);
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  if (!files.includes(entryPath)) {
    hash.update(path.resolve(entryPath));
    hash.update("\0");
    hash.update(readFileSync(entryPath));
  }
  return hash.digest("hex").slice(0, 24);
}

function defaultCacheDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env.PI_WEB_AGENT_COMPILE_CACHE_DIR?.trim();
  return configured === undefined || configured === ""
    ? path.join(homeDir, ".pi-web", "cache", "agent-bundles")
    : path.resolve(configured);
}

/**
 * Prepare a custom agent entry without executing user code in the host.
 * Compile errors deliberately fall back to the existing jiti path.
 */
export async function prepareAgentEntry(
  entryPath: string,
  sourceRoot: string,
  options: CompileOptions = {},
): Promise<PreparedAgentEntry> {
  const env = options.env ?? process.env;
  if (env.PI_WEB_AGENT_PRECOMPILE === "0") {
    return { path: entryPath, compiled: false, cacheHit: false, reason: "disabled" };
  }

  try {
    const root = path.resolve(sourceRoot);
    const entry = path.resolve(entryPath);
    const cacheDir = options.cacheDir ?? defaultCacheDir(env, options.homeDir ?? homedir());
    const key = sourceHash(root, entry, cacheDir);
    const outputDir = path.join(cacheDir, key);
    const output = path.join(outputDir, "index.mjs");
    if (existsSync(output)) return { path: output, compiled: true, cacheHit: true };

    mkdirSync(outputDir, { recursive: true });
    const temporary = path.join(outputDir, `index.${process.pid}.${randomUUID()}.mjs`);
    const esbuild = await import("esbuild");
    await esbuild.build({
      bundle: true,
      entryPoints: [entry],
      external: BUNDLE_EXTERNALS,
      format: "esm",
      logLevel: "silent",
      outfile: temporary,
      platform: "node",
      target: "node22",
    });
    try {
      renameSync(temporary, output);
    } catch {
      // Another session may have won the same content-addressed build race.
    }
    return existsSync(output)
      ? { path: output, compiled: true, cacheHit: false }
      : { path: entryPath, compiled: false, cacheHit: false, reason: "cache-write-failed" };
  } catch (error) {
    return {
      path: entryPath,
      compiled: false,
      cacheHit: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
