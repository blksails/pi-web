/**
 * schema-registry — 第三方扩展 schema 目录(覆盖长尾:未自带 schema 的扩展)。
 *
 * 按扩展 id 索引 `{ file, schema }`;`schema` 可为内联 JSON Schema(离线可用)或 https URL
 * (经白名单拉取)。内置离线快照(schema-registry.data.json),`PI_WEB_SCHEMA_REGISTRY_URL`
 * 可指向远端 registry 覆盖/刷新快照。远端拉取一律走 host 白名单,根除 SSRF。
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BUILTIN_SNAPSHOT = require("./schema-registry.data.json") as SchemaRegistrySnapshot;

/** 默认放行的远端 host(registry 远端与 entry.schema URL 共用)。 */
export const DEFAULT_ALLOW_HOSTS: readonly string[] = ["raw.githubusercontent.com", "pi.dev"];

export interface SchemaRegistryEntry {
  readonly file: string;
  readonly schema: string | Record<string, unknown>;
}
export type SchemaRegistrySnapshot = Record<string, SchemaRegistryEntry>;

/** 仅放行 host 白名单的 https URL;越权/失败/非对象一律 undefined(不抛)。 */
export type SchemaFetcher = (url: string) => Promise<unknown | undefined>;

export function createSchemaFetcher(opts: {
  readonly allowHosts: readonly string[];
  readonly fetchImpl?: typeof fetch;
}): SchemaFetcher {
  const doFetch = opts.fetchImpl ?? fetch;
  const allow = new Set(opts.allowHosts);
  const cache = new Map<string, unknown | undefined>();
  return async (url: string): Promise<unknown | undefined> => {
    if (cache.has(url)) return cache.get(url);
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") {
        cache.set(url, undefined);
        return undefined;
      }
      host = u.hostname;
    } catch {
      cache.set(url, undefined);
      return undefined;
    }
    if (!allow.has(host)) {
      cache.set(url, undefined);
      return undefined;
    }
    try {
      // 远端拉取加超时,避免白名单 host 挂起拖住 GET。
      const res = await doFetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        cache.set(url, undefined);
        return undefined;
      }
      const json: unknown = await res.json();
      const value = typeof json === "object" && json !== null ? json : undefined;
      cache.set(url, value);
      return value;
    } catch {
      cache.set(url, undefined);
      return undefined;
    }
  };
}

export interface SchemaRegistry {
  /** 按扩展 id 查得 { file, 已解析 schema(对象) };未命中/远端不可用 → undefined。 */
  lookup(extId: string): Promise<{ file: string; schema: Record<string, unknown> } | undefined>;
}

export interface SchemaRegistryOptions {
  /** 离线快照;缺省用内置 schema-registry.data.json。 */
  readonly snapshot?: SchemaRegistrySnapshot;
  /** 远端 registry(PI_WEB_SCHEMA_REGISTRY_URL),覆盖/刷新快照。 */
  readonly remoteUrl?: string;
  /** 放行的远端 host;缺省 DEFAULT_ALLOW_HOSTS。 */
  readonly allowHosts?: readonly string[];
  /** 注入 fetch(测试用)。 */
  readonly fetchImpl?: typeof fetch;
}

function isSnapshot(v: unknown): v is SchemaRegistrySnapshot {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createSchemaRegistry(opts: SchemaRegistryOptions = {}): SchemaRegistry {
  const baseSnapshot = opts.snapshot ?? BUILTIN_SNAPSHOT;
  const allowHosts = opts.allowHosts ?? DEFAULT_ALLOW_HOSTS;
  const fetcher = createSchemaFetcher({ allowHosts, fetchImpl: opts.fetchImpl });
  let mergedPromise: Promise<SchemaRegistrySnapshot> | undefined;

  /** 合并远端覆盖到快照(仅一次,缓存);远端不可用回退快照。 */
  const merged = (): Promise<SchemaRegistrySnapshot> => {
    if (mergedPromise !== undefined) return mergedPromise;
    mergedPromise = (async () => {
      if (opts.remoteUrl === undefined) return baseSnapshot;
      const remote = await fetcher(opts.remoteUrl);
      if (isSnapshot(remote)) return { ...baseSnapshot, ...(remote as SchemaRegistrySnapshot) };
      return baseSnapshot; // 远端不可用/越权 → 回退快照
    })();
    return mergedPromise;
  };

  return {
    lookup: async (extId) => {
      const snapshot = await merged();
      const entry = snapshot[extId];
      if (entry === undefined) return undefined;
      if (typeof entry.schema === "object" && entry.schema !== null) {
        return { file: entry.file, schema: entry.schema };
      }
      if (typeof entry.schema === "string") {
        const fetched = await fetcher(entry.schema);
        if (typeof fetched === "object" && fetched !== null) {
          return { file: entry.file, schema: fetched as Record<string, unknown> };
        }
      }
      return undefined;
    },
  };
}
