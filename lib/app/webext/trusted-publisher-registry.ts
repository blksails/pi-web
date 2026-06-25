/**
 * trusted-publisher-registry — 可信发布者注册表(webext-package-install 任务 2.1)。
 *
 * 维护「当前有效的受信发布者 Ed25519 公钥集」。三级信任链的中段:
 *   出厂钉死根公钥 → 验中心列表签名 → 列表含发布者公钥 → (后续)验扩展签名。
 *
 * 关键不变量:
 *   - 中心列表必须经 **出厂钉死根公钥** Ed25519 验签;失败/过期/版本不符 → 不采信。
 *   - 合并优先级:运营者本地(追加/吊销/固定版本/整体停用) > 中心列表。
 *   - fail-safe:拉取失败 → 缓存 → 出厂快照;**绝不 fail-open**(无有效来源=空集=拒绝所有代码扩展)。
 *   - 过期列表与被吊销/标记 revoked 的发布者不进入有效集。
 *   - 仅持公钥;私钥/验签机密不在本模块。
 */
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";

const subtle = webcrypto.subtle;

export interface TrustedPublisher {
  readonly id: string;
  /** Ed25519 公钥(base64 raw,32 字节)。 */
  readonly publicKey: string;
  readonly revoked?: boolean;
}

export interface TrustedPublishersList {
  readonly version: number;
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly publishers: readonly TrustedPublisher[];
  /** 根私钥对规范化字节(排除 signature)的 Ed25519 签名(base64)。 */
  readonly signature: string;
}

export type RefreshResult =
  | { readonly ok: true; readonly source: "central" | "cache" | "snapshot" | "disabled"; readonly count: number }
  | { readonly ok: false; readonly reason: string; readonly fellBackTo: "cache" | "snapshot" | "none"; readonly count: number };

export interface RegistryConfig {
  /** 出厂钉死根公钥(base64 raw)。空字符串=不启用中心列表(仅用本地追加)。 */
  readonly rootPublicKey: string;
  /** 中心列表 URL;缺省=不拉取(仅快照/本地)。 */
  readonly centralUrl?: string;
  /** 出厂快照(离线 fail-safe);本身亦须根签名。 */
  readonly snapshot?: TrustedPublishersList;
  /** 运营者本地追加的受信发布者(不经中心列表)。 */
  readonly localAdd?: readonly TrustedPublisher[];
  /** 运营者本地吊销(发布者 id),优先级最高。 */
  readonly localRevoke?: readonly string[];
  /** 整体停用中心列表(气隙/高安全)。 */
  readonly disableCentral?: boolean;
  /** 固定到指定版本(供应链:不自动采信中心更高版本)。 */
  readonly pinnedVersion?: number;
  /** 注入时钟(测试);默认 Date.now。 */
  readonly now?: () => number;
}

export interface RegistryDeps {
  /** 拉中心列表(解析后的 JSON)。 */
  readonly fetchList?: (url: string) => Promise<unknown>;
  readonly readCache?: () => Promise<TrustedPublishersList | undefined>;
  readonly writeCache?: (list: TrustedPublishersList) => Promise<void>;
}

export interface TrustedPublisherRegistry {
  /** 当前有效受信发布者(已去吊销/过期,已并入本地追加,已减本地吊销)。 */
  publishers(): readonly TrustedPublisher[];
  /** 仅公钥(base64),供安全门白名单使用。 */
  publicKeys(): readonly string[];
  /** 拉中心列表→根验签→版本/有效期校验→合并→缓存;失败回退。 */
  refresh(): Promise<RefreshResult>;
}

/** 规范化列表字节(稳定 key 序、发布者按 id 排序、排除 signature)。签/验共用。 */
export function canonicalListBytes(
  l: Omit<TrustedPublishersList, "signature">,
): string {
  const pubs = [...l.publishers]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => ({ id: p.id, publicKey: p.publicKey, revoked: p.revoked ?? false }));
  return JSON.stringify({
    version: l.version,
    issuedAt: l.issuedAt,
    expiresAt: l.expiresAt ?? null,
    publishers: pubs,
  });
}

