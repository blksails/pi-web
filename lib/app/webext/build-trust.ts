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

export function createWebextTrust(env: NodeJS.ProcessEnv = process.env): WebextTrust {
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
    requireSignature: gate.requireSignature,
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
