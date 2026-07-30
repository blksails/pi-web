/**
 * keystore(spec publish-key-lifecycle,Req 1)—— **本机签名密钥**的生成、保管与读取。
 *
 * ## 解决的问题
 *
 * 在此之前,全仓**没有任何密钥生成入口**(`bin/pi-web.mjs` 只有 `--key <path>` 收既有文件)。
 * 也就是说:用户没有受支持的方式拿到一把能用的私钥,发布因此被一道密码学准备工作卡住。
 * 本模块让"本机有一把可用私钥"成为**恒真前置**,而不是用户的准备工作。
 *
 * ## 三条不可动摇的性质
 *
 *   ① **已有即复用,绝不重写**。私钥被覆盖 = 该机器已登记的公钥永久失去对应私钥,
 *      而它还挂在 registry 上 enabled —— 成为一把谁也用不了、也没人敢停的僵尸钥匙。
 *   ② **坏文件报错,不静默重建**(同上,而且这条更险:自动重建时用户毫无察觉)。
 *   ③ **私钥不进返回值**。这不是纪律,是结构:调用方拿不到,就漏不出去
 *      (签名侧经 `manifest-compiler.readKey()` 直接读文件,不经本模块转手)。
 *
 * ## 有意的能力缺失:不提供导出 / 跨机同步
 *
 * 本模块**没有**、也不该有把私钥读出来交给调用方、或复制到别处的路径。提供了就等于回到
 * "私钥在机器间传",而"本机持钥"的全部意义就在于它不传。换机器的正确做法是**新生成一把**
 * 并登记 —— `PublisherKey[]` 本就支持多钥并存,丢一把不影响已发布内容的签名有效性。
 *
 * ## 形态
 *
 * 与 `manifest-compiler.ts` 的 `KeyMaterial` 逐字段一致(`{publicKey, privateKey}`,
 * base64 raw 32 字节),生成调 registry-client 的 `generateEd25519KeyPair()` ——
 * 与 `sign()` 调 `signManifest` 同规:密码学只有一份实现。
 *
 * ## 依赖边
 *
 * 本文件与 `manifest-compiler.ts` **同目录**,后者已静态依赖 `@pi-clouds/registry-client`,
 * 故本模块不引入任何新的模块解析约束。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { computeFingerprint, generateEd25519KeyPair } from "@pi-clouds/registry-client";
import type { KeyMaterial, Result } from "./manifest-compiler.js";

/** 默认密钥路径的目录名与文件名(与 `~/.pi-web/agents` 同根)。 */
const KEY_DIR_NAME = "keys";
const KEY_FILE_NAME = "publish.json";
/** 覆盖默认路径的环境变量。 */
export const PUBLISH_KEY_PATH_ENV = "PI_WEB_PUBLISH_KEY_PATH";

export type KeystoreError =
  /** 文件存在但解析不出 `{publicKey, privateKey}`。**必须报错,不得覆盖**(Req 1.6)。 */
  | { readonly code: "KEY_MALFORMED"; readonly path: string }
  | { readonly code: "KEY_READ_FAILED"; readonly path: string }
  | { readonly code: "KEY_WRITE_FAILED"; readonly path: string };

/**
 * 密钥的**可公开**信息。刻意不含 `privateKey` —— 见文件头性质 ③。
 */
export interface PublishKeyInfo {
  readonly path: string;
  readonly publicKey: string;
  /** `ed25519:<sha256(pub) b64url>`,即 manifest.publisher 引用的那个值。 */
  readonly fingerprint: string;
  /** 本次是否新生成(供调用方决定是否提示用户 / 触发公钥登记)。 */
  readonly created: boolean;
}

export interface ResolveKeyPathOptions {
  /** 显式路径(CLI `--key`),最高优先。 */
  readonly explicitPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** 测试注入。 */
  readonly homeDir?: string;
}

/**
 * 解析本机密钥路径。优先级:显式入参 > `PI_WEB_PUBLISH_KEY_PATH` > `~/.pi-web/keys/publish.json`。
 */
export function resolvePublishKeyPath(opts: ResolveKeyPathOptions = {}): string {
  if (opts.explicitPath !== undefined && opts.explicitPath.length > 0) return opts.explicitPath;
  const env = opts.env ?? process.env;
  const fromEnv = env[PUBLISH_KEY_PATH_ENV];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return join(opts.homeDir ?? homedir(), ".pi-web", KEY_DIR_NAME, KEY_FILE_NAME);
}

/** 读并校验既有密钥文件。`undefined` = 文件不存在(可以生成)。 */
function readExisting(path: string): Result<KeyMaterial | undefined, KeystoreError> {
  if (!existsSync(path)) return { ok: true, value: undefined };
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: false, error: { code: "KEY_READ_FAILED", path } };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<KeyMaterial>;
    if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") {
      return { ok: false, error: { code: "KEY_MALFORMED", path } };
    }
    return { ok: true, value: { publicKey: parsed.publicKey, privateKey: parsed.privateKey } };
  } catch {
    return { ok: false, error: { code: "KEY_MALFORMED", path } };
  }
}

/**
 * 确保本机有一把可用密钥,返回其可公开信息。
 *
 * - 不存在 → 生成并以 `0600` 写入(目录 `0700`);
 * - 已存在且可解析 → **原样复用,一个字节都不改**;
 * - 已存在但解析失败 → `KEY_MALFORMED`,**不覆盖**。
 */
export function ensurePublishKey(
  opts: ResolveKeyPathOptions = {},
): Result<PublishKeyInfo, KeystoreError> {
  const path = resolvePublishKeyPath(opts);

  const existing = readExisting(path);
  if (!existing.ok) return existing;
  if (existing.value !== undefined) {
    return {
      ok: true,
      value: {
        path,
        publicKey: existing.value.publicKey,
        fingerprint: computeFingerprint(existing.value.publicKey),
        created: false,
      },
    };
  }

  const pair = generateEd25519KeyPair();
  try {
    // 目录 0700:密钥目录本身也不该对同机其他用户可见。
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // 0600 在创建时给定,而不是先写后 chmod —— 后者会有一个短暂的宽权限窗口。
    writeFileSync(path, `${JSON.stringify(pair, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    return { ok: false, error: { code: "KEY_WRITE_FAILED", path } };
  }

  return {
    ok: true,
    value: {
      path,
      publicKey: pair.publicKey,
      fingerprint: computeFingerprint(pair.publicKey),
      created: true,
    },
  };
}

/** `KeystoreError` → 用户可见说明。三个分支对应三种完全不同的修复动作,不压成一条。 */
export function describeKeystoreError(e: KeystoreError): string {
  switch (e.code) {
    case "KEY_MALFORMED":
      // ★ 刻意不提示"删掉重建":该文件对应的公钥可能已登记在 registry 上,
      //   删了就永久失去对应私钥。让用户自己判断是修复还是移走。
      return `签名密钥文件无法解析:${e.path}。请修复它,或把它移走后重试(移走会生成一把**新**密钥,旧公钥若已登记需另行停用)。`;
    case "KEY_READ_FAILED":
      return `签名密钥文件不可读:${e.path}。请检查文件权限。`;
    case "KEY_WRITE_FAILED":
      return `无法写入签名密钥文件:${e.path}。请检查目录权限与磁盘空间。`;
  }
}
