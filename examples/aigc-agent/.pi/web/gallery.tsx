/**
 * AigcGallery — 自建画廊(替代 vendor CanvasGallery,承接原型 §2.2 的交互/展示)。
 *
 * 读同一 surface 的 `GalleryState.assets`(由父面板订阅后传入),自建六视图:
 * 概览(网格)/ 瀑布流(masonry)/ 聚焦(大图适配 + ◁▷)/ 时间(按日分组)/ 血缘(derivedFrom 分组)/ 全部。
 * 缩略图 hover 上浮 + 底部标签 + hover 显「编辑」;点缩略图 = 打开进画布(工作台标签)。
 * 纯黑白单色(token 取自祖先 .aigc-shell);图片以 displayUrl 引用,绝不 base64。
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";

type ViewMode =
  | "overview"
  | "masonry"
  | "focus"
  | "time"
  | "lineage"
  | "all";

const TABS: ReadonlyArray<{ m: ViewMode; label: string; sepBefore?: boolean }> =
  [
    { m: "overview", label: "概览" },
    { m: "masonry", label: "瀑布流" },
    { m: "focus", label: "聚焦" },
    { m: "time", label: "时间", sepBefore: true },
    { m: "lineage", label: "血缘" },
    { m: "all", label: "全部", sepBefore: true },
  ];

/** 资产展示名:name > 派生标记 > 序号。 */
function labelOf(a: GalleryAsset, i: number): string {
  if (a.name !== undefined && a.name !== "") return a.name;
  if (a.derivedFrom !== undefined && a.derivedFrom !== "")
    return `二创 …${a.derivedFrom.slice(-4)}`;
  return `图 ${i + 1}`;
}

/** 日分组 KEY(YYYY-MM-DD;客户端 Date,仅展示分组)。 */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 单个缩略图(hover 上浮 + 底部标签 + hover 显「编辑」)。 */
function Shot({
  asset,
  index,
  masonry,
  onOpen,
}: {
  readonly asset: GalleryAsset;
  readonly index: number;
  readonly masonry: boolean;
  readonly onOpen: () => void;
}): React.JSX.Element {
  const label = labelOf(asset, index);
  return (
    <button
      type="button"
      className={`aigc-shot${masonry ? " masonry" : ""}`}
      onClick={onOpen}
      // 缩略图作为拖源:携 text/att-id(拖入空白画布作主体)+ application/x-aigc-ref(富引用,
      // 拖入对话框作引用附件,与素材库缩略图同姿态)。
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/att-id", asset.attachmentId);
        e.dataTransfer.setData(
          "application/x-aigc-ref",
          JSON.stringify({
            attachmentId: asset.attachmentId,
            displayUrl: asset.displayUrl,
            name: label,
          }),
        );
      }}
      data-att-id={asset.attachmentId}
      title={label}
    >
      <img src={asset.displayUrl} alt="" draggable={false} />
      <span className="lbl">{label}</span>
      <span
        className="edit"
        role="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        编辑
      </span>
    </button>
  );
}

/** 分组网格(时间/血缘视图共用)。 */
function GroupedGrid({
  groups,
  onOpen,
}: {
  readonly groups: ReadonlyArray<{
    key: string;
    items: ReadonlyArray<{ asset: GalleryAsset; index: number }>;
  }>;
  readonly onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {groups.map((g) => (
        <React.Fragment key={g.key}>
          <div className="aigc-gal-group">{g.key}</div>
          <div className="aigc-grid">
            {g.items.map(({ asset, index }) => (
              <Shot
                key={asset.attachmentId}
                asset={asset}
                index={index}
                masonry={false}
                onOpen={() => onOpen(asset.attachmentId)}
              />
            ))}
          </div>
        </React.Fragment>
      ))}
    </>
  );
}

