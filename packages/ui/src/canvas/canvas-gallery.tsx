/**
 * CanvasGallery — 画廊镜像视图(aigc-canvas · Req 3.x / 8.2 / 9.x)。
 *
 * 经宿主注入的 `surface`(`WebExtSurfaceAccess`,slot 侧等价 `useSurface("canvas")`)镜像
 * `surface:canvas` 快照:
 *  - `available === true`(source 注册了 `surface:canvas` 探针)→ 9 宫格默认 + 密度切换
 *    (概览 / 瀑布流 / 聚焦)+ 客户端分页 + 血缘 / 时间分组;缩略用签名 `displayUrl`(二进制旁路);
 *    轮末 idle 边沿(`syncSignal` 变化)→ `run("sync")` reconcile。
 *  - `available === false`(非 AIGC source)→ 退化只读图库(来源 = 宿主注入的消息历史图片 `historyImages`),
 *    A 档禁用、不发命令、不报错(B 档在工作台侧仍本地可用)。
 *
 * slot 组件是独立 bundle,经 prop 注入 surface(领域无关搬运);domain 对宿主不透明。
 */
import * as React from "react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset, GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  useCanvasView,
  CANVAS_PAGE_SIZE,
  type CanvasDensity,
} from "./use-canvas-view.js";

const DOMAIN = "canvas";
const STATE_KEY = `surface:${DOMAIN}`;
const PROBE = `surface:${DOMAIN}`;

const DENSITY_LABEL: Record<CanvasDensity, string> = {
  overview: "概览",
  waterfall: "瀑布流",
  focus: "聚焦",
};

export interface CanvasGalleryProps {
  /** 宿主注入的权威 surface 接入(panelRight slot);缺失 / 探针缺失 → 退化。 */
  readonly surface?: WebExtSurfaceAccess;
  /** 退化态图库来源:当前消息历史中的图片附件(宿主已有,无 surface)。 */
  readonly historyImages?: readonly GalleryAsset[];
  /** 轮末 idle 边沿信号:值变化时触发 `run("sync")`(宿主在 onTurnEnd bump)。 */
  readonly syncSignal?: unknown;
  /** 点击格子:展开工作台(由父面板处理)。 */
  readonly onOpenAsset?: (assetId: string) => void;
}

/** 时间分组标签(按本地日期)。 */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** 血缘分组标签(root att_ = 无 derivedFrom 的祖先;此处以直接 derivedFrom 归组,UI 本地派生)。 */
function lineageGroupOf(a: GalleryAsset): string {
  return a.derivedFrom ?? a.attachmentId;
}

