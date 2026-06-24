/**
 * extensions-config-routes — 扩展配置端点(全局 + 项目),与 settings.json 结构互映。
 *
 * 路由(均 3 段,避开通用 `/config/:domain` 2 段匹配):
 *  - GET·PUT /config/extensions/global            → `<agentDir>/settings.json`
 *  - GET·PUT /config/extensions/project[?cwd=<dir>] → `<cwd>/.pi/settings.json`
 *
 * 表单 ↔ settings.json 互映(纯函数,便于单测):
 *  - `commands`(pi-web 自有:限制前端 slash 命令可用性)→ settings.json 的 `commands` 命名键。
 *  - `extensions[<extId>]`(per-扩展 KV)→ settings.json **顶层** `<extId>` 键(pi 据此向扩展传参)。
 * 写回**非破坏**:仅更新表单覆盖到的键,保留 `packages`/provider/theme 等既有键与未在表单出现的扩展键。
 */
import { promises as fs } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { extensionsConfigSchema } from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { AuthContext, InjectedRoute, RequestContext } from "../http/index.js";

export type ExtensionsAdminPolicy = (auth: AuthContext) => boolean;
const defaultAdminPolicy: ExtensionsAdminPolicy = () => true;

/** 非「per-扩展 KV」的保留顶层键(互映时跳过)。 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "lastChangelogVersion",
  "packages",
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "theme",
  "commands",
  "frontend",
  "loadSystemResources",
  "loadSystemSkills",
  "loadSystemExtensions",
  "disabledPackages",
]);

type Settings = Record<string, unknown>;
/** 单个扩展条目:启用态 + 原始 packages 规格 + per-扩展 KV 参数。 */
type ExtEntry = {
  /** 启用(在 `packages[]`);`disabledPackages[]` 中为 false。无 spec 的手动 KV 条目恒 true。 */
  enabled: boolean;
  /** 原始 packages 规格(含 `npm:`/`git:`/`local:` 前缀),用于在两数组间搬移。手动 KV 条目无。 */
  spec?: string;
  /** per-扩展 KV 参数。 */
  params: Record<string, string>;
};
type FormValue = {
  /** pi-web 自有:是否载入系统(全局/包/内置)skills(默认 true;false → --no-skills)。 */
  loadSystemSkills?: boolean;
  /** pi-web 自有:是否载入系统(全局/包)extensions(默认 true;false → --no-extensions)。 */
  loadSystemExtensions?: boolean;
  commands?: Record<string, unknown>;
  extensions?: Record<string, ExtEntry>;
  /** 独立配置文件:文件名 → 原始 JSON 内容。 */
  files?: Record<string, unknown>;
};

/** 由 pi-web/pi 管理、**不**作为"扩展独立配置文件"暴露的顶层文件。 */
const RESERVED_FILES: ReadonlySet<string> = new Set([
  "settings.json",
  "auth.json", // 含密钥
  "sandbox.json", // 由「沙箱」面板管理
  "trust.json", // pi 信任库
]);

