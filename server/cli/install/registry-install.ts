/**
 * registry-install(cli-package-commands 任务 9)—— 经注册表安装 + 落盘后完整性复核。
 *
 * 流程(用户决策:**信任 registry、不重验签**;只核字节):
 *   resolve → 经**代理下载** oss bundle(安装侧不接触 OSS 凭据)→ 解包到 staging →
 *   逐项 integrity 复核(sha384)→ 失败**回滚**(删 staging)/ 成功**原子移入** targetDir。
 *
 * 只处理 `oss` origin(pi-web publish 产出的形态,经 registry 代理下载)。git/npm origin 走
 * 既有 AgentInstaller 直连路径(不经代理),不在本模块。
 *
 * 完整性复核后于落盘(防下载/落盘字节损坏);验签由 registry 在 registerVersion 时已做,安装侧不重复。
 *
 * ## 安装回执(update 对齐补记,Req 4.8–4.10)
 *
 * 落盘时在 targetDir 内写一份回执 `.pi-web-registry.json`(`REGISTRY_RECEIPT_FILENAME`),
 * 记录 `sourceId` / 实际安装的 `version` / 请求的 `channel` / 显式钉死的 `pinnedVersion`。
 * 这是 `pi-web update` 的 registry 通道(`registry-update.ts`)判定「装的是什么、跟踪哪个
 * channel、有没有新版」的唯一依据 —— 没有回执的目录不属于本通道(存量安装重装一次即有)。
 *
 * 回执在 integrity 复核**通过后**写进 staging 的 extractDir,再随 rename 一并原子落盘;
 * 复核失败回滚时自然不残留。回执不在 manifest refs 里,不参与 integrity 复核。
 * `pinnedVersion` 只在调用方显式指定精确 `version` 时记录 —— update 对钉死安装如实跳过
 * (对齐 Req 4.6 的 pinned 语义),channel 浮动安装才是可更新对象。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { verifyIntegrity } from "@pi-clouds/registry-client";
import type { RegistryPort, ResolvedRegistryEntry, SignedManifest } from "../registry/registry-port.js";

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type InstallError =
  | { readonly code: "RESOLVE_FAILED"; readonly detail: string }
  | { readonly code: "UNSUPPORTED_ORIGIN"; readonly originType: string }
  | { readonly code: "DOWNLOAD_FAILED"; readonly detail: string }
  | { readonly code: "EXTRACT_FAILED"; readonly detail: string }
  | { readonly code: "INTEGRITY_MISMATCH"; readonly path: string };

export interface InstalledEntry {
  readonly sourceId: string;
  readonly version: string;
  readonly targetDir: string;
  readonly verifiedFiles: number;
}

/** 安装回执文件名(落在 targetDir 根,`.` 前缀不参与源扫描/复核)。 */
export const REGISTRY_RECEIPT_FILENAME = ".pi-web-registry.json";

/** 安装回执 —— `pi-web update` registry 通道的判定依据(见文件头「安装回执」)。 */
export interface RegistryInstallReceipt {
  readonly sourceId: string;
  /** 本次实际安装的版本(resolve 结果,非请求值)。 */
  readonly version: string;
  /** 安装时显式请求的 channel;缺省表示跟 registry 的默认 channel。 */
  readonly channel?: string;
  /** 安装时显式钉死的精确版本;存在即视为 pinned,update 跳过。 */
  readonly pinnedVersion?: string;
}

/** 读取一个目录的安装回执;不存在/坏 JSON/缺必要字段 → undefined(该目录不属于 registry 通道)。 */
export function readInstallReceipt(dir: string): RegistryInstallReceipt | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(dir, REGISTRY_RECEIPT_FILENAME), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["sourceId"] !== "string" || typeof obj["version"] !== "string") return undefined;
  return {
    sourceId: obj["sourceId"],
    version: obj["version"],
    ...(typeof obj["channel"] === "string" ? { channel: obj["channel"] } : {}),
    ...(typeof obj["pinnedVersion"] === "string" ? { pinnedVersion: obj["pinnedVersion"] } : {}),
  };
}

/**
 * sourceId → 安装目录名(与 CLI install 分支的既有 sanitize 规则同一实现,提为共享函数,
 * update 按 packageId 匹配目录时复用同一规则,避免两处漂移)。
 */