export function CanvasGallery({
  surface,
  historyImages,
  syncSignal,
  onOpenAsset,
}: CanvasGalleryProps): React.JSX.Element {
  const view = useCanvasView();
  const available = surface !== undefined && surface.hasCommand(PROBE);

  // 镜像快照(available 时);退化时用 historyImages。
  const [snap, setSnap] = React.useState<GalleryState | undefined>(() =>
    surface?.getState<GalleryState>(STATE_KEY),
  );
  React.useEffect(() => {
    if (surface === undefined) return;
    setSnap(surface.getState<GalleryState>(STATE_KEY));
    return surface.subscribe(STATE_KEY, (v) => setSnap(v as GalleryState | undefined));
  }, [surface]);

  // 轮末 idle 边沿 → run("sync")(仅 available)。
  const firstSync = React.useRef(true);
  React.useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    if (available && surface !== undefined) {
      void surface.run(DOMAIN, "sync");
    }
  }, [syncSignal, available, surface]);

  const assets: readonly GalleryAsset[] = available
    ? (snap?.assets ?? [])
    : (historyImages ?? []);

  // 客户端分页(over 轻量快照列表)。
  const pageSize = CANVAS_PAGE_SIZE[view.density];
  const pageCount = Math.max(1, Math.ceil(assets.length / pageSize));
  const page = Math.min(view.page, pageCount - 1);
  const pageAssets = assets.slice(page * pageSize, page * pageSize + pageSize);

  // 分组(UI 本地派生;不发命令)。
  const groups = React.useMemo(() => {
    if (view.group === "none") return [{ key: "", items: pageAssets }];
    const map = new Map<string, GalleryAsset[]>();
    for (const a of pageAssets) {
      const key = view.group === "time" ? dayOf(a.createdAt) : lineageGroupOf(a);
      const arr = map.get(key);
      if (arr === undefined) map.set(key, [a]);
      else arr.push(a);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [pageAssets, view.group]);

  const gridClass =
    view.density === "overview"
      ? "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
      : view.density === "waterfall"
        ? "columns-[160px] gap-3 [&>*]:mb-3"
        : "mx-auto grid w-full max-w-2xl grid-cols-1 gap-3";

  return (
    <div
      data-canvas-gallery
      data-canvas-available={String(available)}
      data-canvas-density={view.density}
      data-canvas-page={String(page)}
      className="flex flex-col gap-3 p-3"
    >
      {/* 密度切换 + 分组(UI 本地)。 */}
      <div className="flex items-center gap-1 border-b border-[hsl(var(--border))] pb-2 text-xs">
        {(Object.keys(DENSITY_LABEL) as CanvasDensity[]).map((d) => (
          <button
            key={d}
            type="button"
            data-canvas-density-btn={d}
            aria-pressed={view.density === d}
            onClick={() => view.setDensity(d)}
            className={`rounded px-1.5 py-0.5 ${
              view.density === d
                ? "bg-[hsl(var(--accent))] font-medium"
                : "text-[hsl(var(--muted-foreground))]"
            }`}
          >
            {DENSITY_LABEL[d]}
          </button>
        ))}
        <span className="mx-1 opacity-30">·</span>
        {(["time", "lineage", "none"] as const).map((g) => (
          <button
            key={g}
            type="button"
            data-canvas-group-btn={g}
            aria-pressed={view.group === g}
            onClick={() => view.setGroup(g)}
            className={`rounded px-1.5 py-0.5 ${
              view.group === g
                ? "bg-[hsl(var(--accent))] font-medium"
                : "text-[hsl(var(--muted-foreground))]"
            }`}
          >
            {g === "time" ? "时间" : g === "lineage" ? "血缘" : "全部"}
          </button>
        ))}
      </div>

      {!available ? (
        <div
          data-canvas-degraded
          className="rounded bg-[hsl(var(--muted)/0.4)] px-2 py-1 text-xs text-[hsl(var(--muted-foreground))]"
        >
          只读图库(该 source 未提供 canvas surface;A 档禁用)
        </div>
      ) : null}

      {assets.length === 0 ? (
        <div data-canvas-empty className="px-2 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
          暂无图片
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.key || "_"} data-canvas-group={group.key}>
            {view.group !== "none" && group.key !== "" ? (
              <div className="mb-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                {group.key}
              </div>
            ) : null}
            <div className={gridClass}>
              {group.items.map((a) => (
                <button
                  key={a.attachmentId}
                  type="button"
                  data-canvas-cell
                  data-att-id={a.attachmentId}
                  onClick={() => onOpenAsset?.(a.attachmentId)}
                  className="group relative block overflow-hidden rounded-lg border border-[hsl(var(--border))] shadow-sm transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.displayUrl}
                    alt={a.name}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                  {a.derivedFrom !== undefined ? (
                    <span
                      data-canvas-cell-derived
                      className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white"
                    >
                      派生
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {/* 客户端分页。 */}
      {pageCount > 1 ? (
        <div data-canvas-pager className="flex items-center justify-center gap-2 text-xs">
          <button
            type="button"
            data-canvas-prev
            disabled={page <= 0}
            onClick={() => view.setPage(page - 1)}
            className="rounded px-2 py-0.5 disabled:opacity-40"
          >
            上一页
          </button>
          <span data-canvas-page-indicator>
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            data-canvas-next
            disabled={page >= pageCount - 1}
            onClick={() => view.setPage(page + 1)}
            className="rounded px-2 py-0.5 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
