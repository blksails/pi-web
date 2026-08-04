/**
 * build-trust — 从环境装配「可信发布者注册表 + 服务端验签服务」(webext-package-install 任务 2.2/2.3)。
 *
 * 进程级缓存(单例),首用时 refresh 一次中心列表。环境变量:
 *   - PI_WEB_EXT_WHITELIST:逗号分隔受信发布者 Ed25519 公钥(base64);并入本地追加。
 *   - PI_WEB_EXT_TRUSTED_LIST_URL:中心可信发布者列表 URL(可选)。
 *   - PI_WEB_EXT_ROOT_PUBKEY:出厂钉死根公钥(base64 raw),验中心列表签名(可选)。
 *   - PI_WEB_EXT_REQUIRE_SIGNATURE:见 web-ext-gate-config。
 */
import { buildServerGateOptions } from "../web-ext-gate-config.js";
import { locateDistWithOrigin, type DistOrigin } from "./locate-dist.js";
import type { DesktopConfig } from "@blksails/pi-web-protocol";
import {
  isDesktopHost,
  readDesktopScopedConfig,
  resolveDesktopConfig,
} from "../desktop-defaults.js";
import {
  createTrustedPublisherRegistry,
  type TrustedPublisher,
  type TrustedPublisherRegistry,
} from "./trusted-publisher-registry.js";
import {
  createWebextTrustService,
  type WebextTrustService,
} from "./webext-trust-service.js";

export interface WebextTrust {
  readonly registry: TrustedPublisherRegistry;
  readonly trust: WebextTrustService;
}

function localPublishersFromEnv(env: NodeJS.ProcessEnv): TrustedPublisher[] {
  return (env.PI_WEB_EXT_WHITELIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((publicKey, i) => ({ id: `env:${i}`, publicKey }));
}

let cached: WebextTrust | undefined;

export function createWebextTrust(
  env: NodeJS.ProcessEnv = process.env,
  /** 覆盖签名要求;`undefined` 表示沿用 env 门控。放宽路径见 {@link getWebextTrustForSource}。 */
  requireSignatureOverride?: boolean,
): WebextTrust {
  const gate = buildServerGateOptions(env);
  const registry = createTrustedPublisherRegistry(
    {
      rootPublicKey: env.PI_WEB_EXT_ROOT_PUBKEY ?? "",
      ...(env.PI_WEB_EXT_TRUSTED_LIST_URL !== undefined
        ? { centralUrl: env.PI_WEB_EXT_TRUSTED_LIST_URL }
        : {}),
      localAdd: localPublishersFromEnv(env),
    },
    {
      fetchList: async (url: string): Promise<unknown> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch trusted list ${url}: ${res.status}`);
        return (await res.json()) as unknown;
      },
    },
  );
  const trust = createWebextTrustService({
    registry,
    requireSignature: requireSignatureOverride ?? gate.requireSignature,
    isProduction: env.NODE_ENV === "production",
  });
  return { registry, trust };
}

/** 进程级单例;首用 refresh 一次中心列表(无 URL 时为本地/快照)。 */
export async function getWebextTrust(): Promise<WebextTrust> {
  if (cached !== undefined) return cached;
  const built = createWebextTrust();
  try {
    await built.registry.refresh();
  } catch {
    // refresh 内部已 fail-safe;此处仅防御性兜底。
  }
  cached = built;
  return cached;
}

/** 放宽版单例(不强制签名)。仅经 {@link getWebextTrustForSource} 的双条件判定后才可能拿到。 */
let cachedRelaxed: WebextTrust | undefined;

/**
 * 按**来源**取验签服务(spec desktop-runtime-config Req 2)。
 *
 * ## 放行需要两个条件同时成立
 *
 *  1. 运行在桌面壳形态(壳自述的 `PI_WEB_DESKTOP`);
 *  2. 来源是**本机文件系统目录**(`identify()` 判为 `kind: "dir"`)。
 *
 * 用户手工输入一个本机目录本身就是一次显式信任表达;而「从 registry 装取的扩展」是另一回事,
 * 无差别放行会让桌面版对网络来源也不验签 —— 那是真实的攻击面,不是理论风险。
 *
 * 第三个条件由裁决函数隐含:`env` 显式要求签名、或用户在设置里开了签名要求时,
 * `resolveDesktopConfig` 返回 `requireWebextSignature: true`,此处不再放宽(Req 1.4/3.1)。
 *
 * ## 为什么不改单例的 requireSignature
 *
 * `trust` 是进程级单例,改它等于**全局**放行,来源条件就形同虚设。故保留严格版单例不动,
 * 另备一个放宽版,按来源二选一。
 *
 * @returns 满足双条件 → 放宽版;否则 → 与 {@link getWebextTrust} 相同的严格版。
 */
/**
 * 放行判定(纯函数,便于穷举)。三个条件缺一不可 —— 只测放行那条等于没测边界。
 *
 * @param origin  来源类别;`undefined` 表示定位不到 dist(判不出来就不是「显式指定的本机目录」)。
 */
export function shouldRelaxSignature(input: {
  readonly origin: DistOrigin | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly userConfig: DesktopConfig | undefined;
}): boolean {
  if (!isDesktopHost(input.env)) return false;
  if (input.origin !== "local") return false;
  // env 显式要求签名、或用户在设置里开了签名要求 → 不放宽(Req 1.4 / 3.1)。
  return !resolveDesktopConfig({ env: input.env, userConfig: input.userConfig })
    .requireWebextSignature;
}

export async function getWebextTrustForSource(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebextTrust> {
  // 非桌面形态直接短路,省掉一次文件系统定位。
  if (!isDesktopHost(env)) return getWebextTrust();

  // 来源类别取自 locate-dist 的既有分类(local / installed),不另立判据。
  const located = await locateDistWithOrigin(source);
  const relax = shouldRelaxSignature({
    origin: located?.origin,
    env,
    userConfig: readDesktopScopedConfig(env.PI_WEB_AGENT_DIR, env),
  });
  if (!relax) return getWebextTrust();

  if (cachedRelaxed === undefined) {
    const built = createWebextTrust(env, false);
    try {
      await built.registry.refresh();
    } catch {
      /* refresh 内部已 fail-safe */
    }
    cachedRelaxed = built;
  }
  return cachedRelaxed;
}
