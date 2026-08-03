/**
 * 统一插件解析器(spec: plugin-system-unification,Req 1.2/1.3/1.4/2.1/4.1)。
 *
 * 清单优先,无清单回退既有目录约定:
 *  - 有 `pi-web.json` → 据其合成描述符,并对声明的资源路径做存在性校验(缺失移入 diagnostics);
 *  - 无清单 → 回退:扫包根 `extensions/`/`skills/`/`prompts/`/`themes/`(DefaultPackageManager
 *    origin:"package" 约定) + 探测 `.pi/web/dist`;id/version 取 package.json。
 *
 * 绝不抛错使整包失败(Req 1.4):非法清单/缺失产物降级为 diagnostics,合法部分仍生效。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  PiWebManifestSchema,
  PI_WEB_MANIFEST_FILENAME,
  DEFAULT_WEBEXT_DIST,
  type PiWebManifest,
} from "@blksails/pi-web-protocol";
import type { PluginDescriptor } from "./plugin.types.js";

const PI_RESOURCE_DIRS = ["extensions", "skills", "prompts", "themes"] as const;
type PiResourceDir = (typeof PI_RESOURCE_DIRS)[number];
/** webext 产物默认目录(相对包根)。 */
// DEFAULT_WEBEXT_DIST 已上移至 @blksails/pi-web-protocol(单一真源:运行时与发布期同值)。
// 原本此处是 `path.join(".pi","web","dist")`,与发布期各存一份字面量 —— 正是 #29 的成因之一。

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
): Promise<PiWebManifest | undefined> {
  const manifestPath = path.join(packageDir, PI_WEB_MANIFEST_FILENAME);
  if (!(await pathExists(manifestPath))) return undefined;
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    diagnostics.push(`${PI_WEB_MANIFEST_FILENAME} 读取失败`);
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    diagnostics.push(`${PI_WEB_MANIFEST_FILENAME} 不是合法 JSON`);
    return undefined;
  }
  const parsed = PiWebManifestSchema.safeParse(json);
  if (!parsed.success) {
    diagnostics.push(
      `${PI_WEB_MANIFEST_FILENAME} 校验失败: ${parsed.error.issues
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

/** settings 段声明时的默认 schema 相对路径(无清单回退探测用)。 */
const DEFAULT_SETTINGS_SCHEMA_PATH = path.join("settings", "schema.json");

/** schema 文件存在且是合法 JSON 即视为可用(Req 1.3);内容结构不在解析期深校验。 */
async function readSettingsSchemaFile(
  packageDir: string,
  schemaPath: string,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(packageDir, schemaPath), "utf8");
  } catch {
    return false;
  }
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析清单 settings 段(spec: source-settings-and-slots,任务 1.2,Req 1.2/1.3/1.4)。
 *
 * - 清单声明 `settings` 段:schema 文件存在且合法 JSON 才启用,否则降级 diagnostics(不 fail 整个模块)。
 * - 无清单(`manifest === undefined`)但默认 `settings/schema.json` 存在且合法:按「文件存在即启用」回退启用。
 * - 清单存在但未声明 settings:视为作者主动不选用本特性,零变化(不回退扫描)。
 */
async function resolveSettings(
  packageDir: string,
  manifest: PiWebManifest | undefined,
  diagnostics: string[],
): Promise<PluginDescriptor["settings"]> {
  if (manifest !== undefined) {
    if (manifest.settings === undefined) return undefined;
    const declared = manifest.settings;
    if (await readSettingsSchemaFile(packageDir, declared.schema)) {
      return {
        schemaPath: declared.schema,
        ...(declared.title !== undefined ? { title: declared.title } : {}),
        ...(declared.icon !== undefined ? { icon: declared.icon } : {}),
        scope: declared.scope,
        widgets: declared.widgets ?? [],
      };
    }
    diagnostics.push(
      `settings.schema 指向的文件缺失或不是合法 JSON,已忽略 settings: ${declared.schema}`,
    );
    return undefined;
  }

  if (await readSettingsSchemaFile(packageDir, DEFAULT_SETTINGS_SCHEMA_PATH)) {
    return { schemaPath: DEFAULT_SETTINGS_SCHEMA_PATH, scope: "source", widgets: [] };
  }
  return undefined;
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

  const settings = await resolveSettings(packageDir, manifest, diagnostics);

  return {
    id,
    version,
    ...(manifest?.displayName !== undefined ? { displayName: manifest.displayName } : {}),
    ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
    pi,
    ...(web !== undefined ? { web } : {}),
    webCommands,
    ...(bindings !== undefined ? { bindings } : {}),
    ...(settings !== undefined ? { settings } : {}),
    diagnostics,
  };
}
