/**
 * ImageLightbox —— pane 内的富预览灯箱。
 *
 * 复刻独立仓 aigc-agent `components/image-lightbox.tsx` 的 `ImageLightbox`(:83-246):
 * 左右切换(‹ › + ←/→)、滚轮缩放、放大后拖拽平移、旋转 90°、水平/垂直翻转、复位、
 * 右下角原始尺寸 + 计数、Esc / 点遮罩 / ✕ 关闭;切图时视图变换全复位。
 *
 * 按本仓架构重写:pane guest 在隔离 iframe 内、不 bundle 图标库(PANE_CSS 那套纯手写样式),
 * 故图标用文本符号而非 lucide;图片永远以 URL 引用,不进 base64。
 * 无 allow-modals / allow-downloads 的约束由调用方处理,本组件只做展示与视图变换。
 */
import * as React from "react";
import { createPortal } from "react-dom";

export interface PreviewItem {
  readonly url: string;
  readonly name?: string;
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
    setScale((s) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
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

  const transform =
    `translate(${pan.x}px, ${pan.y}px)` +
    ` scale(${scale * (flipH ? -1 : 1)}, ${scale * (flipV ? -1 : 1)})` +
    ` rotate(${rot}deg)`;

  return createPortal(
    <div className="ilb" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="ilb-x" aria-label="关闭预览" onClick={onClose}>
        ✕
      </button>

      {hasPrev ? (
        <button
          type="button"
          className="ilb-nav left"
          aria-label="上一张"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index - 1);
          }}
        >
          ‹
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className="ilb-nav right"
          aria-label="下一张"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index + 1);
          }}
        >
          ›
        </button>
      ) : null}

      <div className="ilb-stage" onClick={(e) => e.stopPropagation()} onWheel={onWheel}>
        <img
          className="ilb-img"
          src={cur.url}
          alt={cur.name ?? ""}
          draggable={false}
          referrerPolicy="no-referrer"
          style={{ transform, cursor: scale > 1 ? "grab" : "default" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      </div>

      {/* 工具条:缩放 / 旋转 / 翻转 / 复位。 */}
      <div className="ilb-tools" onClick={(e) => e.stopPropagation()}>
        <button type="button" title="缩小" onClick={() => setScale((s) => Math.max(ZOOM_MIN, s / 1.2))}>
          －
        </button>
        <span className="pct">{Math.round(scale * 100)}%</span>
        <button type="button" title="放大" onClick={() => setScale((s) => Math.min(ZOOM_MAX, s * 1.2))}>
          ＋
        </button>
        <span className="sep" />
        <button type="button" title="逆时针旋转" onClick={() => setRot((r) => r - 90)}>
          ↺
        </button>
        <button type="button" title="顺时针旋转" onClick={() => setRot((r) => r + 90)}>
          ↻
        </button>
        <button type="button" title="水平翻转" className={flipH ? "on" : ""} onClick={() => setFlipH((v) => !v)}>
          ⇋
        </button>
        <button type="button" title="垂直翻转" className={flipV ? "on" : ""} onClick={() => setFlipV((v) => !v)}>
          ⇵
        </button>
        <span className="sep" />
        <button type="button" title="复位" onClick={reset}>
          ⤢
        </button>
      </div>

      {items.length > 1 ? (
        <div className="ilb-count">
          {index + 1} / {items.length}
        </div>
      ) : null}
      {dims !== null ? (
        <div className="ilb-dims">
          {dims.w}×{dims.h}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
