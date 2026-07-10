/**
 * PublishOrchestrator(cli-package-commands 任务 8.5/7)—— 串起 publish 全流程:
 *   编译 → 签名 → 打 bundle → **经 registry 代理上传 OSS** → registerVersion(oss) → setChannel。
 *
 * ★ 用户决策:origin 走 **oss**,bundle 经 registry 代理上传 —— 发布侧不接触 OSS 写凭据。
 * ★ fail-fast:任一校验失败在**发起任何外部写之前**终止(不留部分状态)。
 * ★ `--dry-run`:走完编译 + 签名,打印将发布的清单与文件列表,**零外部写**,全过退出 0。
 * ★ `--commit-only`:registerVersion 成功即停,不移通道。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { compile, sign, type CompileError, type CompiledPackage, type SignedManifest } from "./manifest-compiler.js";
import type { RegistryPort, RegistryError } from "../registry/registry-port.js";

export interface PublishOptions {
  readonly packageDir: string;
  readonly keyPath: string;
  readonly channel?: string; // 缺省 "stable"
  readonly dryRun?: boolean;
  readonly commitOnly?: boolean;
}

/** 发布结果(供分发层渲染)。 */
export type PublishOutcome =
  | { readonly kind: "dry-run"; readonly manifest: SignedManifest; readonly files: readonly string[] }
  | { readonly kind: "published"; readonly sourceId: string; readonly version: string; readonly bundle: string; readonly channelMoved: boolean };

export type PublishError =
  | { readonly stage: "compile"; readonly error: CompileError }
  | { readonly stage: "sign"; readonly error: CompileError }
  | { readonly stage: "upload" | "register" | "channel"; readonly error: RegistryError };

export type PublishResult = { readonly ok: true; readonly value: PublishOutcome } | { readonly ok: false; readonly error: PublishError };

/** 把 bundlePaths 打成 gzip tarball(bundle 根即文件树,strip=0 与 registry 侧默认一致)。 */
function buildTarball(packageDir: string, bundlePaths: readonly string[]): Buffer {
  const stage = mkdtempSync(join(tmpdir(), "pi-publish-"));
  try {
    for (const rel of bundlePaths) {
      const src = join(packageDir, rel);
      const dst = join(stage, rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
    const tgz = join(mkdtempSync(join(tmpdir(), "pi-publish-tgz-")), "bundle.tgz");
    // -C stage . → 归档根即文件树(无顶层目录),registry 侧 strip=0 直接对齐
    execFileSync("tar", ["-czf", tgz, "-C", stage, "."], { stdio: "ignore" });
    return readFileSync(tgz);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * 执行 publish。**编译 + 校验 + 签名全部先于任何外部写**;dry-run 在签名后短路。
 */
export async function publish(registry: RegistryPort, opts: PublishOptions): Promise<PublishResult> {
  // 1) 编译(读 pi-web.json → glob → 逐文件 sha384)
  const compiled = await compile(opts.packageDir);
  if (!compiled.ok) return { ok: false, error: { stage: "compile", error: compiled.error } };
  const pkg: CompiledPackage = compiled.value;

  // 2) 签名(显式 kind + 调 registry-client signManifest)
  const signed = sign(pkg, opts.keyPath);
  if (!signed.ok) return { ok: false, error: { stage: "sign", error: signed.error } };
  const manifest: SignedManifest = signed.value;

  // 3) dry-run:走完编译+签名,零外部写
  if (opts.dryRun) {
    return { ok: true, value: { kind: "dry-run", manifest, files: pkg.bundlePaths } };
  }

  // 4) 打 bundle → 经 registry 代理上传 OSS(发布侧不接触 OSS 凭据)
  const tarball = buildTarball(opts.packageDir, pkg.bundlePaths);
  const uploaded = await registry.uploadBundle(pkg.id, tarball);
  if (!uploaded.ok) return { ok: false, error: { stage: "upload", error: uploaded.error } };
  const bundle = uploaded.value.bundle;

  // 5) registerVersion(oss origin;registry 回源逐项核验)
  const registered = await registry.registerVersion(pkg.id, { type: "oss", bundle }, manifest);
  if (!registered.ok) return { ok: false, error: { stage: "register", error: registered.error } };

  // 6) setChannel(--commit-only 则停在此前)
  if (opts.commitOnly) {
    return { ok: true, value: { kind: "published", sourceId: pkg.id, version: pkg.version, bundle, channelMoved: false } };
  }
  const channel = opts.channel ?? "stable";
  const moved = await registry.setChannel(pkg.id, channel, pkg.version);
  if (!moved.ok) return { ok: false, error: { stage: "channel", error: moved.error } };

  return { ok: true, value: { kind: "published", sourceId: pkg.id, version: pkg.version, bundle, channelMoved: true } };
}
