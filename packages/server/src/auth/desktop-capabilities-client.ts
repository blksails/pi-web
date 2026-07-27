/**
 * DesktopCapabilitiesClient — 用桌面凭据换取 StaticCapabilitySnapshot.sources 授予
 * (spec: desktop-hybrid-agent-sources)。
 *
 *  - POST capabilitiesUrl, Authorization: Bearer <desktop credential>
 *  - 成功解析 `sources: { baseUrl, token, expiresAt }`
 *  - 进程内存缓存至到期前偏斜;token/凭据绝不落盘、不进 logger 参数
 *  - 失败 fail-soft → undefined(调用方退回仅本地源)
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { SourcesGrant } from "../agent-source-list/registry-http-provider.js";

const logger = createLogger({ namespace: "server:auth:desktop-capabilities" });

/** 到期前多少秒强制刷新(时钟偏斜 + 传输延迟)。 */
const EXPIRY_SKEW_SECONDS = 30;

export type CapabilitiesFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

export interface DesktopCapabilitiesClientOptions {
  /** 完整 URL,如 `https://cloud.example/api/desktop/capabilities`。 */
  readonly capabilitiesUrl: string;
  /** 当前有效桌面凭据;无/失效 → undefined。 */
  readonly getDesktopCredential: () => string | undefined;
  readonly fetchImpl?: CapabilitiesFetch;
  /** 测试注入时钟(毫秒)。 */
  readonly now?: () => number;
  /** 覆盖到期偏斜秒数(测试用)。 */
  readonly expirySkewSeconds?: number;
}

export interface DesktopCapabilitiesClient {
  /** 取 sources 授予;失败/未登录 → undefined。 */
  getSourcesGrant(): Promise<SourcesGrant | undefined>;
  /** 清内存缓存(登出时可选调用)。 */
  clearCache(): void;
}

interface CachedGrant {
  readonly grant: SourcesGrant;
  /** epoch 秒,到期时刻(已扣偏斜后的刷新阈值)。 */
  readonly refreshAfter: number;
  /** 绑定签发时使用的凭据,切号/登出时失效缓存。 */
  readonly credential: string;
}

function parseSourcesGrant(parsed: unknown): SourcesGrant | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const sources = (parsed as { sources?: unknown }).sources;
  if (typeof sources !== "object" || sources === null) return undefined;
  const obj = sources as { baseUrl?: unknown; token?: unknown; expiresAt?: unknown };
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  const token = typeof obj.token === "string" ? obj.token : "";
  if (baseUrl.length === 0 || token.length === 0) return undefined;
  return { baseUrl, token };
}

function parseExpiresAt(parsed: unknown, nowS: number): number {
  if (typeof parsed !== "object" || parsed === null) return nowS;
  const sources = (parsed as { sources?: unknown }).sources;
  if (typeof sources !== "object" || sources === null) return nowS;
  const exp = (sources as { expiresAt?: unknown }).expiresAt;
  if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) return exp;
  // 缺 expiresAt:短缓存 60s 避免每请求都打云。
  return nowS + 60;
}

/**
 * 从云登录 egress base 推导 capabilities URL。
 *
 * 例:`https://host/api/desktop/egress/v1` → `https://host/api/desktop/capabilities`
 * 无法识别时返回 undefined。
 */
export function deriveCapabilitiesUrlFromEgressBase(
  egressBaseUrl: string,
): string | undefined {
  const trimmed = egressBaseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return undefined;
  // 常见: .../api/desktop/egress/v1 或 .../api/desktop/egress
  const m = trimmed.match(/^(https?:\/\/.+?)\/api\/desktop\/egress(?:\/v\d+)?$/i);
  if (m !== null && m[1] !== undefined) {
    return `${m[1]}/api/desktop/capabilities`;
  }
  // 回退:去掉末段 /v1 后若以 /egress 结尾
  const withoutV = trimmed.replace(/\/v\d+$/i, "");
  if (/\/api\/desktop\/egress$/i.test(withoutV)) {
    return withoutV.replace(/\/egress$/i, "/capabilities");
  }
  return undefined;
}

/**
 * 解析 capabilities URL:`PI_WEB_CLOUD_CAPABILITIES_URL` 优先,否则由 egress base 推导。
 */
export function resolveDesktopCapabilitiesUrl(
  env: NodeJS.ProcessEnv,
): string | undefined {
  const explicit = env.PI_WEB_CLOUD_CAPABILITIES_URL?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit.replace(/\/+$/, "");
  const egress = env.PI_WEB_CLOUD_LOGIN_EGRESS_BASE?.trim();
  if (egress === undefined || egress.length === 0) return undefined;
  return deriveCapabilitiesUrlFromEgressBase(egress);
}

export function createDesktopCapabilitiesClient(
  opts: DesktopCapabilitiesClientOptions,
): DesktopCapabilitiesClient {
  const now = opts.now ?? (() => Date.now());
  const skew = opts.expirySkewSeconds ?? EXPIRY_SKEW_SECONDS;
  const fetchImpl: CapabilitiesFetch | undefined =
    opts.fetchImpl ??
    ((globalThis as { fetch?: CapabilitiesFetch }).fetch as
      | CapabilitiesFetch
      | undefined);

  let cache: CachedGrant | undefined;

  return {
    clearCache(): void {
      cache = undefined;
    },

    async getSourcesGrant(): Promise<SourcesGrant | undefined> {
      const cred = opts.getDesktopCredential();
      if (cred === undefined || cred.trim().length === 0) {
        cache = undefined;
        return undefined;
      }

      const nowS = Math.floor(now() / 1000);
      if (
        cache !== undefined &&
        cache.credential === cred &&
        nowS < cache.refreshAfter
      ) {
        return cache.grant;
      }

      if (fetchImpl === undefined) {
        logger.warn("capabilities fetch skipped: no fetch implementation");
        return undefined;
      }

      const url = opts.capabilitiesUrl.trim();
      if (url.length === 0) return undefined;

      let status: number;
      let text: string;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${cred}`,
          },
          body: "{}",
        });
        status = res.status;
        text = await res.text();
      } catch {
        logger.warn("capabilities request network failure");
        return undefined;
      }

      if (status === 401 || status === 403) {
        cache = undefined;
        logger.warn("capabilities auth rejected", { status });
        return undefined;
      }
      if (status < 200 || status >= 300) {
        logger.warn("capabilities non-2xx", { status });
        return undefined;
      }

      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        logger.warn("capabilities invalid JSON");
        return undefined;
      }

      const grant = parseSourcesGrant(parsed);
      if (grant === undefined) {
        logger.warn("capabilities response missing sources grant");
        return undefined;
      }

      const expiresAt = parseExpiresAt(parsed, nowS);
      const refreshAfter = Math.max(nowS, expiresAt - skew);
      cache = { grant, refreshAfter, credential: cred };
      return grant;
    },
  };
}
