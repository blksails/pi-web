/**
 * ManifestCompiler(cli-package-commands 任务 8.1/8.2)—— 把包根手写清单 `pi-web.json`
 * 编译成 registry 的**发布清单**并签名。
 *
 * 单次磁盘遍历产出 `CompiledPackage`(编译器与校验器共用,避免二次遍历/不一致)。
 *
 * ★关键约束:
 *  - **显式写 kind**:pi-web 侧 `pi-web.json#kind` 缺省 `plugin`,registry 侧 `SourceManifest.kind`
 *    缺省 `agent`,两侧相反。发布清单必须显式写出 kind,不依赖任一侧缺省。
 *  - **签名/规范化/摘要一律调 `@pi-clouds/registry-client` 纯函数,不自实现**(字节漂移 → 服务端
 *    验签失败)。
 *  - glob 展开:声明路径可含通配;展开后只含确定文件列表;某声明**零命中** → `DECLARED_PATH_MISSING`。
 */
import { readFile, stat } from "node:fs/promises";
import { globSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  PI_WEB_MANIFEST_FILENAME,
  PiWebManifestSchema,
  DEFAULT_WEBEXT_DIST,
  WEBEXT_SOURCE_CONFIG,
  FormSchemaZodSchema,
  type FormSchema,
  type PluginKind,
} from "@blksails/pi-web-protocol";
import { computeFingerprint, computeIntegrity, signManifest } from "@pi-clouds/registry-client";
// ★ 入口判定**复用运行时同一实现**,绝不复制一份 —— 复制即制造会漂移的副本,
//   而「发布认 A、运行认 B」正是本 spec 要根除的失败模式(R1.7)。
//   该 barrel 保证「仅 node builtins + agent-source 只读探测,无 pi SDK 值导入」
//   (packages/server/src/index.ts:43),已有先例 server/cli/install/local-source-registry.ts:40。
import { probeEntry, EntryOverrideError, ENTRY_PRIORITY } from "@blksails/pi-web-server";

/** kind 的可选取值(供 MANIFEST_KIND_REQUIRED 提示;与 protocol 的 PluginKindSchema 同源)。 */
const PLUGIN_KINDS: readonly string[] = ["agent", "plugin", "component"];
/** 探测不到入口时提示的候选文件名 —— 直接引用运行时序列,避免副本漂移。 */
const ENTRY_CANDIDATES: readonly string[] = ENTRY_PRIORITY;

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** 受完整性保护的产物字段(与 registry `SourceManifest` 对齐)。 */
export type ResourceField = "skills" | "extensions" | "prompts" | "themes";
const RESOURCE_FIELDS: readonly ResourceField[] = ["skills", "extensions", "prompts", "themes"];

/** 一个受完整性保护的文件:相对包根路径 + sha384 摘要。 */
export interface CompiledFile {
  readonly field: ResourceField;
  readonly path: string;
  readonly integrity: string;
}

/**
 * 编译产物(**单次磁盘遍历**,8.1/8.3 共用)。
 *  - `refs`:进 manifest 的 integrity 引用(resource 文件 + webext manifest.json)。
 *  - `bundlePaths`:要打进 bundle tarball 的**全部**文件(refs 的超集:含 webext dist 里非清单文件)。
 */
