/**
 * MediaPreviewHost —— 对话内媒体预览宿主(webext `dialogLayer` 槽)。
 *
 * 复刻独立仓 aigc-agent `components/image-lightbox.tsx` 的 `MediaLightbox` + `MediaPreviewHost`
 * (:83-396):① 监听 `aigc-media-preview` 事件开灯箱;② 对话内图点击 → 以**会话内全部图**为图库
 * 开灯箱(左右切换跨整段对话);③ hover 浮出 pill(编辑→画布 / 下载 / 多图卡「下载全部」)。
 *
 * 锚点用宿主自带的稳定 data 属性,不猜 class:
 *   `[data-pi-response] img`     普通气泡与 Markdown 正文里的图(packages/ui response.tsx:59)
 *   `[data-pi-tool-images] img`  工具产出卡里的图(packages/ui pi-tool-part.tsx:437)
 *   `[data-pi-chat-messages]`    对话列容器(图库范围;不牵扯侧栏 / pane 里的图)
 * —— 与源项目的选择器逐字相同,只是 `.aigc-main` 换成本仓的对话列属性。
 *
 * 与源项目唯一的**架构性差异**:「编辑→画布」。源项目派 DOM 事件 `aigc-open-canvas-asset` 给同页
 * 的画布组件;本仓画布活在隔离 iframe pane 里,宿主的 DOM 事件到不了它。故改走宿主会话能力
 * `conversation.submitUserMessage` 让助手去调画布工具 —— 与素材 pane 的「在画布编辑」同一条
 * 零扩权路径(操作留痕对话历史,可审计)。宿主未注入 conversation 时该按钮不呈现(降级,不报错)。
 *
 * 灯箱本身是纯展示件,与 pane 侧 `web/panes/image-lightbox.tsx` 交互一致但**不共用代码**:
 * 那份跑在隔离 iframe 内、吃 PANE_CSS 的裸类名;这份在宿主页面里,类名须经 `c()` 加扩展前缀
 * (见 packages/web-kit/build/css-scope-plugin.ts 的 scopeCss)。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  Maximize,
  Pencil,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ConversationAccess, SlotRenderProps } from "@blksails/pi-web-kit";
import { c } from "./cls.js";

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

/** 对话内可预览的图:工具产出卡 + 普通气泡(两处皆宿主自带 data 属性)。 */
const PREVIEW_IMG_SELECTOR = "[data-pi-response] img, [data-pi-tool-images] img";
/** 图库范围 = 对话列容器;取不到则退回整个 document。 */
const MESSAGES_SELECTOR = "[data-pi-chat-messages]";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

/** 编程式开预览(其它 webext 组件可用):派窗口事件,本宿主接管。 */
export function openImagePreview(detail: PreviewDetail): void {
  window.dispatchEvent(new CustomEvent<PreviewDetail>(MEDIA_PREVIEW_EVENT, { detail }));
}

/** 从附件 URL 抽公开 id(`att_<base64url>`,见 packages/server attachments/id.ts)。 */
export function attachmentIdFromUrl(url: string): string | undefined {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}

/** 取字节强制下载(WebP 等原样落盘);取不到字节回落新开页。 */
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

const srcOf = (el: HTMLImageElement): string => (el.currentSrc !== "" ? el.currentSrc : el.src);

