/**
 * `session-gallery` —— 本会话已产出的素材(**只读**)。
 *
 * 补齐独立仓素材抽屉的「双数据源」:那边的列表 = 已落库素材 ∪ 本会话画廊,所以刚生成的图
 * 立刻出现在抽屉里。本仓的 `assets-list` 只有前者(且平台未接时恒空),后者在 canvas surface
 * 的权威快照里。
 *
 * 为什么走 route 而不是给素材 pane 授 `surface:canvas`:route 是**数据面只读**(R-0a),
 * 在 agent 进程内读快照后只吐引用与轻量元数据;而授 surfaceKey 等于把画布域的读权横向摊给
 * 素材域——素材面板渲染的是外部 CDN 图 URL,是攻击面最大的一个 pane,不值得为看一眼列表扩权。
 * 与 `gallery-stats` 同源(同一 `surface:canvas` 快照),只是那条吐计数、这条吐条目。
 *
 * 降级:seam 未装配 / 画布 surface 尚未写快照 → `{ items: [] }`,绝不抛。
 * 输出完全由快照决定(无时间戳等不稳定字段)。
 *
 * 外部调用:GET /api/sessions/<sid>/agent-routes/session-gallery?kind=image
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import { getSessionState } from "@blksails/pi-web-tool-kit";
import type { GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";

/** 与 `assets-list` 的 `AssetRecord` 同构,web 侧零适配即可并入同一网格。 */
interface GalleryItem {
  readonly assetId: string;
  readonly attachmentId: string;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** `kind=image` → 只留 `image/*`;缺省或未知值不过滤(调用方自理)。 */
function kindPrefix(kind: unknown): string | undefined {
  if (kind === "image" || kind === "video" || kind === "audio") return `${kind}/`;
  return undefined;
}

export function sessionGalleryHandler(req: AgentRouteRequest): unknown {
  const snapshot = getSessionState().get<GalleryState>("surface:canvas");
  if (snapshot === undefined || !Array.isArray(snapshot.assets)) {
    return { items: [], note: "canvas surface not registered" };
  }
  const prefix = kindPrefix(req.query.kind);
  const items: GalleryItem[] = [];
  for (const a of snapshot.assets) {
    if (prefix !== undefined && !a.mimeType.startsWith(prefix)) continue;
    items.push({
      assetId: a.attachmentId,
      attachmentId: a.attachmentId,
      displayUrl: a.displayUrl,
      createdAt: a.createdAt,
      meta: { name: a.name, mimeType: a.mimeType, origin: a.origin },
    });
  }
  return { items };
}

/** 路由声明:文件名 session-gallery.ts === name「session-gallery」=== URL /agent-routes/session-gallery。 */
export const sessionGalleryRoute: AgentRouteDecl = {
  name: "session-gallery",
  // methods 缺省 → ["GET"](只读快照投影)。
  description: "本会话画廊素材(引用 + 轻量元数据,与 assets-list 同构)",
  handler: sessionGalleryHandler,
};
