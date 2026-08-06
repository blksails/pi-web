/**
 * `assets-list` — 素材域 pane 自带的声明式 HTTP route(Wave 5 · G2①,列表数据面)。
 *
 * 承接宿主 GET /api/assets 列表语义(生成素材,tenant/session 过滤):子进程经
 * ../platform-client.js 回调父进程 /api/internal/platform/assets/list
 * (HMAC + scope assets:read,租户取 claims.tid)——与 attachmentCatalog 同一回调,
 * 响应 Page<AssetRecord> 与宿主 /api/assets GET 同构,web 侧解析零适配。
 *
 * 只读(R-0a):素材域的写路径(目录 CRUD/删除/改名)不入 agent route,留宿主/控制面。
 * 降级:平台接缝不可用/回调失败 → { error: "platform_unavailable", items: [] }。
 *
 * 外部调用:GET /api/sessions/<sid>/agent-routes/assets-list?scope=session&kind=&limit=&cursor=
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import { getAttachmentToolContext } from "@blksails/pi-web-tool-kit/runtime";
import {
  getMaterialsPlatformClient,
  type MaterialsAssetQuery,
  type MaterialsPlatformClient,
} from "../platform.js";

const KINDS = new Set(["image", "video", "audio"]);

type LocalKind = "image" | "video" | "audio";
type AttachmentContext = ReturnType<typeof getAttachmentToolContext>;

export interface AssetsListDependencies {
  readonly getAttachments?: () => AttachmentContext;
  readonly getPlatform?: () => MaterialsPlatformClient;
}

/** 当前会话附件即本地素材的权威来源；平台未接时不应把画廊置空。 */
async function sessionAttachmentItems(
  getAttachments: () => AttachmentContext,
  kind?: LocalKind,
): Promise<unknown[]> {
  const attachments = getAttachments();
  if (!attachments.available) return [];
  const prefix = kind === undefined ? undefined : `${kind}/`;
  const rows = await attachments.listBySession();
  const items = await Promise.all(rows
    .filter((row) => prefix === undefined || row.mimeType.startsWith(prefix))
    .map(async (row) => {
      try {
        const meta = await attachments.getMeta(row.id);
        if (meta?.materialsLibraryHidden === true) return undefined;
        const displayUrl = await (await attachments.resolve(row.id)).url();
        return {
          assetId: row.id,
          attachmentId: row.id,
          displayUrl,
          createdAt: row.createdAt,
          meta: {
            ...(meta ?? {}),
            name: row.name,
            mimeType: row.mimeType,
            origin: row.origin,
          },
        };
      } catch {
        return undefined;
      }
    }));
  return items.filter((item): item is NonNullable<typeof item> => item !== undefined);
}

export function createAssetsListHandler(
  dependencies: AssetsListDependencies = {},
): (req: AgentRouteRequest) => Promise<unknown> {
  const getAttachments = dependencies.getAttachments ?? (() => getAttachmentToolContext());
  const getPlatform = dependencies.getPlatform ?? (() => getMaterialsPlatformClient());
  return async (req: AgentRouteRequest): Promise<unknown> => {
  const platform = getPlatform();

  const { sessionId, kind, limit, cursor } = req.query;
  const q: {
    sessionId?: string;
    kind?: MaterialsAssetQuery["kind"];
    limit?: number;
    cursor?: string;
  } = {};
  if (typeof sessionId === "string" && sessionId !== "") q.sessionId = sessionId;
  if (typeof kind === "string" && KINDS.has(kind)) {
    q.kind = kind as MaterialsAssetQuery["kind"];
  }
  if (typeof limit === "string" && limit !== "") {
    const n = Number(limit);
    if (Number.isFinite(n)) q.limit = n;
  }
  if (typeof cursor === "string" && cursor !== "") q.cursor = cursor;

  const local = await sessionAttachmentItems(getAttachments, q.kind);
  if (req.query.scope === "session" || !platform.available) {
    return { items: local, source: "session-attachments" };
  }
  try {
    const remote = await platform.listAssets(q);
    const remoteItems = Array.isArray(remote.items) ? [...remote.items] : [];
    const known = new Set(
      remoteItems.map((item) => (item as { attachmentId?: string }).attachmentId),
    );
    return {
      ...remote,
      items: [
        ...remoteItems,
        ...local.filter((item) =>
          !known.has((item as { attachmentId?: string }).attachmentId)),
      ],
    };
  } catch {
    return { items: local, source: "session-attachments", error: "platform_unavailable" };
  }
  };
}

export const assetsListHandler = createAssetsListHandler();

/** 路由声明:文件名 assets-list.ts === name「assets-list」=== URL /agent-routes/assets-list。 */
export const assetsListRoute: AgentRouteDecl = {
  name: "assets-list",
  // methods 缺省 → ["GET"](只读查询)。
  description: "生成素材列表(tenant/session 过滤,Page<AssetRecord>,与宿主 /api/assets GET 同构)",
  handler: assetsListHandler,
};