/** 用根私钥(base64 pkcs8)签列表;供运营/测试工具产出中心列表与快照。 */
export async function signTrustedPublishersList(
  list: Omit<TrustedPublishersList, "signature">,
  rootPrivateKeyB64: string,
): Promise<TrustedPublishersList> {
  const key = await subtle.importKey(
    "pkcs8",
    Buffer.from(rootPrivateKeyB64, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalListBytes(list));
  const sig = await subtle.sign({ name: "Ed25519" }, key, data);
  return { ...list, signature: Buffer.from(sig).toString("base64") };
}

async function verifyListSignature(
  list: TrustedPublishersList,
  rootPublicKeyB64: string,
): Promise<boolean> {
  if (rootPublicKeyB64.length === 0) return false;
  try {
    const key = await subtle.importKey(
      "raw",
      Buffer.from(rootPublicKeyB64, "base64"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const { signature, ...unsigned } = list;
    return await subtle.verify(
      { name: "Ed25519" },
      key,
      Buffer.from(signature, "base64"),
      new TextEncoder().encode(canonicalListBytes(unsigned)),
    );
  } catch {
    return false;
  }
}

function isExpired(list: TrustedPublishersList, now: number): boolean {
  if (list.expiresAt === undefined) return false;
  const t = Date.parse(list.expiresAt);
  return Number.isFinite(t) && now >= t;
}

/** 已验签 + 未过期 + 版本符合固定要求 → 该列表可作为信任来源。 */
async function acceptList(
  list: TrustedPublishersList | undefined,
  cfg: RegistryConfig,
  now: number,
): Promise<TrustedPublishersList | undefined> {
  if (list === undefined) return undefined;
  if (!(await verifyListSignature(list, cfg.rootPublicKey))) return undefined;
  if (isExpired(list, now)) return undefined;
  if (cfg.pinnedVersion !== undefined && list.version !== cfg.pinnedVersion) {
    return undefined;
  }
  return list;
}

export function createTrustedPublisherRegistry(
  cfg: RegistryConfig,
  deps: RegistryDeps = {},
): TrustedPublisherRegistry {
  const now = cfg.now ?? ((): number => Date.now());
  // 已采信的中心来源(初始用快照,经 refresh 可被中心列表替换)。
  let trustedList: TrustedPublishersList | undefined;

  function effective(): readonly TrustedPublisher[] {
    const revokeSet = new Set(cfg.localRevoke ?? []);
    const merged = new Map<string, TrustedPublisher>();
    // 中心来源(已采信)
    for (const p of trustedList?.publishers ?? []) {
      if (p.revoked === true) continue;
      merged.set(p.id, p);
    }
    // 本地追加优先覆盖
    for (const p of cfg.localAdd ?? []) {
      if (p.revoked === true) continue;
      merged.set(p.id, p);
    }
    // 本地吊销最高优先,移除
    for (const id of revokeSet) merged.delete(id);
    return [...merged.values()];
  }

  return {
    publishers(): readonly TrustedPublisher[] {
      return effective();
    },
    publicKeys(): readonly string[] {
      return effective().map((p) => p.publicKey);
    },
    async refresh(): Promise<RefreshResult> {
      const t = now();
      // 整体停用中心列表:仅快照(经校验)+本地。
      if (cfg.disableCentral === true || cfg.centralUrl === undefined) {
        trustedList = await acceptList(cfg.snapshot, cfg, t);
        return {
          ok: true,
          source: "disabled",
          count: effective().length,
        };
      }
      // 1) 拉中心列表
      let fetched: TrustedPublishersList | undefined;
      let fetchError: string | undefined;
      try {
        const raw = (await deps.fetchList?.(cfg.centralUrl)) as
          | TrustedPublishersList
          | undefined;
        fetched = await acceptList(raw, cfg, t);
        if (fetched === undefined && raw !== undefined) {
          fetchError = "中心列表根验签失败/已过期/版本不符";
        } else if (raw === undefined) {
          fetchError = "中心列表拉取为空";
        }
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
      }
      if (fetched !== undefined) {
        trustedList = fetched;
        await deps.writeCache?.(fetched);
        return { ok: true, source: "central", count: effective().length };
      }
      // 2) 回退缓存
      const cached = await acceptList(
        await deps.readCache?.().catch(() => undefined),
        cfg,
        t,
      );
      if (cached !== undefined) {
        trustedList = cached;
        return {
          ok: false,
          reason: fetchError ?? "中心列表不可用",
          fellBackTo: "cache",
          count: effective().length,
        };
      }
      // 3) 回退出厂快照
      const snap = await acceptList(cfg.snapshot, cfg, t);
      if (snap !== undefined) {
        trustedList = snap;
        return {
          ok: false,
          reason: fetchError ?? "中心列表不可用",
          fellBackTo: "snapshot",
          count: effective().length,
        };
      }
      // 4) 无任何有效来源:绝不 fail-open → 空集(仅本地追加生效)。
      trustedList = undefined;
      return {
        ok: false,
        reason: fetchError ?? "无任何有效信任来源",
        fellBackTo: "none",
        count: effective().length,
      };
    },
  };
}
