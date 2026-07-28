/**
 * RegistryHttpSourceProvider — 经 HTTP 消费 registry `GET /sources`
 * (spec: desktop-hybrid-agent-sources)。
 *
 * 不依赖 `@pi-clouds/registry-client`:手写 fetch + 宽松 JSON 解析。
 * 未登录 / 无授予 / 线上失败 → fail-soft 返回 `[]`(不抛,本地列表仍可用)。
 */
import { createLogger } from "@blksails/pi-web-logger";
import type { AgentSourceProvider, AgentSourceRecord } from "./types.js";

const logger = createLogger({ namespace: "server:agent-source-list:registry-http" });

/** 默认发布通道(与 pi-clouds RegistryAgentSourceProvider 一致)。 */
export const DEFAULT_REGISTRY_CHANNEL = "stable";

/** capabilities.sources 授予的最小形状。 */
export interface SourcesGrant {
  readonly baseUrl: string;
  readonly token: string;
}

/** 可注入的 fetch 形状(Node 全局 fetch 兼容)。 */
export type RegistryFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
  },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

export interface RegistryHttpSourceProviderOptions {
  /**
   * 取当前 registry 访问授予。`undefined` = 未登录/不可用 → list 返回 [] 且不发请求。
   */
  readonly getGrant: () => Promise<SourcesGrant | undefined>;
  /** 注入 fetch;缺省全局 fetch。 */
  readonly fetchImpl?: RegistryFetch;
  /** 引用通道;缺省 `stable`。 */
  readonly defaultChannel?: string;
}

interface RawSourceSummary {
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly description?: unknown;
  readonly kind?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** 从 registry list 响应体提取 sources 数组(兼容 `{sources:[]}` 与裸数组)。 */
function extractSources(parsed: unknown): readonly RawSourceSummary[] {
  if (Array.isArray(parsed)) return parsed as RawSourceSummary[];
  if (typeof parsed === "object" && parsed !== null) {
    const sources = (parsed as { sources?: unknown }).sources;
    if (Array.isArray(sources)) return sources as RawSourceSummary[];
  }
  return [];
}

function project(
  s: RawSourceSummary,
  channel: string,
): AgentSourceRecord | undefined {
  const id = str(s.id);
  if (id === undefined) return undefined;
  // 确定 plugin 不进会话 agent 选择器。
  if (s.kind === "plugin") return undefined;

  const displayName = str(s.displayName) ?? id;
  const description = str(s.description);
  return {
    id,
    source: `${id}@${channel}`,
    name: displayName,
    kind: "dir",
    origin: "registry",
    mode: "cli",
    title: displayName,
    ...(description !== undefined ? { description } : {}),
  };
}

export function createRegistryHttpSourceProvider(
  opts: RegistryHttpSourceProviderOptions,
): AgentSourceProvider {
  const channel = opts.defaultChannel ?? DEFAULT_REGISTRY_CHANNEL;
  const fetchImpl: RegistryFetch | undefined =
    opts.fetchImpl ??
    ((globalThis as { fetch?: RegistryFetch }).fetch as RegistryFetch | undefined);

  return {
    async list(): Promise<AgentSourceRecord[]> {
      let grant: SourcesGrant | undefined;
      try {
        grant = await opts.getGrant();
      } catch {
        // getGrant 自身失败 → 当无授予。
        return [];
      }
      if (grant === undefined) return [];

      const base = stripTrailingSlashes(grant.baseUrl.trim());
      if (base.length === 0) return [];
      if (fetchImpl === undefined) {
        logger.warn("registry http list skipped: no fetch implementation");
        return [];
      }

      const url = `${base}/sources`;
      let text: string;
      let status: number;
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            // 凭据只进请求头,绝不进 log 参数。
            authorization: `Bearer ${grant.token}`,
          },
        });
        status = res.status;
        text = await res.text();
      } catch {
        logger.warn("registry http list network failure", { urlHost: safeHost(base) });
        return [];
      }

      if (status < 200 || status >= 300) {
        logger.warn("registry http list non-2xx", {
          status,
          urlHost: safeHost(base),
        });
        return [];
      }

      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        logger.warn("registry http list invalid JSON", { urlHost: safeHost(base) });
        return [];
      }

      const out: AgentSourceRecord[] = [];
      for (const raw of extractSources(parsed)) {
        const rec = project(raw, channel);
        if (rec !== undefined) out.push(rec);
      }
      return out;
    },
  };
}

/** 日志用:只记 host,不记完整 URL(避免 query 泄漏)。 */
function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-url";
  }
}