/** 文件名安全:仅 basename、`.json` 结尾、非保留、无路径穿越。 */
function isSafeConfigFileName(name: string): boolean {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (!name.endsWith(".json")) return false;
  return !RESERVED_FILES.has(name);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 由 packages[] 条目推导扩展配置 id(去掉 `npm:` / `git:` / `local:` 前缀)。 */
export function extIdFromPackage(pkg: string): string {
  const colon = pkg.indexOf(":");
  return colon === -1 ? pkg : pkg.slice(colon + 1);
}

/** 读某 extId 的顶层 KV 块(仅保留字符串值;不存在 → {})。 */
function kvBlockOf(settings: Settings, extId: string): Record<string, string> {
  const block = settings[extId];
  if (!isPlainObject(block)) return {};
  const kv: Record<string, string> = {};
  for (const [k, v] of Object.entries(block)) {
    if (typeof v === "string") kv[k] = v;
  }
  return kv;
}

/** settings 中的字符串数组(过滤非字符串项)。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * settings.json → 表单视图({ commands, extensions, … })。
 *
 * `extensions` 以扩展 id 为主键,每项带启用态:`packages[]` → enabled、`disabledPackages[]`
 * (pi-web 自有)→ disabled,二者均带原始 `spec`(供回写搬移);不在二者中的顶层 KV 块为
 * 手动条目(无 spec、恒启用)。同 id 优先 packages[]。
 */
export function settingsToForm(settings: Settings): FormValue {
  const form: FormValue = {};
  // 默认载入(键缺省/非 false 视作 true);各自独立,并兼容旧版合一键 loadSystemResources。
  const legacyOff = settings["loadSystemResources"] === false;
  form.loadSystemSkills =
    "loadSystemSkills" in settings
      ? settings["loadSystemSkills"] !== false
      : !legacyOff;
  form.loadSystemExtensions =
    "loadSystemExtensions" in settings
      ? settings["loadSystemExtensions"] !== false
      : !legacyOff;
  if (isPlainObject(settings["commands"])) {
    form.commands = settings["commands"];
  }

  const extensions: Record<string, ExtEntry> = {};
  // 1) 启用:packages[]。
  for (const pkg of stringArray(settings["packages"])) {
    const id = extIdFromPackage(pkg);
    if (id.length > 0 && !(id in extensions)) {
      extensions[id] = { enabled: true, spec: pkg, params: kvBlockOf(settings, id) };
    }
  }
  // 2) 禁用:disabledPackages[](pi-web 自有,pi 忽略)。
  for (const pkg of stringArray(settings["disabledPackages"])) {
    const id = extIdFromPackage(pkg);
    if (id.length > 0 && !(id in extensions)) {
      extensions[id] = { enabled: false, spec: pkg, params: kvBlockOf(settings, id) };
    }
  }
  // 3) 顶层手动 KV 块(排除保留键、未被 package 覆盖)→ 无 spec、恒启用。
  for (const [key, value] of Object.entries(settings)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (!isPlainObject(value)) continue;
    if (key in extensions) continue;
    extensions[key] = { enabled: true, params: kvBlockOf(settings, key) };
  }

  if (Object.keys(extensions).length > 0) form.extensions = extensions;
  return form;
}

/**
 * 表单视图 → 合并进既有 settings.json(非破坏)。
 *
 * 当 `extensions` 出现时**整体重建** `packages[]`(启用项)与 `disabledPackages[]`(禁用项,
 * 仅 package 条目即带 spec 者参与);per-扩展 KV:非空 → 整体替换顶层块(支持组内删键),空 →
 * 删除该块。`disabledPackages[]` 为空则移除。`extensions` 未出现则三者均不动。
 */
export function applyFormToSettings(settings: Settings, form: FormValue): Settings {
  const result: Settings = { ...settings };
  // 仅在显式关闭时落键(`false`);默认开则移除该键,保持 settings.json 干净。逐键独立。
  // 同时清理旧版合一键 loadSystemResources(迁移到两个独立键)。
  const applyBool = (key: keyof FormValue, settingsKey: string): void => {
    if (form[key] === false) result[settingsKey] = false;
    else if (form[key] === true) delete result[settingsKey];
  };
  applyBool("loadSystemSkills", "loadSystemSkills");
  applyBool("loadSystemExtensions", "loadSystemExtensions");
  if (form.loadSystemSkills !== undefined || form.loadSystemExtensions !== undefined) {
    delete result["loadSystemResources"];
  }
  if (form.commands !== undefined) {
    result["commands"] = form.commands;
  }
  if (form.extensions !== undefined) {
    const packages: string[] = [];
    const disabled: string[] = [];
    for (const [extId, entry] of Object.entries(form.extensions)) {
      // per-扩展 KV:非空整体替换,空则删除顶层块。
      const params = entry.params ?? {};
      if (Object.keys(params).length > 0) {
        result[extId] = params;
      } else {
        delete result[extId];
      }
      // 成员归属:仅带 spec(真实 package)条目参与 packages/disabledPackages 重建。
      if (typeof entry.spec === "string" && entry.spec.length > 0) {
        (entry.enabled === false ? disabled : packages).push(entry.spec);
      }
    }
    result["packages"] = packages;
    if (disabled.length > 0) {
      result["disabledPackages"] = disabled;
    } else {
      delete result["disabledPackages"];
    }
  }
  return result;
}

// ── IO 与路由 ─────────────────────────────────────────────────────────────────

async function readJsonObject(path: string): Promise<Settings | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (isPlainObject(parsed)) return parsed;
  } catch {
    /* 损坏文件按空处理 */
  }
  return {};
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8" });
}

/** 扫描目录下的扩展独立配置文件(顶层 `*.json`,排除保留文件)→ { 文件名: 内容 }。 */
async function scanConfigFiles(dir: string): Promise<Record<string, unknown>> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const name of names) {
    if (!isSafeConfigFileName(name)) continue;
    const parsed = await readJsonObject(join(dir, name));
    if (parsed !== undefined) out[name] = parsed;
  }
  return out;
}

function resolveCwd(
  raw: string | null,
  defaultCwd: string,
  allowedRoots: readonly string[],
): { ok: true; cwd: string } | { ok: false } {
  const candidate = raw === null || raw.length === 0 ? defaultCwd : raw;
  if (!isAbsolute(candidate)) return { ok: false };
  const abs = resolve(candidate);
  const within = allowedRoots.some((root) => {
    const r = resolve(root);
    return abs === r || abs.startsWith(r + sep);
  });
  return within ? { ok: true, cwd: abs } : { ok: false };
}

export interface ExtensionsConfigRoutesOptions {
  /** 全局 settings.json 所在目录(= ConfigCodec rootDir,默认 ~/.pi/agent)。 */
  readonly agentDir: string;
  /** 项目 cwd 缺省值(= 所服务项目根)。 */
  readonly defaultCwd: string;
  /** 允许写入的项目根白名单(及子树);缺省 [defaultCwd]。 */
  readonly allowedRoots?: readonly string[];
  readonly adminPolicy?: ExtensionsAdminPolicy;
}

