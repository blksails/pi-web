/**
 * source-settings-routes — GET|PUT /config/source/:sourceKey 端点(per-source settings)。
 *
 * spec: source-settings-and-slots,任务 2.2;design.md「面⑦ 持久化与端点」;
 * Requirements 3.1-3.6。
 *
 * - GET  /config/source/:sourceKey[?scope=source|project&cwd=<dir>]
 *     → `{ schema: FormSchema, values(masked), scope, title?, icon?, protocolVersion }`
 *     (`title`/`icon` = 清单 `settings.title`/`settings.icon`,任务 5.1 附带修复 Req 5.2 —
 *     之前只经 `schema.title` 代理透出,现直接携带清单级值,`schema.title` 仍是后备)
 * - PUT  /config/source/:sourceKey[?scope=source|project&cwd=<dir>]
 *     ← `{ values }` → 结构性校验(见 `validateFormValues`)→ `mergeSecrets` → `codec.save`
 *     → `{ ok:true, protocolVersion }`
 *
 * 放在本目录(`packages/server/src/config/`)而非 design.md 写的 `http/routes/`——与同款
 * 「域配置路由」的既有兄弟文件(`config-routes.ts`/`mcp-config-routes.ts`/
 * `sandbox-project-routes.ts`/`extensions-config-routes.ts`)同目录,保持一致(仓库既有
 * 范式优先于 design.md 的路径记法)。
 *
 * ### 设计决策(design.md 未给全,本文件的取舍)
 *
 * 1. **schema 解析器注入**:「给定 sourceKey → 找到该 source 的 settings schema +
 *    scope」当前没有现成的「sourceKey → 已 resolve 的 PluginDescriptor」全局映射
 *    (`AgentSourceResolver.resolve()` 是重量级操作且不产出 `settings`;打通「sourceKey
 *    反查 packageDir」需要一个全局 source 注册表,不在 1.2/2.1 的依赖范围内)。故本模块
 *    只定义注入接缝 `resolveSettings(sourceKey) => Promise<ResolvedSourceSettings|undefined>`,
 *    真实生产实现见下方导出的参考函数 `resolveSourceSettingsFromPackageDir`(接一个已知
 *    packageDir 时可用;「sourceKey→packageDir」的全局映射留给后续任务/应用层接线)。
 *    `resolveSettings` 返回 `undefined` → 404(未知 sourceKey,或该 source 未声明
 *    settings——两者对外都是「没有可用配置面」,同一 404 语义)。
 *
 * 2. **FormSchema 的 zod 校验**:`resolveSourceSettingsFromPackageDir` 内部用
 *    `FormSchemaZodSchema`(`@blksails/pi-web-protocol`)校验 schema 文件,校验失败视为
 *    「该 source 无有效 settings」(返回 undefined,不是抛错——与 resolve-plugin.ts 一贯的
 *    降级为 diagnostics、不 fail 整体的风格一致)。
 *
 * 3. **PUT 请求体校验粒度**:仓库里没有「FormSchema IR → zod 校验器」的反向适配器(只有
 *    `zod-to-form-schema.ts` 的正向 zod→FormSchema)。做到那样完整超出本任务范围,故退化
 *    为一个轻量结构性校验器 `validateFormValues`:按 FormSchema.fields 递归检查
 *    required/kind 基本类型是否匹配(string/secret/number/boolean/enum/multiEnum/
 *    stringList/object/record/objectList),不做正则/自定义 refine 级别的深校验。
 *    足以让「必填字段缺失」「类型明显不符」两类用例可靠返回 400(Req 3.3 的硬性验收点)。
 *
 * 4. **门控 env**:仿 `agent-route-routes.ts` 的 `PI_WEB_AGENT_ROUTES_DISABLED`,新增
 *    `PI_WEB_SOURCE_SETTINGS_DISABLED`("1" 关断 → 通用 404,不泄露端点存在性;默认开启)。
 *    body-limit 新增 `PI_WEB_SOURCE_SETTINGS_BODY_LIMIT`(字节,默认 1 MiB)。
 *
 * 5. **`:sourceKey` 提取**:`Router`(`http/router.ts`)虽支持 `:param` 段匹配,但
 *    `RequestContext` 只透出 `:id`→`sessionId`,不透出全量 params(见
 *    `handler.types.ts`)——与 `agent-route-routes.ts` 的 `routeNameFromPath` 同样处境,
 *    故从 `ctx.url.pathname` 末段手写解析(路径模板固定 3 段
 *    `.../config/source/:sourceKey`,sourceKey 恒为紧跟字面量 "source" 的下一段)。
 *    形状非法(非 16 位 hex)→ 400(客户端传参非法,语义上不同于「查无此 source」的 404)。
 *
 * 6. **`?scope=` 解析**:合法值 `"source"|"project"`;缺省用 `resolveSettings` 返回的
 *    `scope`(清单声明值)。非法值 → 400。`scope==="project"` 时的 `cwd` 取
 *    `?cwd=` 查询参数,缺省回退 `opts.defaultCwd`(与 `sandbox-project-routes.ts` 的
 *    project 作用域端点同款「cwd 缺省取 defaultCwd」范式);GET 与 PUT 都需要,因为读写
 *    必须落在同一 scope 的同一文件。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FormSchemaZodSchema } from "@blksails/pi-web-protocol";
import type { FieldDescriptor, FieldKind, FormSchema } from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { AuthContext, InjectedRoute, RequestContext } from "../http/index.js";
import { isSourceKey, sourceKey as deriveSourceKey } from "../source-key.js";
import { resolvePiPlugin } from "../plugin/resolve-plugin.js";
import { SourceSettingsCodec, type SourceSettingsScope } from "./source-settings-codec.js";
import { maskSecrets, mergeSecrets } from "./secret-merge.js";

/** 门控 env(`"1"` 关断;默认开启)。请求时读取,不缓存(与 agent-route-routes 同款)。 */
export const SOURCE_SETTINGS_DISABLED_ENV = "PI_WEB_SOURCE_SETTINGS_DISABLED";
/** 请求体上限 env(字节)。 */
export const SOURCE_SETTINGS_BODY_LIMIT_ENV = "PI_WEB_SOURCE_SETTINGS_BODY_LIMIT";
/** 请求体上限默认值(字节,1 MiB)。 */
export const DEFAULT_SOURCE_SETTINGS_BODY_LIMIT_BYTES = 1024 * 1024;