export function AigcGallery({
  assets,
  onOpenAsset,
  onNewBlank,
}: {
  readonly assets: readonly GalleryAsset[];
  readonly onOpenAsset: (attachmentId: string) => void;
  /** 新建空白画布(画廊态入口;工作台态由多标签条的 ＋ 承担)。 */
  readonly onNewBlank?: () => void;
}): React.JSX.Element {
  const [view, setView] = React.useState<ViewMode>("overview");
  const [focusIdx, setFocusIdx] = React.useState(0);

  // 聚焦索引收敛(资产变动时不越界)。
  React.useEffect(() => {
    if (focusIdx > assets.length - 1) setFocusIdx(Math.max(0, assets.length - 1));
  }, [focusIdx, assets.length]);

  const indexed = assets.map((asset, index) => ({ asset, index }));

  const body = ((): React.JSX.Element => {
    if (assets.length === 0) {
      return <div className="aigc-gal-empty">暂无图片 · 生成或上传后在此聚合</div>;
    }
    if (view === "focus") {
      const cur = Math.min(focusIdx, assets.length - 1);
      const a = assets[cur];
      if (a === undefined) return <div className="aigc-gal-empty">暂无图片</div>;
      return (
        <div className="aigc-gal-focus">
          <img
            src={a.displayUrl}
            alt=""
            draggable={false}
            className="aigc-gal-focus-img"
            title="点击进入画布编辑"
            onClick={() => onOpenAsset(a.attachmentId)}
          />
          {cur > 0 ? (
            <button
              type="button"
              className="aigc-focus-nav left"
              aria-label="上一张"
              onClick={() => setFocusIdx(cur - 1)}
            >
              <ChevronLeft size={22} />
            </button>
          ) : null}
          {cur < assets.length - 1 ? (
            <button
              type="button"
              className="aigc-focus-nav right"
              aria-label="下一张"
              onClick={() => setFocusIdx(cur + 1)}
            >
              <ChevronRight size={22} />
            </button>
          ) : null}
          <div className="aigc-focus-page">
            {cur + 1} / {assets.length}
          </div>
        </div>
      );
    }
    if (view === "time" || view === "lineage") {
      const map = new Map<string, { asset: GalleryAsset; index: number }[]>();
      for (const it of indexed) {
        let k: string;
        if (view === "time") {
          k = dayOf(it.asset.createdAt);
        } else if (
          it.asset.derivedFrom !== undefined &&
          it.asset.derivedFrom !== ""
        ) {
          k = `二创自 …${it.asset.derivedFrom.slice(-6)}`;
        } else {
          k = "原始生成";
        }
        (map.get(k) ?? map.set(k, []).get(k)!).push(it);
      }
      const groups = [...map.entries()].map(([key, items]) => ({ key, items }));
      return <GroupedGrid groups={groups} onOpen={onOpenAsset} />;
    }
    // overview / all / masonry
    const masonry = view === "masonry";
    return (
      <div className={masonry ? "aigc-masonry" : "aigc-grid"}>
        {indexed.map(({ asset, index }) => (
          <Shot
            key={asset.attachmentId}
            asset={asset}
            index={index}
            masonry={masonry}
            onOpen={() => onOpenAsset(asset.attachmentId)}
          />
        ))}
      </div>
    );
  })();

  return (
    <div className="aigc-gal">
      <div className="aigc-gal-tabs">
        {TABS.map((t) => (
          <React.Fragment key={t.m}>
            {t.sepBefore ? <span className="sep" /> : null}
            <button
              type="button"
              className={view === t.m ? "on" : ""}
              aria-pressed={view === t.m}
              onClick={() => setView(t.m)}
            >
              {t.label}
            </button>
          </React.Fragment>
        ))}
        {onNewBlank !== undefined ? (
          <button
            type="button"
            className="aigc-gal-newblank"
            onClick={onNewBlank}
            title="新建空白画布"
          >
            <Plus size={13} /> 空白
          </button>
        ) : null}
      </div>
      <div className={`aigc-gal-body${view === "focus" ? " focus" : ""}`}>
        {body}
      </div>
    </div>
  );
}
