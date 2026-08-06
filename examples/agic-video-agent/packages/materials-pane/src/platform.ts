export type MaterialKind = "image" | "video" | "audio";

export interface MaterialsAssetQuery {
  readonly sessionId?: string;
  readonly kind?: MaterialKind;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface MaterialsPlatformClient {
  readonly available: boolean;
  listAssets(query: MaterialsAssetQuery): Promise<{ readonly items: readonly unknown[] } & Record<string, unknown>>;
  listMaterialStatus(ids: readonly string[]): Promise<unknown>;
}

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("platform seam unavailable"));

const UNAVAILABLE: MaterialsPlatformClient = {
  available: false,
  listAssets: unavailable,
  listMaterialStatus: unavailable,
};

/**
 * Pi-web 标准平台回调若存在则自动启用；任意 Agent 无需胶水。
 * 未注入回调时回落会话附件，不影响素材 Pane 基本能力。
 */
export function getMaterialsPlatformClient(
  env: NodeJS.ProcessEnv = process.env,
): MaterialsPlatformClient {
  const base = env.PLATFORM_CALLBACK_URL;
  const token = env.PLATFORM_CALLBACK_TOKEN;
  if (base === undefined || base === "" || token === undefined || token === "") return UNAVAILABLE;

  const call = async <T,>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`platform ${path} → ${response.status}`);
    return await response.json() as T;
  };

  return {
    available: true,
    listAssets: (query) =>
      call<{ readonly items: readonly unknown[] } & Record<string, unknown>>("/assets/list", query),
    listMaterialStatus: (ids) =>
      call<unknown>("/materials/status", { attachmentIds: ids, materialIds: ids }),
  };
}