/** GET/PUT 均通用的 domain moniker:`maskSecrets`/`mergeSecrets` 只用它做「顶层单 record
 * 字段 key === domain」的 auth-like 模式识别兜底(我们的字段 key 不会等于 "source"),
 * 不是 sourceKey 本身,只是一个稳定占位字符串。 */
const SECRET_MERGE_DOMAIN_MONIKER = "source";

/** 已 zod 校验的 FormSchema + 其声明的持久化作用域 + 清单级 title/icon(任务 5.1 附带修复,Req 5.2)。 */
export interface ResolvedSourceSettings {
  readonly schema: FormSchema;
  readonly scope: SourceSettingsScope;
  /** 清单 `settings.title`(菜单项/面板标题应优先取此值,而非 `schema.title` 代理)。 */
  readonly title?: string;
  /** 清单 `settings.icon`。 */
  readonly icon?: string;
}

/** adminPolicy 接缝(与 config-routes 同构);默认放行(本地单用户,P0)。 */
export type SourceSettingsAdminPolicy = (auth: AuthContext) => boolean;
const defaultAdminPolicy: SourceSettingsAdminPolicy = () => true;

export interface SourceSettingsRoutesOptions {
  /** 可选:覆盖 `SourceSettingsCodec` 的 agentDir(测试用)。 */
  readonly rootDir?: string;
  /** 可选:管理员鉴权接缝,默认放行。 */
  readonly adminPolicy?: SourceSettingsAdminPolicy;
  /**
   * sourceKey → 已 resolve 且已 zod 校验的 settings schema + scope;未知 sourceKey /
   * 该 source 未声明 settings 均返回 `undefined`(端点侧统一映射 404)。
   */
  readonly resolveSettings: (
    sourceKeyValue: string,
  ) => Promise<ResolvedSourceSettings | undefined>;
  /** `scope==="project"` 且请求未显式 `?cwd=` 时使用的默认项目根。 */
  readonly defaultCwd?: string;
}

/** PUT body 形状(与 `config-routes.ts` 的 `PutConfigBodySchema` 同构)。 */
const PutSourceSettingsBodySchema = z.object({
  values: z.record(z.unknown()),
});

function gateClosed(): Response {
  return errorResponse(404, "NOT_FOUND", "Not found.");
}

function disabled(): boolean {
  return process.env[SOURCE_SETTINGS_DISABLED_ENV] === "1";
}

function positiveIntEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

function authDenied(auth: AuthContext): Response {
  return auth.anonymous
    ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
    : errorResponse(403, "FORBIDDEN", "Config access denied.");
}