/** 展示型灯箱:左右切换(‹ › + ←/→)、滚轮缩放、放大后拖拽平移、旋转、翻转、复位。 */
function MediaLightbox({
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

  const transform =
    `translate(${pan.x}px, ${pan.y}px)` +
    ` scale(${scale * (flipH ? -1 : 1)}, ${scale * (flipV ? -1 : 1)})` +
    ` rotate(${rot}deg)`;

  return createPortal(
    <div className={c("ilb")} role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className={c("ilb-x")} aria-label="关闭预览" onClick={onClose}>
        <X size={18} />
      </button>

      {hasPrev ? (
        <button
          type="button"
          className={`${c("ilb-nav")} ${c("left")}`}
          aria-label="上一张"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index - 1);
          }}
        >
          <ChevronLeft size={26} />
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className={`${c("ilb-nav")} ${c("right")}`}
          aria-label="下一张"
          onClick={(e) => {
            e.stopPropagation();
            onIndex(index + 1);
          }}
        >
          <ChevronRight size={26} />
        </button>
      ) : null}

      <div
        className={c("ilb-stage")}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          setScale((s) =>
            Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))),
          );
        }}
      >
        <img
          className={c("ilb-img")}
          src={cur.url}
          alt={cur.name ?? ""}
          draggable={false}
          referrerPolicy="no-referrer"
          style={{ transform, cursor: scale > 1 ? "grab" : "default" }}
          onPointerDown={(e) => {
            if (scale <= 1) return;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d === null) return;
            setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onLoad={(e) =>
            setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        />
      </div>

      <div className={c("ilb-tools")} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="缩小"
          onClick={() => setScale((s) => Math.max(ZOOM_MIN, s / 1.2))}
        >
          <ZoomOut size={16} />
        </button>
        <span className={c("pct")}>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          title="放大"
          onClick={() => setScale((s) => Math.min(ZOOM_MAX, s * 1.2))}
        >
          <ZoomIn size={16} />
        </button>
        <span className={c("sep")} />
        <button type="button" title="逆时针旋转" onClick={() => setRot((r) => r - 90)}>
          <RotateCcw size={16} />
        </button>
        <button type="button" title="顺时针旋转" onClick={() => setRot((r) => r + 90)}>
          <RotateCw size={16} />
        </button>
        <button
          type="button"
          title="水平翻转"
          className={flipH ? c("on") : undefined}
          onClick={() => setFlipH((v) => !v)}
        >
          <FlipHorizontal2 size={16} />
        </button>
        <button
          type="button"
          title="垂直翻转"
          className={flipV ? c("on") : undefined}
          onClick={() => setFlipV((v) => !v)}
        >
          <FlipVertical2 size={16} />
        </button>
        <span className={c("sep")} />
        <button type="button" title="复位" onClick={reset}>
          <Maximize size={16} />
        </button>
        <span className={c("sep")} />
        <button
          type="button"
          title="下载"
          onClick={() => void downloadImage(cur.url, cur.name ?? "image")}
        >
          <Download size={16} />
        </button>
      </div>

      {items.length > 1 ? (
        <div className={c("ilb-count")}>
          {index + 1} / {items.length}
        </div>
      ) : null}
      {dims !== null ? (
        <div className={c("ilb-dims")}>
          {dims.w}×{dims.h}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

type HostProps = SlotRenderProps & { readonly conversation?: ConversationAccess };

export function MediaPreviewHost(props: HostProps): React.JSX.Element {
  const { conversation } = props;
  const [state, setState] = React.useState<{
    items: readonly PreviewItem[];
    index: number;
  } | null>(null);
  const [pill, setPill] = React.useState<{
    url: string;
    name: string;
    rect: { top: number; right: number };
    siblings: readonly PreviewItem[];
  } | null>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // ① 事件驱动:给了图库就用图库,否则回退单图。
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

  // ② 对话内图点击 → 以会话内全部图为图库开灯箱。捕获阶段拦,免与内核自带行为打架。
  React.useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const img = target?.closest("img");
      if (img === null || img === undefined || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      if (target?.closest("button, a") !== null) return; // pill / 链接交回各自 handler
      e.preventDefault();
      e.stopPropagation();
      const scope = img.closest(MESSAGES_SELECTOR) ?? document;
      const all = [...scope.querySelectorAll<HTMLImageElement>(PREVIEW_IMG_SELECTOR)];
      setState({
        items: all.map((el) => ({ url: srcOf(el), name: el.alt })),
        index: Math.max(0, all.indexOf(img as HTMLImageElement)),
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // ③ hover → pill 贴图右上角;进 pill 不收、离图延时收(留出移进去点的时间)。
  React.useEffect(() => {
    const cancelHide = (): void => {
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
    const onOver = (e: MouseEvent): void => {
      const img = (e.target as Element | null)?.closest("img");
      if (img === null || img === undefined || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      cancelHide();
      const r = img.getBoundingClientRect();
      // 「下载全部」的范围 = 同一张卡 / 同一条回复里的图。
      const container = img.closest("[data-pi-response], [data-pi-tool-images]");
      const sibs =
        container !== null
          ? [...container.querySelectorAll<HTMLImageElement>("img")]
          : [img as HTMLImageElement];
      setPill({
        url: srcOf(img as HTMLImageElement),
        name: (img as HTMLImageElement).alt,
        rect: { top: r.top, right: r.right },
        siblings: sibs.map((el) => ({ url: srcOf(el), name: el.alt })),
      });
    };
    const onOut = (e: MouseEvent): void => {
      const img = (e.target as Element | null)?.closest("img");
      if (img === null || img === undefined || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      cancelHide();
      hideTimer.current = setTimeout(() => setPill(null), 160);
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

  /** 零扩权送画布:经对话交给助手,不直呼画布 pane(它在隔离 iframe 里,也不该被宿主直驱)。 */
  const editInCanvas = (url: string): void => {
    const attId = attachmentIdFromUrl(url);
    if (attId === undefined || conversation === undefined) return;
    setPill(null);
    conversation.submitUserMessage("把这张图放到画布上,我要编辑", { attachmentIds: [attId] });
  };

  const canEdit =
    pill !== null && conversation !== undefined && attachmentIdFromUrl(pill.url) !== undefined;

  return (
    <>
      {pill !== null
        ? createPortal(
            <div
              className={c("img-pill")}
              style={{
                top: pill.rect.top + 8,
                left: Math.min(pill.rect.right - 8, window.innerWidth - 8),
              }}
              onMouseEnter={() => {
                if (hideTimer.current !== null) {
                  clearTimeout(hideTimer.current);
                  hideTimer.current = null;
                }
              }}
              onMouseLeave={() => setPill(null)}
            >
              {canEdit ? (
                <button
                  type="button"
                  title="在画布编辑(经对话交给助手)"
                  onClick={() => editInCanvas(pill.url)}
                >
                  <Pencil size={13} /> 编辑
                </button>
              ) : null}
              <button
                type="button"
                title="下载"
                onClick={() => void downloadImage(pill.url, pill.name)}
              >
                <Download size={13} /> 下载
              </button>
              {pill.siblings.length > 1 ? (
                <button
                  type="button"
                  title="下载本卡全部"
                  onClick={() => {
                    const all = pill.siblings;
                    void (async () => {
                      for (const s of all) await downloadImage(s.url, s.name ?? "image");
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
        <MediaLightbox
          items={state.items}
          index={state.index}
          onIndex={onIndex}
          onClose={() => setState(null)}
        />
      ) : null}
    </>
  );
}