export function registryInstallDirName(sourceId: string): string {
  return sourceId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 从 registry manifest 收集受完整性保护的引用(与发布侧 collectRefs 对称)。 */
export function collectManifestRefs(manifest: SignedManifest): { path: string; integrity: string }[] {
  const refs: { path: string; integrity: string }[] = [];
  for (const field of ["skills", "extensions", "prompts", "themes"] as const) {
    const items = manifest[field] as { path: string; integrity: string }[] | undefined;
    if (Array.isArray(items)) refs.push(...items);
  }
  const entry = manifest["entry"] as { path: string; integrity: string } | undefined;
  if (entry) refs.push(entry);
  const webext = manifest["webext"] as { manifestRef: string; integrity: string } | undefined;
  if (webext) refs.push({ path: webext.manifestRef, integrity: webext.integrity });
  return refs;
}

export interface InstallFromRegistryOptions {
  readonly channel?: string;
  readonly version?: string;
  /** 最终安装目录(不存在则创建;已存在会被本次落盘的 staging 原子替换)。 */
  readonly targetDir: string;
}

/**
 * 经注册表安装一个 oss origin 的 source。
 */
export async function installFromRegistry(
  registry: RegistryPort,
  sourceId: string,
  opts: InstallFromRegistryOptions,
): Promise<Result<InstalledEntry, InstallError>> {
  // 1) resolve
  const resolved = await registry.resolve(sourceId, {
    ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
    ...(opts.version !== undefined ? { version: opts.version } : {}),
  });
  if (!resolved.ok) return fail({ code: "RESOLVE_FAILED", detail: JSON.stringify(resolved.error) });
  const entry: ResolvedRegistryEntry = resolved.value;

  if (entry.origin.type !== "oss") {
    return fail({ code: "UNSUPPORTED_ORIGIN", originType: entry.origin.type });
  }

  // 2) 代理下载 bundle(安装侧不接触 OSS 凭据)
  const dl = await registry.downloadBundle(sourceId, entry.origin.bundle);
  if (!dl.ok) return fail({ code: "DOWNLOAD_FAILED", detail: JSON.stringify(dl.error) });

  // 3) 解包到 staging(不直接落 targetDir,便于失败回滚 + 成功原子替换)。
  //    staging 放在 targetDir 的**父目录**下 → 与 targetDir 同文件系统,rename 才能原子(跨 fs 会 EXDEV)。
  const parent = dirname(opts.targetDir);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, ".pi-reg-install-"));
  try {
    const tgz = join(staging, "__bundle.tgz");
    writeFileSync(tgz, Buffer.from(dl.value));
    const extractDir = join(staging, "content");
    mkdirSync(extractDir, { recursive: true });
    try {
      // strip=0:bundle 根即文件树(与 registry 侧默认对齐)
      execFileSync("tar", ["-xzf", tgz, "-C", extractDir], { stdio: "ignore" });
    } catch (e) {
      return fail({ code: "EXTRACT_FAILED", detail: (e as Error).message });
    }
    rmSync(tgz, { force: true });

    // 4) 落盘后逐项 integrity 复核(防下载/落盘字节损坏)
    const refs = collectManifestRefs(entry.manifest);
    for (const ref of refs) {
      const abs = join(extractDir, ref.path);
      let bytes: Buffer;
      try {
        bytes = readFileSync(abs);
      } catch {
        return fail({ code: "INTEGRITY_MISMATCH", path: ref.path }); // 缺文件 = 复核失败
      }
      if (!verifyIntegrity(new Uint8Array(bytes), ref.integrity)) {
        return fail({ code: "INTEGRITY_MISMATCH", path: ref.path });
      }
    }

    // 4.5) 复核通过 → 写安装回执进 staging(随 rename 原子落盘;失败回滚不残留)
    const receipt: RegistryInstallReceipt = {
      sourceId,
      version: entry.version,
      ...(opts.channel !== undefined ? { channel: opts.channel } : {}),
      ...(opts.version !== undefined ? { pinnedVersion: opts.version } : {}),
    };
    writeFileSync(join(extractDir, REGISTRY_RECEIPT_FILENAME), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

    // 5) 原子移入 targetDir(先删旧,再 rename staging content)
    if (existsSync(opts.targetDir)) rmSync(opts.targetDir, { recursive: true, force: true });
    mkdirSync(join(opts.targetDir, ".."), { recursive: true });
    renameSync(extractDir, opts.targetDir);

    return ok({ sourceId, version: entry.version, targetDir: opts.targetDir, verifiedFiles: refs.length });
  } finally {
    rmSync(staging, { recursive: true, force: true }); // extractDir 已 rename 走则这里只清残余
  }
}