/**
 * 从路径提取 `:sourceKey` 段。路径模板固定 `.../config/source/:sourceKey`;取紧跟
 * 字面量 "source" 的下一段(兼容 basePath 前缀,与 `config-routes.ts` 的 `extractDomain`
 * 同一手法)。
 */
function extractSourceKeyFromPath(url: URL): string | undefined {
  const parts = url.pathname.split("/").filter((s) => s.length > 0);
  const idx = parts.lastIndexOf("source");
  if (idx === -1 || idx === 0 || parts[idx - 1] !== "config" || idx + 1 >= parts.length) {
    return undefined;
  }
  const raw = parts[idx + 1];
  return raw !== undefined ? decodeURIComponent(raw) : undefined;
}

/** 解析 `?scope=` 查询参数;缺省回退 `fallback`(resolveSettings 声明的 scope)。 */
function resolveScopeParam(
  raw: string | null,
  fallback: SourceSettingsScope,
): { readonly ok: true; readonly scope: SourceSettingsScope } | { readonly ok: false } {
  if (raw === null || raw.length === 0) return { ok: true, scope: fallback };
  if (raw === "source" || raw === "project") return { ok: true, scope: raw };
  return { ok: false };
}

function payloadTooLarge(limit: number): Response {
  return errorResponse(
    413,
    "PAYLOAD_TOO_LARGE",
    `Request body exceeds the maximum allowed size of ${limit} bytes.`,
  );
}

// ─── 结构性 FormSchema 校验(轻量,非完整 zod 反向适配器;见文件头决策 3) ──────────

function typeMatches(field: FieldDescriptor, value: unknown): boolean {
  const kind: FieldKind = field.kind;
  switch (kind) {
    case "string":
    case "secret":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return (
        typeof value === "string" &&
        (field.enumOptions === undefined || field.enumOptions.some((o) => o.value === value))
      );
    case "multiEnum":
      return (
        Array.isArray(value) &&
        value.every(
          (v) =>
            typeof v === "string" &&
            (field.enumOptions === undefined || field.enumOptions.some((o) => o.value === v)),
        )
      );
    case "stringList":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "object":
    case "record":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "objectList":
      return Array.isArray(value);
    default:
      return true;
  }
}

function validateField(field: FieldDescriptor, value: unknown, keyPath: string, issues: string[]): void {
  if (value === undefined || value === null) {
    if (field.required) issues.push(keyPath);
    return;
  }
  if (!typeMatches(field, value)) {
    issues.push(keyPath);
    return;
  }
  if (field.kind === "object" && field.fields !== undefined) {
    const obj = value as Record<string, unknown>;
    for (const sub of field.fields) {
      validateField(sub, obj[sub.key], `${keyPath}.${sub.key}`, issues);
    }
    return;
  }
  if (field.kind === "record" && field.fields !== undefined) {
    const obj = value as Record<string, unknown>;
    for (const [entryKey, entryValue] of Object.entries(obj)) {
      const entryObj =
        entryValue !== null && typeof entryValue === "object" && !Array.isArray(entryValue)
          ? (entryValue as Record<string, unknown>)
          : {};
      for (const sub of field.fields) {
        validateField(sub, entryObj[sub.key], `${keyPath}.${entryKey}.${sub.key}`, issues);
      }
    }
    return;
  }
  if (field.kind === "objectList" && field.itemFields !== undefined) {
    const arr = value as unknown[];
    arr.forEach((item, i) => {
      const obj =
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      for (const sub of field.itemFields ?? []) {
        validateField(sub, obj[sub.key], `${keyPath}[${i}].${sub.key}`, issues);
      }
    });
  }
}

/**
 * 按 FormSchema.fields 逐字段校验:required 缺失 / kind 基本类型不符 → 返回字段路径列表
 * (空数组 = 通过)。见文件头决策 3 的取舍说明。
 */
export function validateFormValues(schema: FormSchema, values: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const field of schema.fields) {
    validateField(field, values[field.key], field.key, issues);
  }
  return issues;
}

// ─── 生产参考实现(见文件头决策 1) ─────────────────────────────────────────────

/**
 * 参考实现:给定一个已知的插件包根目录,解析其 settings 段并 zod 校验 schema 文件。
 * 本函数不解决「sourceKey → packageDir」的反查(需要全局 source 注册表,留给后续任务/
 * 应用层接线);调用方需自行把 packageDir 定位好后再调用本函数。
 *
 * @returns schema 校验失败 / 未声明 settings / 文件缺失均返回 `undefined`(与
 *   `resolve-plugin.ts` 一贯的「降级不 fail」风格一致)。
 */
