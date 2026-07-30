/**
 * schema-resolver — 「已安装扩展 → settings schema」三源解析(服务端)。
 *
 * 对 settings.json `packages[]` 内(已安装/启用)的每个扩展,按优先级解析其配置文件的 schema:
 *   ① 包自带:读包内 `package.json` 的 `pi.settings = { file, schema } | [...]`,加载包内 schema 文件;
 *   ② 内联 `$schema`:留客户端拉取(本解析器跳过有内联 $schema 的文件);
 *   ③ 第三方 registry:①缺省且该文件无内联 $schema 时,按扩展 id 查 registry。
 * 仅处理 packages[] 内扩展(install 门控)。任一来源读取异常即略过、不抛。
 *
 * 产出 fileSchemas(文件名→原始 JSON Schema)随扩展配置端点回传;并记录「声明了 schema 但磁盘
 * 上不存在」的文件名(missingFiles),供端点补空占位以渲染空表单新建。
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  packageIdFromSpec,
  packageInstallDir,
  resolveInPackage,
} from "./package-install-path.js";
import type { SchemaRegistry } from "./schema-registry.js";

/** 由 pi-web/pi 管理、不可作为「扩展独立配置文件」暴露的保留文件。 */
const RESERVED_FILES: ReadonlySet<string> = new Set([
  "settings.json",
  "auth.json",
  "sandbox.json",
  "trust.json",
  "logging.json",
  "models.json",
]);

/** 文件名安全:仅 basename、`.json`、非保留、无路径穿越(防第三方 `pi.settings.file`/registry 投毒)。 */
function isSafeConfigFileName(name: string): boolean {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (!name.endsWith(".json")) return false;
  return !RESERVED_FILES.has(name);
}

export interface ResolvedExtensionSchemas {
  /** 文件名 → 已解析 JSON Schema(原始 JSON)。 */
  readonly fileSchemas: Record<string, unknown>;
  /** 声明了 schema 但磁盘缺失、需补空内容以供新建的文件名。 */
  readonly missingFiles: string[];
}

export interface SchemaResolverDeps {
  /** 全局包树根(~/.pi/agent)。 */
  readonly agentDir: string;
  readonly registry: SchemaRegistry;
}

type PiSettingsEntry = { file: string; schema: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 文件内容是否声明了内联 $schema(https)——属②,留客户端处理。 */
function hasInlineSchema(content: unknown): boolean {
  if (!isPlainObject(content)) return false;
  const s = content["$schema"];
  return typeof s === "string" && s.startsWith("https://");
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await fs.readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 从包 package.json 读 `pi.settings`,归一化为条目数组。 */
function piSettingsOf(pkgJson: Record<string, unknown>): PiSettingsEntry[] {
  const pi = pkgJson["pi"];
  if (!isPlainObject(pi)) return [];
  const settings = pi["settings"];
  const list = Array.isArray(settings) ? settings : settings !== undefined ? [settings] : [];
  const out: PiSettingsEntry[] = [];
  for (const e of list) {
    if (isPlainObject(e) && typeof e["file"] === "string" && typeof e["schema"] === "string") {
      out.push({ file: e["file"], schema: e["schema"] });
    }
  }
  return out;
}

function packagesOf(settings: Record<string, unknown>): string[] {
  const p = settings["packages"];
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 解析已安装扩展的设置 schema。
 * @param settings settings.json 内容(取 packages[])。
 * @param scannedFiles scanConfigFiles 结果(文件名→内容);用于判断内联 $schema 与文件是否存在。
 */
export async function resolveInstalledExtensionSchemas(
  settings: Record<string, unknown>,
  scannedFiles: Record<string, unknown>,
  deps: SchemaResolverDeps,
): Promise<ResolvedExtensionSchemas> {
  const fileSchemas: Record<string, unknown> = {};
  const missing = new Set<string>();

  const note = (file: string, schema: unknown): void => {
    if (!isSafeConfigFileName(file)) return; // 第三方声明的文件名须安全
    fileSchemas[file] = schema;
    if (!(file in scannedFiles)) missing.add(file);
  };

  for (const spec of packagesOf(settings)) {
    const dir = packageInstallDir(spec, deps.agentDir);
    let bundledAny = false;

    // ① 包自带
    if (dir !== undefined) {
      const pkgJson = await readJsonObject(join(dir, "package.json"));
      if (pkgJson !== undefined) {
        for (const { file, schema } of piSettingsOf(pkgJson)) {
          const schemaPath = resolveInPackage(dir, schema); // 防 schema 路径穿越逃逸包目录
          if (schemaPath === undefined) continue;
          const schemaJson = await readJsonObject(schemaPath);
          if (schemaJson !== undefined) {
            note(file, schemaJson);
            bundledAny = true;
          }
        }
      }
    }
    if (bundledAny) continue; // ① 命中则不再查 registry

    // ③ registry(①缺省时);若该文件已有内联 $schema(②)则让客户端处理。
    const extId = packageIdFromSpec(spec);
    const reg = await deps.registry.lookup(extId).catch(() => undefined);
    if (reg !== undefined && !hasInlineSchema(scannedFiles[reg.file])) {
      note(reg.file, reg.schema);
    }
  }

  return { fileSchemas, missingFiles: [...missing] };
}
