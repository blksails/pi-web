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
import { readFile } from "node:fs/promises";
import { globSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  PI_WEB_MANIFEST_FILENAME,
  PiWebManifestSchema,
  type PluginKind,
} from "@blksails/pi-web-protocol";
import { computeFingerprint, computeIntegrity, signManifest } from "@pi-clouds/registry-client";

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
  /** webext 产物目录(相对包根),声明了 `web.dist` 时存在。 */
  readonly webextDist?: string;
  /** webext manifest.json 的 integrity(声明了 `web.dist` 时存在)。 */
  readonly webextManifestIntegrity?: string;
  readonly bundlePaths: readonly string[];
}

export type CompileError =
  | { readonly code: "MANIFEST_MISSING"; readonly expectedPath: string }
  | { readonly code: "MANIFEST_INVALID"; readonly issues: readonly string[] }
  | { readonly code: "DECLARED_PATH_MISSING"; readonly paths: readonly string[] }
  | { readonly code: "KEY_UNUSABLE"; readonly reason: "missing" | "unreadable" | "malformed" };

/** 把 glob 结果规范成 posix 相对路径(去 packageDir 前缀、统一 `/`)。 */
function toRel(packageDir: string, abs: string): string {
  return relative(packageDir, abs).split(sep).join("/");
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

  const refs: CompiledFile[] = [];
  const bundlePaths = new Set<string>();
  const missing: string[] = [];

  // resource 字段:glob 展开每个声明,逐文件摘要
  for (const field of RESOURCE_FIELDS) {
    const patterns = m.pi?.[field] ?? [];
    for (const pattern of patterns) {
      const matched = globSync(pattern, { cwd: packageDir })
        .map((p) => (typeof p === "string" ? p : String(p)))
        .filter(Boolean);
      // 只保留文件(glob 可能命中目录);目录本身不算文件
      const files: string[] = [];
      for (const rel of matched) {
        const abs = join(packageDir, rel);
        try {
          const bytes = await readFile(abs);
          const relPath = toRel(packageDir, abs);
          refs.push({ field, path: relPath, integrity: computeIntegrity(bytes) });
          bundlePaths.add(relPath);
          files.push(relPath);
        } catch {
          // 命中的是目录/不可读 → 跳过(下方以"零命中"判缺失)
        }
      }
      if (files.length === 0) missing.push(pattern);
    }
  }

  let webextDist: string | undefined;
  let webextManifestIntegrity: string | undefined;
  if (m.web?.dist) {
    webextDist = m.web.dist;
    // webext 只有 manifest.json 受完整性保护(与 registry collectIntegrityRefs 一致);
    // 但整棵 dist 树都要进 bundle,install 才能物化 web-extension.mjs 等。
    const distManifest = join(packageDir, webextDist, "manifest.json");
    try {
      const bytes = await readFile(distManifest);
      webextManifestIntegrity = computeIntegrity(bytes);
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

  return ok({
    kind: m.kind,
    id: m.id,
    version: m.version,
    displayName: m.displayName ?? m.id,
    description: m.description ?? "",
    refs,
    ...(webextDist ? { webextDist } : {}),
    ...(webextManifestIntegrity ? { webextManifestIntegrity } : {}),
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
  for (const field of RESOURCE_FIELDS) {
    const items = byField(field);
    if (items.length > 0) base[field] = items;
  }
  if (pkg.webextDist && pkg.webextManifestIntegrity) {
    base["webext"] = { manifestRef: `${pkg.webextDist}/manifest.json`, integrity: pkg.webextManifestIntegrity };
  }

  let signature: string;
  try {
    signature = signManifest(base, privateKey);
  } catch {
    return fail({ code: "KEY_UNUSABLE", reason: "malformed" });
  }
  return ok({ ...base, signature });
}