export interface CompiledPackage {
  readonly kind: PluginKind;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly refs: readonly CompiledFile[];
  /**
   * agent 入口引用(spec: publish-agent-entry-and-bundle,R1.1/R1.6)。
   * **仅 `kind==="agent"` 时存在**;由运行时同一套 `probeEntry` 判定得出,故发布期与
   * 运行期恒指向同一文件(R1.7)。独立于 `refs`:`refs` 承载 resource 字段语义,
   * entry 在 registry 侧是独立的顶层字段。
   */
  readonly entry?: { readonly path: string; readonly integrity: string };
  /**
   * agent 声明的 route 名集合(#31),按 `routes/<name>.<ext>` 目录约定静态提取。
   * **仅 `kind==="agent"` 且存在非空 `routes/` 目录时存在**;registry 侧 `deriveCapabilities`
   * 据此派生 `hasRoutes`(此前恒 `false`,因为 `sign()` 从不产出该字段)。
   */
  readonly routes?: readonly string[];
  /** webext 产物目录(相对包根),声明了 `web.dist` 或探测到约定产物时存在。 */
  readonly webextDist?: string;
  /** webext manifest.json 的 integrity(同上条件)。 */
  readonly webextManifestIntegrity?: string;
  readonly bundlePaths: readonly string[];
  /**
   * per-source 设置声明(spec: cloud-source-settings,R1.1/R1.2)。**仅清单声明了 `settings` 段时
   * 存在**;发布期读取 `settings.schema` 指向的 FormSchema JSON 并 `FormSchemaZodSchema` 校验后内联
   * ——这是良构性的**唯一权威把关点**(registry 侧不深校验、云端消费期只浅层守卫)。`sign()` 把它
   * 写进签名 manifest(进签名字节),供云端 `resolveSettings` 消费。
   */
  readonly settings?: {
    readonly schema: FormSchema;
    readonly scope: "source" | "project";
    readonly title?: string;
    readonly icon?: string;
  };
  /** 非阻断告警(当前:webext 产物陈旧)。演练与正式发布均须输出(R5.4)。 */
  readonly warnings: readonly string[];
}

export type CompileError =
  | { readonly code: "MANIFEST_MISSING"; readonly expectedPath: string }
  | { readonly code: "MANIFEST_INVALID"; readonly issues: readonly string[] }
  | { readonly code: "DECLARED_PATH_MISSING"; readonly paths: readonly string[] }
  | { readonly code: "KEY_UNUSABLE"; readonly reason: "missing" | "unreadable" | "malformed" }
  /** 清单未声明 kind(R4.2)。两侧缺省相反,故不推断,必须显式声明。 */
  | { readonly code: "MANIFEST_KIND_REQUIRED"; readonly allowed: readonly string[] }
  /** kind=agent 但探测不到任何入口(R1.4)。`candidates` 为按序尝试过的约定文件名。 */
  | { readonly code: "ENTRY_NOT_FOUND"; readonly candidates: readonly string[] }
  /** `package.json#pi-web.entry` 声明的覆盖文件不存在(R1.3)。不静默回退。 */
  | { readonly code: "ENTRY_OVERRIDE_MISSING"; readonly declared: string }
  /** 入口解析结果越出包目录(R1.5)。registry 侧会拒绝包外路径,前置拦截以免烧版本号。 */
  | { readonly code: "ENTRY_OUTSIDE_PACKAGE"; readonly resolved: string }
  /** 存在 webext 源但无对应产物(R3.3)。不静默跳过 —— 生产面板失效即死于此。 */
  | { readonly code: "WEBEXT_SOURCE_WITHOUT_DIST"; readonly source: string; readonly expectedDist: string };

/** 把 glob 结果规范成 posix 相对路径(去 packageDir 前缀、统一 `/`)。 */
function toRel(packageDir: string, abs: string): string {
  return relative(packageDir, abs).split(sep).join("/");
}

/**
 * 展开一条声明为**文件**列表(#30)。
 *
 * 声明可以是 glob、单个文件、或**目录**。命中目录时递归收其下全部文件 ——
 * 「声明目录」是 pi 侧的标准形态(一个 skill 就是一个含 `SKILL.md` 的目录),
 * 此前却因 `readFile(目录)` 抛错被静默跳过、进而以「零命中」报
 * `DECLARED_PATH_MISSING`(字面意思是"路径不存在"),对着一个明明存在的目录说不存在。
 *
 * 返回 posix 相对路径,已去重并排序;空目录返回空数组(由调用方按零命中处理)。
 */
async function expandToFiles(packageDir: string, pattern: string): Promise<readonly string[]> {
  const matched = globSync(pattern, { cwd: packageDir })
    .map((p) => (typeof p === "string" ? p : String(p)))
    .filter(Boolean);
  const out = new Set<string>();
  for (const rel of matched) {
    const abs = join(packageDir, rel);
    const st = await stat(abs).catch(() => undefined);
    if (st?.isFile()) {
      out.add(rel.split(sep).join("/"));
    } else if (st?.isDirectory()) {
      // 目录 → 递归收其下全部文件(目录本身不是可摘要的产物)
      for (const inner of globSync(join(rel, "**", "*"), { cwd: packageDir })) {
        const innerRel = typeof inner === "string" ? inner : String(inner);
        const innerSt = await stat(join(packageDir, innerRel)).catch(() => undefined);
        if (innerSt?.isFile()) out.add(innerRel.split(sep).join("/"));
      }
    }
  }
  return [...out].sort();
}

