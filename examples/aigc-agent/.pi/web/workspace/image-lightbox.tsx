// [迁移壳层] 源:aigc-agent components/image-lightbox.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  X,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  ZoomIn,
  ZoomOut,
  Maximize,
} from "lucide-react";

/**
 * 富预览灯箱 + 会话级预览宿主(承接 pi-labs MediaLightbox/MediaPreviewHost,并新增缩放/旋转/翻转)。
 *
 * - `ImageLightbox`:展示型灯箱。左右切换(◁▷ + ←/→)、滚轮缩放、放大后拖拽平移、旋转 90°、水平/垂直翻转、
 *   复位、右下角尺寸/计数、Esc/点遮罩/✕ 关闭。素材抽屉与对话共用同一件(视觉/交互一致)。
 * - `MediaPreviewHost`:挂一次于对话根。① 监听 `aigc-media-preview` 事件开灯箱;② 对话内图(工具产出卡 +
 *   气泡,均在 `[data-pi-response] img`)点击 → 以**会话内全部图**为图库开灯箱(左右切换跨整段对话);
 *   ③ hover 浮出毛玻璃 pill(编辑→画布 / 下载 / 多图卡『下载全部』)。
 *
 * 图片永远以 URL/attachmentId 引用,不进 base64。
 */

export const MEDIA_PREVIEW_EVENT = "aigc-media-preview";

export interface PreviewItem {
  readonly url: string;
  readonly name?: string;
}
interface PreviewDetail {
  readonly url?: string;
  readonly gallery?: readonly PreviewItem[];
  readonly index?: number;
}

/** 对话内可预览的图选择器:工具产出卡 + 普通气泡都经 vendor `<Response>`(.prose)渲染。 */
const PREVIEW_IMG_SELECTOR = "[data-pi-response] img, [data-pi-tool-images] img";

/** 编程式开预览(卡片 pill / 其它组件用):派发窗口事件,宿主接管。 */
export function openImagePreview(detail: PreviewDetail): void {
  window.dispatchEvent(new CustomEvent<PreviewDetail>(MEDIA_PREVIEW_EVENT, { detail }));
}

function attachmentIdFromUrl(url: string): string | undefined {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}

/** 取字节强制下载(WebP 等原样);取失败回落新开页。 */
async function downloadImage(url: string, name: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name !== "" ? name : "image";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noreferrer");
  }
}

