/**
 * 统一插件解析器(spec: plugin-system-unification,Req 1.2/1.3/1.4/2.1/4.1)。
 *
 * 清单优先,无清单回退既有目录约定:
 *  - 有 `pi-plugin.json` → 据其合成描述符,并对声明的资源路径做存在性校验(缺失移入 diagnostics);
 *  - 无清单 → 回退:扫包根 `extensions/`/`skills/`/`prompts/`/`themes/`(DefaultPackageManager
 *    origin:"package" 约定) + 探测 `.pi/web/dist`;id/version 取 package.json。
 *
 * 绝不抛错使整包失败(Req 1.4):非法清单/缺失产物降级为 diagnostics,合法部分仍生效。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  PluginManifestSchema,
  PLUGIN_MANIFEST_FILENAME,
  type PluginManifest,
} from "@blksails/pi-web-protocol";
import type { PluginDescriptor } from "./plugin.types.js";

const PI_RESOURCE_DIRS = ["extensions", "skills", "prompts", "themes"] as const;
type PiResourceDir = (typeof PI_RESOURCE_DIRS)[number];
/** webext 产物默认目录(相对包根)。 */
const DEFAULT_WEBEXT_DIST = path.join(".pi", "web", "dist");

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(
  packageDir: string,
): Promise<{ name?: string; version?: string } | undefined> {
  try {
    const raw = await fs.readFile(path.join(packageDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    return {
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
    };
  } catch {
    return undefined;
  }
}

async function readManifest(
  packageDir: string,
  diagnostics: string[],
): Promise<PluginManifest | undefined> {
  const manifestPath = path.join(packageDir, PLUGIN_MANIFEST_FILENAME);
  if (!(await pathExists(manifestPath))) return undefined;
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    diagnostics.push(`${PLUGIN_MANIFEST_FILENAME} 读取失败`);
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    diagnostics.push(`${PLUGIN_MANIFEST_FILENAME} 不是合法 JSON`);
    return undefined;
  }
  const parsed = PluginManifestSchema.safeParse(json);
  if (!parsed.success) {
    diagnostics.push(
      `${PLUGIN_MANIFEST_FILENAME} 校验失败: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return undefined;
  }
  return parsed.data;
}

/** 校验声明的 pi 资源路径存在,缺失移入 diagnostics(Req 1.4)。 */
async function validateDeclaredPaths(
  packageDir: string,
  kind: PiResourceDir,
  declared: readonly string[] | undefined,
  diagnostics: string[],
): Promise<string[]> {
  if (declared === undefined) return [];
  const kept: string[] = [];
  for (const rel of declared) {
    if (await pathExists(path.join(packageDir, rel))) kept.push(rel);
    else diagnostics.push(`声明的 ${kind} 路径不存在,已忽略: ${rel}`);
  }
  return kept;
}

/** 回退:扫默认资源目录,存在即纳入(Req 1.3)。 */
async function scanDefaultDirs(
  packageDir: string,
  kind: PiResourceDir,
): Promise<string[]> {
  return (await pathExists(path.join(packageDir, kind))) ? [kind] : [];
}

/**
 * 把包目录解析为统一 `PluginDescriptor`。清单优先,无清单回退目录约定。
 * @param packageDir 包根绝对路径(或可解析的相对路径)。
 */
export async function resolvePiPlugin(
  packageDir: string,
): Promise<PluginDescriptor> {
  const diagnostics: string[] = [];
  const manifest = await readManifest(packageDir, diagnostics);

  // id / version:清单优先,回退 package.json,再回退目录名 / "0.0.0"。
  const pkg =
    manifest?.id !== undefined && manifest.version !== undefined
      ? undefined
      : await readPackageJson(packageDir);
  const id = manifest?.id ?? pkg?.name ?? path.basename(path.resolve(packageDir));
  const version = manifest?.version ?? pkg?.version ?? "0.0.0";

  // 第一层 pi 资源。
  const pi = {
    extensions: [] as string[],
    skills: [] as string[],
    prompts: [] as string[],
    themes: [] as string[],
  };
  for (const kind of PI_RESOURCE_DIRS) {
    pi[kind] =
      manifest?.pi !== undefined
        ? await validateDeclaredPaths(packageDir, kind, manifest.pi[kind], diagnostics)
        : await scanDefaultDirs(packageDir, kind);
  }

  // 第二层 webext:仅在 <dist>/manifest.json 存在时给出。
  let web: { dist: string } | undefined;
  const declaredDist = manifest?.web?.dist;
  if (declaredDist !== undefined) {
    if (await pathExists(path.join(packageDir, declaredDist, "manifest.json"))) {
      web = { dist: declaredDist };
    } else {
      diagnostics.push(
        `声明了 web.dist 但 ${declaredDist}/manifest.json 缺失,已忽略 webext`,
      );
    }
  } else if (
    await pathExists(path.join(packageDir, DEFAULT_WEBEXT_DIST, "manifest.json"))
  ) {
    web = { dist: DEFAULT_WEBEXT_DIST };
  }

  const bindings =
    manifest?.bindings?.tools !== undefined
      ? { tools: manifest.bindings.tools }
      : undefined;

  // web.commands:与 dist 解耦(插件可只声明 web 可见命令而不带 webext bundle)。
  const webCommands = manifest?.web?.commands ?? [];

  return {
    id,
    version,
    ...(manifest?.displayName !== undefined ? { displayName: manifest.displayName } : {}),
    ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
    pi,
    ...(web !== undefined ? { web } : {}),
    webCommands,
    ...(bindings !== undefined ? { bindings } : {}),
    diagnostics,
  };
}