/**
 * 编译 `pi-web.json` → `CompiledPackage`(单次遍历 + 逐文件 sha384)。
 */
export async function compile(packageDir: string): Promise<Result<CompiledPackage, CompileError>> {
  const manifestPath = join(packageDir, PI_WEB_MANIFEST_FILENAME);
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return fail({ code: "MANIFEST_MISSING", expectedPath: manifestPath });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return fail({ code: "MANIFEST_INVALID", issues: [`invalid JSON: ${(e as Error).message}`] });
  }
  const parsed = PiWebManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return fail({
      code: "MANIFEST_INVALID",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  const m = parsed.data;

  // ── kind 必须由作者**显式书写**(R4.1/R4.3)────────────────────────────────
  // 判据刻意是「原始 JSON 里有没有这个键」,而非「解析后 m.kind 有没有值」——
  // schema 为运行时兼容保留了 `.default("plugin")`,解析后恒有值,检测不出"没写"。
  // 强制点放在发布期而非 schema:后者被运行时用于解析已安装包,改必填会让存量中
  // 未写 kind 的包被整份丢弃(运行时静默故障,且违反 R6.2)。
  if (!Object.prototype.hasOwnProperty.call(parsedJson as object, "kind")) {
    return fail({ code: "MANIFEST_KIND_REQUIRED", allowed: PLUGIN_KINDS });
  }

  const refs: CompiledFile[] = [];
  const bundlePaths = new Set<string>();
  const missing: string[] = [];
  const warnings: string[] = [];

  // ── agent 入口(R1.1–R1.6)────────────────────────────────────────────────
  // 仅 agent 类型产出 entry:plugin/component 即便有 index.ts 也不写(R1.6)——
  // registry 对已声明的 entry 仍按 ref 校验,写了徒增失败面且语义误导。
  let entry: { readonly path: string; readonly integrity: string } | undefined;
  if (m.kind === "agent") {
    let probed: Awaited<ReturnType<typeof probeEntry>>;
    try {
      probed = await probeEntry(packageDir);
    } catch (e) {
      if (e instanceof EntryOverrideError) {
        // 覆盖声明的文件不存在 → 不静默回退到约定探测(R1.3),与运行时语义一致
        return fail({ code: "ENTRY_OVERRIDE_MISSING", declared: (e as { path?: string }).path ?? String(e) });
      }
      throw e;
    }
    if (probed.kind === "none") {
      return fail({ code: "ENTRY_NOT_FOUND", candidates: ENTRY_CANDIDATES });
    }
    // 越界拦截(R1.5):probeEntry 的覆盖分支允许 `../x` 与绝对路径,但 registry 侧
    // `assertSafeRelativePath` 会拒绝包外路径 —— 不前置拦截就会烧掉一个版本号。
    const rel = toRel(packageDir, probed.path);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return fail({ code: "ENTRY_OUTSIDE_PACKAGE", resolved: probed.path });
    }
    const bytes = await readFile(probed.path);
    entry = { path: rel, integrity: computeIntegrity(bytes) };
    bundlePaths.add(rel); // R2.1:声明了 entry 就必须打包,否则回源核验取不到 → 照样烧号
  }

  // ── agent 声明式 routes(#31)────────────────────────────────────────────────
  // 目的:让 registry 的 `deriveCapabilities` 能派生出正确的 `hasRoutes` —— 在此之前
  // `sign()` 从不产出 `routes`,导致快照对所有 agent 恒为 false,与运行时事实矛盾。
  //
  // ★ 提取来源的决策:按 `routes/<name>.<ext>` **目录约定**静态提取(文件名即 route 名,
  //   `index.*` 是 barrel 不计)。**不加载用户代码** —— route 的权威值在 `defineAgent({routes})`
  //   这个运行时值里,取它必须 jiti 加载 agent 入口,而那既违反「用户代码只在子进程 loader 内
  //   运行」的既有架构约束(`agent-loader.ts` 文件头),又会拉起整个 pi SDK 依赖树(实测加载
  //   `examples/agent-routes-demo/index.ts` 超时 >2min),更会把 compile 从纯静态遍历变成
  //   执行任意用户代码。故取约定而非取权威值,代价是**只覆盖遵循目录约定的 agent**。
  let routeNames: readonly string[] | undefined;
  if (m.kind === "agent") {
    const inRoutesDir = await expandToFiles(packageDir, "routes");
    const names = inRoutesDir
      .map((p) => p.slice("routes/".length))
      .filter((rest) => !rest.includes("/")) // 只认一级:嵌套子目录不是 route 声明
      .filter((f) => /\.(ts|js|mjs)$/.test(f))
      .map((f) => f.replace(/\.(ts|js|mjs)$/, ""))
      .filter((n) => n !== "index"); // barrel 不是 route
    if (names.length > 0) {
      routeNames = [...new Set(names)].sort();
      // 声明了就必须打包 —— 与 entry 同一教训(#28):manifest 说有、包里没有,
      // 装完即 `import "./routes/index.js"` 失败。routes 文件与 `files` 白名单同档:
      // 进 bundle 不进 refs(不受 integrity 保护)。
      for (const rel of inRoutesDir) bundlePaths.add(rel);
    }
  }

  // resource 字段:展开每个声明(glob / 文件 / **目录**),逐文件摘要
  for (const field of RESOURCE_FIELDS) {
    const patterns = m.pi?.[field] ?? [];
    for (const pattern of patterns) {
      const files = await expandToFiles(packageDir, pattern);
      for (const relPath of files) {
        const bytes = await readFile(join(packageDir, relPath));
        refs.push({ field, path: relPath, integrity: computeIntegrity(bytes) });
        bundlePaths.add(relPath);
      }
      if (files.length === 0) missing.push(pattern);
    }
  }

  // ── 通用文件白名单(R2.3/R2.4)──────────────────────────────────────────────
  // 与 resource 字段的关键区别:**只进 bundlePaths、不进 refs** —— 即打包但不受完整性
  // 保护,与 webext dist 里的非 manifest 文件同档。`routes/**`、`lib/**` 等运行所需的
  // 附属文件由此有了正规入口,不必再走私进 `pi.extensions`。
  for (const pattern of m.files ?? []) {
    // 同样支持目录展开(#30):`files: ["routes"]` 与 `files: ["routes/**/*.ts"]` 等价
    const hits = await expandToFiles(packageDir, pattern);
    for (const rel of hits) bundlePaths.add(rel);
    if (hits.length === 0) missing.push(pattern); // 沿用既有「声明零命中」语义(R2.4)
  }

  // ── 包元数据(R2.2)────────────────────────────────────────────────────────
  // 必须入包:`package.json#pi-web.entry` 是入口覆盖的**唯一权威**,不打包会导致安装后
  // 运行期 probeEntry 读不到覆盖、回退到约定入口 —— 与发布期判定错位(正是本 spec 要防的)。
  // 同样只进 bundlePaths 不进 refs:它是元数据而非受保护产物。
  try {
    await readFile(join(packageDir, "package.json"));
    bundlePaths.add("package.json");
  } catch {
    /* 无 package.json:合法(纯清单包),不报错 */
  }

  // ── webext 产物(R3.1–R3.6)────────────────────────────────────────────────
  // 判定次序与运行时 `resolve-plugin.ts` 完全一致:显式声明优先 → 否则探测约定路径。
  // 在此之前发布期是 `if (m.web?.dist)` —— 未声明即**整段静默跳过**,包发出去
  // hasWebext:false,一路 fail-closed 到默认 UI,没有任何一环提示「这个包本该有面板」。
  let webextDist: string | undefined;
  let webextManifestIntegrity: string | undefined;
  const autoDetect = m.web?.autoDetectDist ?? true;
  let effectiveDist: string | undefined;
  if (m.web?.dist) {
    effectiveDist = m.web.dist; // 显式优先,既有行为完全不变(R3.1)
  } else if (autoDetect) {
    // 约定探测(R3.2):以产物清单文件存在为准,与运行时同一判据
    try {
      await readFile(join(packageDir, DEFAULT_WEBEXT_DIST, "manifest.json"));
      effectiveDist = DEFAULT_WEBEXT_DIST;
    } catch {
      // 无产物:若存在 webext 源码则硬失败(R3.3),否则是"本就没有 webext 的包",正常跳过
      let hasSource = false;
      try {
        await readFile(join(packageDir, WEBEXT_SOURCE_CONFIG));
        hasSource = true;
      } catch {
        /* 无源:正常 */
      }
      if (hasSource) {
        return fail({
          code: "WEBEXT_SOURCE_WITHOUT_DIST",
          source: WEBEXT_SOURCE_CONFIG,
          expectedDist: DEFAULT_WEBEXT_DIST,
        });
      }
    }
  }
  // autoDetect=false 且未显式声明 ⇒ effectiveDist 恒 undefined:完全跳过探测,
  // 且不因产物缺失而失败(R3.6)——用于「有产物但不想发布 webext」的包。

  if (effectiveDist) {
    webextDist = effectiveDist;
    // webext 只有 manifest.json 受完整性保护(与 registry collectIntegrityRefs 一致);
    // 但整棵 dist 树都要进 bundle,install 才能物化 web-extension.mjs 等。
    const distManifest = join(packageDir, webextDist, "manifest.json");
    try {
      const bytes = await readFile(distManifest);
      webextManifestIntegrity = computeIntegrity(bytes);
      // 陈旧产物防护(R3.5):产物清单早于源码 ⇒ 警告但不阻断。
      // 只比 mtime、不做 hash 比对 —— 源→产物无稳定映射,hash 比对误报率高。
      try {
        const [distStat, srcStat] = await Promise.all([
          stat(distManifest),
          stat(join(packageDir, WEBEXT_SOURCE_CONFIG)),
        ]);
        if (distStat.mtimeMs < srcStat.mtimeMs) {
          warnings.push(
            `webext 产物可能已过期:${webextDist}/manifest.json 早于 ${WEBEXT_SOURCE_CONFIG},建议重新构建后再发布。`,
          );
        }
      } catch {
        /* 无源文件(纯产物包)⇒ 无从比对,跳过 */
      }
    } catch {
      missing.push(`${webextDist}/manifest.json`);
    }
    // dist 全树进 bundle
    const distFiles = globSync(join(webextDist, "**", "*"), { cwd: packageDir }).map((p) => String(p));
    for (const rel of distFiles) {
      try {
        await readFile(join(packageDir, rel)); // 只收文件(目录读会抛)
        bundlePaths.add(rel.split(sep).join("/"));
      } catch {
        /* 目录 */
      }
    }
  }

  if (missing.length > 0) return fail({ code: "DECLARED_PATH_MISSING", paths: missing });

  // per-source settings 抽取(spec: cloud-source-settings,R1.1/R1.3)。声明了 `settings` 段则读取
  // 其指向的 FormSchema JSON、`FormSchemaZodSchema` 校验、内联;文件缺失/坏 JSON/schema 非法 → 发布
  // 失败(MANIFEST_INVALID,不烧版本号)。未声明 → settings 恒 undefined,产物与现状逐字节等价(R1.4)。
  let settings: CompiledPackage["settings"];
  if (m.settings) {
    const schemaPath = m.settings.schema;
    if (isAbsolute(schemaPath) || schemaPath.split(/[\\/]/).includes("..")) {
      return fail({ code: "MANIFEST_INVALID", issues: [`settings.schema 必须是不逃逸包根的相对路径:${schemaPath}`] });
    }
    let rawSchema: string;
    try {
      rawSchema = await readFile(join(packageDir, schemaPath), "utf8");
    } catch {
      return fail({ code: "MANIFEST_INVALID", issues: [`settings.schema 文件不存在或不可读:${schemaPath}`] });
    }
    let json: unknown;
    try {
      json = JSON.parse(rawSchema);
    } catch (e) {
      return fail({ code: "MANIFEST_INVALID", issues: [`settings.schema 非合法 JSON(${schemaPath}):${(e as Error).message}`] });
    }
    const parsedSchema = FormSchemaZodSchema.safeParse(json);
    if (!parsedSchema.success) {
      return fail({
        code: "MANIFEST_INVALID",
        issues: parsedSchema.error.issues.map((i) => `settings.schema.${i.path.join(".")}: ${i.message}`),
      });
    }
    settings = {
      schema: parsedSchema.data,
      scope: m.settings.scope,
      ...(m.settings.title !== undefined ? { title: m.settings.title } : {}),
      ...(m.settings.icon !== undefined ? { icon: m.settings.icon } : {}),
    };
  }

  return ok({
    ...(entry ? { entry } : {}),
    ...(routeNames ? { routes: routeNames } : {}),
    warnings,
    kind: m.kind,
    id: m.id,
    version: m.version,
    displayName: m.displayName ?? m.id,
    description: m.description ?? "",
    refs,
    ...(webextDist ? { webextDist } : {}),
    ...(webextManifestIntegrity ? { webextManifestIntegrity } : {}),
    ...(settings ? { settings } : {}),
    bundlePaths: [...bundlePaths].sort(),
  });
}