function openInCanvas(url: string): void {
  const attId = attachmentIdFromUrl(url);
  if (attId === undefined) return;
  document.dispatchEvent(
    new CustomEvent("aigc-open-canvas-asset", { detail: { attachmentId: attId } }),
  );
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

export function ImageLightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  readonly items: readonly PreviewItem[];
  readonly index: number;
  readonly onIndex: (i: number) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const cur = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  // 视图变换态:缩放 / 旋转(度)/ 水平·垂直翻转 / 平移;切图时全复位。
  const [scale, setScale] = React.useState(1);
  const [rot, setRot] = React.useState(0);
  const [flipH, setFlipH] = React.useState(false);
  const [flipV, setFlipV] = React.useState(false);
  const [pan, setPan] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const drag = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const reset = React.useCallback((): void => {
    setScale(1);
    setRot(0);
    setFlipH(false);
    setFlipV(false);
    setPan({ x: 0, y: 0 });
  }, []);
  React.useEffect(() => reset(), [cur?.url, reset]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onIndex(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onIndex(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onIndex, onClose]);

  if (cur === undefined) return null;

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    setScale((s) => {
      const next = s * (e.deltaY < 0 ? 1.12 : 1 / 1.12);
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    });
  };
  const onPointerDown = (e: React.PointerEvent): void => {
    if (scale <= 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (d === null) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale * (flipH ? -1 : 1)}, ${scale * (flipV ? -1 : 1)}) rotate(${rot}deg)`;

  return createPortal(
    <div className="aigc-ilb" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="aigc-ilb-x" aria-label="关闭预览" onClick={onClose}>
        <X size={18} />
      </button>

      {hasPrev ? (
        <button
          type="button"
          className="aigc-ilb-nav left"
          aria-label="上一张"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index - 1);
          }}
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className="aigc-ilb-nav right"
          aria-label="下一张"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index + 1);
          }}
        >
          <ChevronRight size={24} />
        </button>
      ) : null}

      <div
        className="aigc-ilb-stage"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
      >
        <img
          className="aigc-ilb-img"
          src={cur.url}
          alt={cur.name ?? ""}
          draggable={false}
          referrerPolicy="no-referrer"
          style={{ transform, cursor: scale > 1 ? "grab" : "default" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLoad={(e) =>
            setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        />
      </div>

      {/* 工具条:缩放/旋转/翻转/复位(毛玻璃底,承接预览增强诉求)。 */}
      <div className="aigc-ilb-tools" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="缩小" onClick={() => setScale((s) => Math.max(ZOOM_MIN, s / 1.2))}>
          <ZoomOut size={16} />
        </button>
        <span className="pct">{Math.round(scale * 100)}%</span>
        <button type="button" title="放大" onClick={() => setScale((s) => Math.min(ZOOM_MAX, s * 1.2))}>
          <ZoomIn size={16} />
        </button>
        <span className="sep" />
        <button type="button" title="逆时针旋转" onClick={() => setRot((r) => r - 90)}>
          <RotateCcw size={16} />
        </button>
        <button type="button" title="顺时针旋转" onClick={() => setRot((r) => r + 90)}>
          <RotateCw size={16} />
        </button>
        <button type="button" title="水平翻转" className={flipH ? "on" : ""} onClick={() => setFlipH((v) => !v)}>
          <FlipHorizontal2 size={16} />
        </button>
        <button type="button" title="垂直翻转" className={flipV ? "on" : ""} onClick={() => setFlipV((v) => !v)}>
          <FlipVertical2 size={16} />
        </button>
        <span className="sep" />
        <button type="button" title="复位" onClick={reset}>
          <Maximize size={16} />
        </button>
      </div>

      {items.length > 1 ? (
        <div className="aigc-ilb-count">
          {index + 1} / {items.length}
        </div>
      ) : null}
      {dims !== null ? (
        <div className="aigc-ilb-dims">
          {dims.w}×{dims.h}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * 会话级预览宿主 + 对话内图片操作 pill。挂一次于对话根。
 */
export function MediaPreviewHost(): React.JSX.Element | null {
  const [state, setState] = React.useState<{ items: PreviewItem[]; index: number } | null>(null);
  // hover pill 目标:当前悬停的对话内图 + 其屏幕位置 + 所属容器图数(多图才显示「下载全部」)。
  const [pill, setPill] = React.useState<{
    url: string;
    name: string;
    rect: { top: number; left: number; right: number };
    siblings: PreviewItem[];
  } | null>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // 事件驱动:openImagePreview 派发 → 直接用给定 gallery,否则回退单图。
  React.useEffect(() => {
    const onEvt = (e: Event): void => {
      const d = (e as CustomEvent<PreviewDetail>).detail;
      if (d.gallery !== undefined && d.gallery.length > 0) {
        setState({
          items: [...d.gallery],
          index: Math.min(Math.max(d.index ?? 0, 0), d.gallery.length - 1),
        });
      } else if (d.url !== undefined) {
        setState({ items: [{ url: d.url }], index: 0 });
      }
    };
    window.addEventListener(MEDIA_PREVIEW_EVENT, onEvt);
    return () => window.removeEventListener(MEDIA_PREVIEW_EVENT, onEvt);
  }, []);

  // 对话内图点击 → 以会话内全部图为图库开预览(左右切换跨整段对话)。捕获阶段拦,避免 vendor 自带行为。
  React.useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const img = target?.closest("img");
      if (img === null || img === undefined || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      if (target?.closest("button, a")) return; // pill/链接交回各自 handler
      e.preventDefault();
      e.stopPropagation();
      // 图库范围 = 所在对话列内全部图(左右切换跨整段对话,不牵扯侧栏/画布里的图)。
      const scope = img.closest(".aigc-main") ?? document;
      const all = Array.from(scope.querySelectorAll<HTMLImageElement>(PREVIEW_IMG_SELECTOR));
      const items: PreviewItem[] = all.map((el) => ({ url: el.currentSrc || el.src, name: el.alt }));
      const idx = Math.max(0, all.indexOf(img as HTMLImageElement));
      setState({ items, index: idx });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // hover → 定位 pill 到图右上角;进 pill 不收、离开延时收(可点到按钮)。
  React.useEffect(() => {
    const cancelHide = (): void => {
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
    const scheduleHide = (): void => {
      cancelHide();
      hideTimer.current = setTimeout(() => setPill(null), 160);
    };
    const onOver = (e: MouseEvent): void => {
      const img = (e.target as Element | null)?.closest("img");
      if (img === null || img === undefined || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      cancelHide();
      const r = img.getBoundingClientRect();
      const container = img.closest("[data-pi-response], [data-pi-tool-images]");
      const sibEls = container
        ? Array.from(container.querySelectorAll<HTMLImageElement>("img"))
        : [img as HTMLImageElement];
      setPill({
        url: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src,
        name: (img as HTMLImageElement).alt,
        rect: { top: r.top, left: r.left, right: r.right },
        siblings: sibEls.map((el) => ({ url: el.currentSrc || el.src, name: el.alt })),
      });
    };
    const onOut = (e: MouseEvent): void => {
      const img = (e.target as Element | null)?.closest("img");
      if (img !== null && img !== undefined && img.matches(PREVIEW_IMG_SELECTOR)) scheduleHide();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      cancelHide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  const onIndex = React.useCallback(
    (i: number) => setState((s) => (s !== null ? { ...s, index: i } : s)),
    [],
  );

  return (
    <>
      {pill !== null
        ? createPortal(
            <div
              className="aigc-img-pill"
              style={{ top: pill.rect.top + 8, left: Math.min(pill.rect.right - 8, window.innerWidth - 8), transform: "translateX(-100%)" }}
              onMouseEnter={() => {
                if (hideTimer.current !== null) {
                  clearTimeout(hideTimer.current);
                  hideTimer.current = null;
                }
              }}
              onMouseLeave={() => setPill(null)}
            >
              {attachmentIdFromUrl(pill.url) !== undefined ? (
                <button type="button" title="在画布编辑" onClick={() => openInCanvas(pill.url)}>
                  编辑
                </button>
              ) : null}
              <button type="button" title="下载" onClick={() => void downloadImage(pill.url, pill.name)}>
                下载
              </button>
              {pill.siblings.length > 1 ? (
                <button
                  type="button"
                  title="下载本卡全部"
                  onClick={() => {
                    void (async () => {
                      for (const s of pill.siblings) await downloadImage(s.url, s.name ?? "image");
                    })();
                  }}
                >
                  下载全部 {pill.siblings.length}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {state !== null ? (
        <ImageLightbox
          items={state.items}
          index={state.index}
          onIndex={onIndex}
          onClose={() => setState(null)}
        />
      ) : null}
    </>
  );
}