/** 解析并校验 PUT body 的表单值(支持 `{values}` 包裹或裸对象)。 */
function extractFormValues(bodyRaw: unknown): unknown {
  return bodyRaw !== null && typeof bodyRaw === "object" && "values" in bodyRaw
    ? (bodyRaw as { values: unknown }).values
    : bodyRaw;
}

export function createExtensionsConfigRoutes(
  opts: ExtensionsConfigRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? defaultAdminPolicy;
  const allowedRoots =
    opts.allowedRoots !== undefined && opts.allowedRoots.length > 0
      ? opts.allowedRoots
      : [opts.defaultCwd];

  const gate = (ctx: RequestContext): Response | undefined => {
    if (adminPolicy(ctx.auth)) return undefined;
    return ctx.auth.anonymous
      ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
      : errorResponse(403, "FORBIDDEN", "Config access denied.");
  };

  // 读取 settings.json(commands + KV)+ 扫描独立配置文件 → 表单视图。
  const handleGet = async (dir: string): Promise<Response> => {
    const settingsPath = join(dir, "settings.json");
    const settings = (await readJsonObject(settingsPath)) ?? {};
    const form = settingsToForm(settings);
    const files = await scanConfigFiles(dir);
    if (Object.keys(files).length > 0) form.files = files;
    // 去重:已有独立配置文件(经 $schema 关联)的扩展,不再在"扩展参数"里显示为空 KV 占位,
    // 避免同一扩展同时出现在两个区。仅移除**空**占位(有真实 settings KV 的不动)。
    if (form.extensions !== undefined) {
      const schemas = Object.values(files)
        .map((c) =>
          c !== null && typeof c === "object" && typeof (c as Record<string, unknown>)["$schema"] === "string"
            ? ((c as Record<string, unknown>)["$schema"] as string)
            : "",
        )
        .join("\n");
      for (const [extId, kv] of Object.entries(form.extensions)) {
        const base = extId.split("/").pop() ?? extId;
        if (Object.keys(kv).length === 0 && base.length > 0 && schemas.includes(base)) {
          delete form.extensions[extId];
        }
      }
    }
    return jsonResponse(200, { dir, path: settingsPath, values: form });
  };

  // 写回:settings.json(commands + KV,非破坏)+ 各独立配置文件(原始 JSON 覆盖)。
  const handlePut = async (ctx: RequestContext, dir: string): Promise<Response> => {
    let bodyRaw: unknown;
    try {
      const text = await ctx.req.text();
      bodyRaw = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
    const parsed = extensionsConfigSchema.safeParse(extractFormValues(bodyRaw));
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) =>
        i.path.length > 0 ? i.path.join(".") : "(root)",
      );
      return errorResponse(422, "SCHEMA_VALIDATION_FAILED", "Extensions config failed validation.", fields);
    }
    const form = parsed.data as FormValue;

    // settings.json(commands + KV)。
    const settingsPath = join(dir, "settings.json");
    const existing = (await readJsonObject(settingsPath)) ?? {};
    await fs.mkdir(dir, { recursive: true });
    await writeJson(settingsPath, applyFormToSettings(existing, form));

    // 独立配置文件:仅写安全文件名(防穿越/保留文件),原始 JSON 覆盖。
    if (form.files !== undefined) {
      for (const [name, content] of Object.entries(form.files)) {
        if (!isSafeConfigFileName(name)) continue;
        await writeJson(join(dir, name), content);
      }
    }
    return jsonResponse(200, { ok: true, path: settingsPath });
  };

  // ── 全局:<agentDir> ──
  const globalGet = async (ctx: RequestContext): Promise<Response> => {
    const denied = gate(ctx);
    return denied ?? handleGet(opts.agentDir);
  };
  const globalPut = async (ctx: RequestContext): Promise<Response> => {
    const denied = gate(ctx);
    return denied ?? handlePut(ctx, opts.agentDir);
  };

  // ── 项目:<cwd>/.pi ──
  const projectDirFor = (ctx: RequestContext):
    | { ok: true; dir: string }
    | { ok: false; res: Response } => {
    const target = resolveCwd(ctx.url.searchParams.get("cwd"), opts.defaultCwd, allowedRoots);
    if (!target.ok) {
      return { ok: false, res: errorResponse(403, "CWD_NOT_ALLOWED", "Requested cwd is not an allowed project root.") };
    }
    return { ok: true, dir: join(target.cwd, ".pi") };
  };
  const projectGet = async (ctx: RequestContext): Promise<Response> => {
    const denied = gate(ctx);
    if (denied !== undefined) return denied;
    const p = projectDirFor(ctx);
    return p.ok ? handleGet(p.dir) : p.res;
  };
  const projectPut = async (ctx: RequestContext): Promise<Response> => {
    const denied = gate(ctx);
    if (denied !== undefined) return denied;
    const p = projectDirFor(ctx);
    return p.ok ? handlePut(ctx, p.dir) : p.res;
  };

  return [
    { method: "GET", path: "/config/extensions/global", handler: globalGet },
    { method: "PUT", path: "/config/extensions/global", handler: globalPut },
    { method: "GET", path: "/config/extensions/project", handler: projectGet },
    { method: "PUT", path: "/config/extensions/project", handler: projectPut },
  ];
}