/** 私钥文件形态:`{ publicKey, privateKey }`(base64 raw 32 字节),= `generateEd25519KeyPair()` 输出。 */
export interface KeyMaterial {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** 已签名的发布清单(registry `SourceManifest` 形态,含 `signature`)。 */
export type SignedManifest = Readonly<Record<string, unknown>>;

function readKey(keyPath: string): Result<KeyMaterial, CompileError> {
  let raw: string;
  try {
    raw = readFileSync(keyPath, "utf8");
  } catch (e) {
    const reason = (e as { code?: string }).code === "ENOENT" ? "missing" : "unreadable";
    return fail({ code: "KEY_UNUSABLE", reason });
  }
  try {
    const parsed = JSON.parse(raw) as Partial<KeyMaterial>;
    if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") {
      return fail({ code: "KEY_UNUSABLE", reason: "malformed" });
    }
    return ok({ publicKey: parsed.publicKey, privateKey: parsed.privateKey });
  } catch {
    return fail({ code: "KEY_UNUSABLE", reason: "malformed" });
  }
}

/**
 * 编译产物 → registry 发布清单 + 签名(8.2)。
 * **显式写 kind**;签名调 registry-client 的 `signManifest`(不自实现)。私钥缺失/非法 → `KEY_UNUSABLE`。
 */
