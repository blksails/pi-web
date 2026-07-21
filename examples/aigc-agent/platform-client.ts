// [迁移内联] 源:aigc-agent packages/platform-client/src/index.ts(原包名 @aigc-agent/platform-client,
// 单文件零依赖,aigc 专属胶水故不上提 workspace 包)。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
/**
 * @aigc-agent/platform-client — 子进程侧平台接缝(设计文档 §4.1.1 ③)。
 *
 * agent 子进程/customTools 直接 `import { getPlatformContext }`。它经**回调 token**
 * (env 里的 PLATFORM_CALLBACK_TOKEN,父进程 createChannel 注入)调父进程内部路由
 * `/api/internal/platform/*`,取 provider key、写 aigc_assets 业务行——**子进程不持任何
 * 后端长期凭证**(无 Supabase client、无 service key),即便被 prompt 注入也触达不到后端。
 *
 * env 缺失(未注入 token,如 stub / 离线)→ 优雅降级为 UNAVAILABLE(同附件 seam 语义):
 * `available:false`,调用方法即抛,customTools 应先判 `available` 再用。
 */

export interface ResolvedKey {
  readonly key: string;
  readonly kind: "raw" | "scoped-token";
  readonly expiresAt?: string;
}

export interface PutAssetInput {
  readonly attachmentId: string;
  readonly displayUrl: string;
  readonly kind: "image" | "video" | "audio";
  /** 挂到哪个会话画廊;省略则父进程从回调 token 的 sid 兜底。 */
  readonly sessionId?: string;
  readonly meta?: Record<string, unknown>;
}

export interface RecordGenerationInput {
  readonly category: string;
  readonly variant: string;
  readonly status: "success" | "error";
  readonly outputCount: number;
  readonly provider?: string;
  readonly errorMessage?: string;
  readonly elapsedMs?: number;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
}

export type AssetKind = "image" | "video" | "audio";

export interface AssetRecord {
  readonly assetId: string;
  readonly attachmentId?: string;
  readonly kind: AssetKind;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly sessionId?: string;
  readonly materialId?: number;
  readonly meta?: Record<string, unknown>;
}

export interface AssetQuery {
  readonly sessionId?: string;
  readonly kind?: AssetKind;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface PlatformClient {
  readonly available: boolean;
  /** 解析该会话身份(token 绑定)下 provider 的有效 key;404 → PlatformUnavailableError。 */
  getKey(provider: string, purpose?: string): Promise<ResolvedKey>;
  /** 字节已由子进程直连 BlobStore 落库,此处只记业务行。 */
  putAsset(a: PutAssetInput): Promise<{ readonly assetId: string }>;
  /** 记一条生成台账(aigc_generations;成功/失败均记)。 */
  recordGeneration(input: RecordGenerationInput): Promise<void>;
  /** 列本租户/会话可见的生成素材(attachmentCatalog.list 用)。 */
  listAssets(q?: AssetQuery): Promise<Page<AssetRecord>>;
  /** 取单条素材(attachmentCatalog.resolve 用;经 displayUrl 子进程 fetch 字节)。 */
  getAsset(assetId: string): Promise<AssetRecord | undefined>;
}

/** 平台接缝不可用(env 未注入 token)或回调失败时抛出。 */
export class PlatformUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlatformUnavailableError";
  }
}

const unavailable = (): Promise<never> =>
  Promise.reject(
    new PlatformUnavailableError("platform seam unavailable (no callback token)"),
  );

const UNAVAILABLE: PlatformClient = {
  available: false,
  getKey: unavailable,
  putAsset: unavailable,
  recordGeneration: unavailable,
  listAssets: unavailable,
  getAsset: unavailable,
};

/**
 * 取子进程平台客户端。默认读 `process.env`(父进程经 spawn env 注入
 * PLATFORM_CALLBACK_URL + PLATFORM_CALLBACK_TOKEN);二者任一缺失 → UNAVAILABLE。
 */
export function getPlatformContext(
  env: NodeJS.ProcessEnv = process.env,
): PlatformClient {
  const base = env.PLATFORM_CALLBACK_URL;
  const token = env.PLATFORM_CALLBACK_TOKEN;
  if (base === undefined || base === "" || token === undefined || token === "") {
    return UNAVAILABLE;
  }

  const call = async <T>(path: string, body: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new PlatformUnavailableError(`platform ${path} fetch failed`, {
        cause,
      });
    }
    if (!res.ok) {
      throw new PlatformUnavailableError(`platform ${path} → ${res.status}`);
    }
    return (await res.json()) as T;
  };

  return {
    available: true,
    getKey: (provider, purpose) =>
      call<ResolvedKey>("/keys/resolve", { provider, purpose }),
    putAsset: (a) => call<{ assetId: string }>("/assets", a),
    recordGeneration: (input) =>
      call<Record<string, never>>("/generations", input).then(() => undefined),
    listAssets: (q) => call<Page<AssetRecord>>("/assets/list", q ?? {}),
    getAsset: (assetId) =>
      call<AssetRecord | null>("/assets/get", { assetId }).then(
        (r) => r ?? undefined,
      ),
  };
}