export async function resolveSourceSettingsFromPackageDir(
  packageDir: string,
): Promise<ResolvedSourceSettings | undefined> {
  const descriptor = await resolvePiPlugin(packageDir);
  if (descriptor.settings === undefined) return undefined;

  let raw: string;
  try {
    raw = await fs.readFile(path.join(packageDir, descriptor.settings.schemaPath), "utf8");
  } catch {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const parsed = FormSchemaZodSchema.safeParse(json);
  if (!parsed.success) return undefined;

  return {
    schema: parsed.data,
    scope: descriptor.settings.scope,
    ...(descriptor.settings.title !== undefined ? { title: descriptor.settings.title } : {}),
    ...(descriptor.settings.icon !== undefined ? { icon: descriptor.settings.icon } : {}),
  };
}

/**
 * 生产接线(补task 2.3):给定一批候选包根目录,逐个 `resolvePiPlugin` → 用其
 * `descriptor.id` 派生 sourceKey,命中入参 `sourceKeyValue` 即复用
 * {@link resolveSourceSettingsFromPackageDir} 产出结果。
 *
 * 调用方(应用层 handler 装配)负责收集候选目录集合——本函数不关心它们从何而来(当前激活
 * agent 的 cwd、内置 default-agent、已安装/已登记 source 的本地目录等),只做「目录 →
 * descriptor.id → sourceKey」这一段与 HTTP 端点(本文件)、装配期注入
 * (`runner/source-settings-assembly-wiring.ts`)完全一致的匹配逻辑,保证三处对同一 source
 * 解析出同一 sourceKey(拍板 Q2)。
 *
 * best-effort:单个候选目录 `resolvePiPlugin`/`sourceKey` 失败(如目录不存在)一律跳过,
 * 不使整体查找失败;找不到匹配返回 `undefined`(端点侧统一映射 404,与「未知 source」
 * 同语义)。命中时按 `packageDirs` 顺序取第一个匹配(调用方决定候选顺序即优先级)。
 */
export async function resolveSourceSettingsFromPackageDirs(
  packageDirs: readonly string[],
  sourceKeyValue: string,
): Promise<ResolvedSourceSettings | undefined> {
  for (const dir of packageDirs) {
    let descriptor: Awaited<ReturnType<typeof resolvePiPlugin>>;
    try {
      descriptor = await resolvePiPlugin(dir);
    } catch {
      continue;
    }
    let key: string;
    try {
      key = deriveSourceKey(descriptor.id);
    } catch {
      continue;
    }
    if (key !== sourceKeyValue) continue;
    return resolveSourceSettingsFromPackageDir(dir);
  }
  return undefined;
}

// ─── 路由 ───────────────────────────────────────────────────────────────────

/**
 * 构造 per-source settings 路由数组,直接传入 `createPiWebHandler({ routes })`。
 */
export function createSourceSettingsRoutes(
  opts: SourceSettingsRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const codec = new SourceSettingsCodec(opts.rootDir);
  const adminPolicy = opts.adminPolicy ?? defaultAdminPolicy;
  const bodyLimit =
    positiveIntEnv(SOURCE_SETTINGS_BODY_LIMIT_ENV) ?? DEFAULT_SOURCE_SETTINGS_BODY_LIMIT_BYTES;

  const getHandler = async (ctx: RequestContext): Promise<Response> => {
    // 1) 门控:关断 → 通用 404,先于一切读取/解析,不触达 resolveSettings/codec。
    if (disabled()) return gateClosed();

    // 2) 管理员门控。
    if (!adminPolicy(ctx.auth)) return authDenied(ctx.auth);

    // 3) sourceKey 形状。
    const sourceKeyValue = extractSourceKeyFromPath(ctx.url);
    if (sourceKeyValue === undefined || !isSourceKey(sourceKeyValue)) {
      return errorResponse(
        400,
        "INVALID_SOURCE_KEY",
        `Invalid sourceKey shape: "${sourceKeyValue ?? ""}".`,
      );
    }

    // 4) 该 source 是否声明了可用 settings。
    const resolved = await opts.resolveSettings(sourceKeyValue);
    if (resolved === undefined) {
      return errorResponse(
        404,
        "SOURCE_NOT_FOUND",
        `Unknown sourceKey or source has no declared settings: "${sourceKeyValue}".`,
      );
    }

    // 5) scope 解析。
    const scopeResult = resolveScopeParam(ctx.url.searchParams.get("scope"), resolved.scope);
    if (!scopeResult.ok) {
      return errorResponse(400, "INVALID_SCOPE", 'Query param "scope" must be "source" or "project".');
    }
    const scope = scopeResult.scope;
    const cwd =
      scope === "project" ? ctx.url.searchParams.get("cwd") ?? opts.defaultCwd : undefined;
    if (scope === "project" && (cwd === undefined || cwd.length === 0)) {
      return errorResponse(400, "CWD_REQUIRED", 'scope="project" requires a "cwd".');
    }

    const rawValues = await codec.load(scope, sourceKeyValue, cwd);
    const values = maskSecrets(SECRET_MERGE_DOMAIN_MONIKER, rawValues, resolved.schema);

    return jsonResponse(200, {
      schema: resolved.schema,
      values,
      scope,
      ...(resolved.title !== undefined ? { title: resolved.title } : {}),
      ...(resolved.icon !== undefined ? { icon: resolved.icon } : {}),
    });
  };

  const putHandler = async (ctx: RequestContext): Promise<Response> => {
    // 1) 门控。
    if (disabled()) return gateClosed();

    // 2) 管理员门控。
    if (!adminPolicy(ctx.auth)) return authDenied(ctx.auth);

    // 3) sourceKey 形状。
    const sourceKeyValue = extractSourceKeyFromPath(ctx.url);
    if (sourceKeyValue === undefined || !isSourceKey(sourceKeyValue)) {
      return errorResponse(
        400,
        "INVALID_SOURCE_KEY",
        `Invalid sourceKey shape: "${sourceKeyValue ?? ""}".`,
      );
    }

    // 4) 该 source 是否声明了可用 settings。
    const resolved = await opts.resolveSettings(sourceKeyValue);
    if (resolved === undefined) {
      return errorResponse(
        404,
        "SOURCE_NOT_FOUND",
        `Unknown sourceKey or source has no declared settings: "${sourceKeyValue}".`,
      );
    }

    // 5) scope 解析。
    const scopeResult = resolveScopeParam(ctx.url.searchParams.get("scope"), resolved.scope);
    if (!scopeResult.ok) {
      return errorResponse(400, "INVALID_SCOPE", 'Query param "scope" must be "source" or "project".');
    }
    const scope = scopeResult.scope;
    const cwd =
      scope === "project" ? ctx.url.searchParams.get("cwd") ?? opts.defaultCwd : undefined;
    if (scope === "project" && (cwd === undefined || cwd.length === 0)) {
      return errorResponse(400, "CWD_REQUIRED", 'scope="project" requires a "cwd".');
    }

    // 6) body-limit:Content-Length 提前拒 → 读后按实际字节数兜底复核(agent-route-routes 先例)。
    const contentLength = ctx.req.headers.get("content-length");
    if (contentLength !== null) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > bodyLimit) {
        return payloadTooLarge(bodyLimit);
      }
    }

    let text: string;
    try {
      text = await ctx.req.text();
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
    if (Buffer.byteLength(text, "utf8") > bodyLimit) {
      return payloadTooLarge(bodyLimit);
    }

    let bodyRaw: unknown;
    try {
      bodyRaw = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }

    const bodyParsed = PutSourceSettingsBodySchema.safeParse(bodyRaw);
    if (!bodyParsed.success) {
      const fields = bodyParsed.error.issues.map((i) => (i.path.length > 0 ? i.path.join(".") : "(root)"));
      return errorResponse(400, "INVALID_BODY_SHAPE", "Request body failed validation.", fields);
    }
    const { values: incomingValues } = bodyParsed.data;

    // 7) 读磁盘现值 → 合并 secret 三态(此时 secret 字段已解析为明文,可正确做类型校验)。
    const diskValues = await codec.load(scope, sourceKeyValue, cwd);
    const merged = mergeSecrets(SECRET_MERGE_DOMAIN_MONIKER, incomingValues, diskValues, resolved.schema);

    // 8) 结构性校验:必填缺失 / 类型不符 → 400,不落盘(Req 3.3)。
    const issues = validateFormValues(resolved.schema, merged);
    if (issues.length > 0) {
      return errorResponse(400, "VALIDATION_FAILED", "Source settings failed validation.", issues);
    }

    // `merged` 已是权威全量对象(含删除),覆盖写入,不可再 deepMerge(否则已清除的密钥复活)。
    await codec.save(scope, sourceKeyValue, merged, { cwd, merge: false });

    return jsonResponse(200, { ok: true });
  };

  return [
    { method: "GET", path: "/config/source/:sourceKey", handler: getHandler },
    { method: "PUT", path: "/config/source/:sourceKey", handler: putHandler },
  ];
}