export function sign(pkg: CompiledPackage, keyPath: string): Result<SignedManifest, CompileError> {
  const keyRes = readKey(keyPath);
  if (!keyRes.ok) return keyRes;
  const { publicKey, privateKey } = keyRes.value;

  const byField = (field: ResourceField): { path: string; integrity: string }[] =>
    pkg.refs.filter((r) => r.field === field).map((r) => ({ path: r.path, integrity: r.integrity }));

  const base: Record<string, unknown> = {
    schemaVersion: 1,
    name: pkg.id,
    version: pkg.version,
    kind: pkg.kind, // ★ 显式,不依赖任一侧缺省
    publisher: computeFingerprint(publicKey),
  };
  // ★ #28 修复(R1.1):registry 侧 `validate.ts` 对 kind=agent 无条件要求 entry,
  //   在此之前 sign() 从不产出该字段 ⇒ agent 包 100% 落 failed 并烧掉版本号。
  //   仅 agent 有 entry(compile 已保证),故此处无需再判 kind。
  //   签名覆盖范围随之包含 entry;signManifest 内部做 canonical 规范化,字段插入位置不影响结果。
  if (pkg.entry) base["entry"] = { path: pkg.entry.path, integrity: pkg.entry.integrity };
  // #31:route 名数组(registry `SourceManifest.routes?: readonly string[]` 的形状)。
  // 仅 agent 且有声明时写出;registry `deriveCapabilities` 据此派生 hasRoutes。
  if (pkg.routes && pkg.routes.length > 0) base["routes"] = [...pkg.routes];
  for (const field of RESOURCE_FIELDS) {
    const items = byField(field);
    if (items.length > 0) base[field] = items;
  }
  if (pkg.webextDist && pkg.webextManifestIntegrity) {
    base["webext"] = { manifestRef: `${pkg.webextDist}/manifest.json`, integrity: pkg.webextManifestIntegrity };
  }
  // cloud-source-settings(R1.2):内联 per-source settings 声明(进签名字节;canonical 规范化,
  // 字段插入位置不影响结果)。未声明时不写该字段 → 与现状产物逐字节等价(R1.4)。
  if (pkg.settings) base["settings"] = pkg.settings;

  let signature: string;
  try {
    signature = signManifest(base, privateKey);
  } catch {
    return fail({ code: "KEY_UNUSABLE", reason: "malformed" });
  }
  return ok({ ...base, signature });
}
