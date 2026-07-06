/**
 * CanvasLauncher / CanvasPanel — 入口 + 面板挂载(aigc-canvas · Req 10.x)。
 *
 * **由 source 声明驱动,免全局门控**:agent source 在 `.pi/web` 把这两个组件挂到
 * launcherRail / panelRight 槽,即视为"要用 Canvas"——组件被挂载即显示(`enabled` 默认 true)。
 * 非 AIGC source 不声明这些槽 → 自然不挂载(独立性由声明缺席保证,而非 env 开关)。
 *
 * - **CanvasLauncher**(launcherRail 具名槽):渲染入口按钮,点击经跨 slot 共享的
 *   `canvasOpenStore` 开合画廊面板(激活/关闭回收视图)。
 * - **CanvasPanel**(panelRight 具名槽):宿主经 prop 注入 `surface`(launcherRail slot 拿不到 surface,
 *   故交互画廊 / 工作台落在有 surface 的 panelRight 区);读 `canvasOpen` 开合,展开 CanvasGallery,
 *   点格子展开 CanvasWorkbench,关闭回画廊。
 *
 * 两个 slot 是不同子树,经 module-level `canvasOpenStore` 联动(同一 app bundle 内共享)。
 */
import * as React from "react";
import type { WebExtSurfaceAccess, ConversationAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset, GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import { CanvasGallery } from "./canvas-gallery.js";
import { CanvasWorkbench } from "./canvas-workbench.js";
import { useCanvasOpen } from "./use-canvas-view.js";
import type { UploadFn } from "@blksails/pi-web-canvas-kit";

const DOMAIN = "canvas";
const STATE_KEY = `surface:${DOMAIN}`;

/**
 * @deprecated Canvas 显示已改为 source 声明驱动(挂 slot 即显示),不再依赖此 env 门控。
 * 保留仅为向后兼容 / 可选的强制覆盖读取:`NEXT_PUBLIC_PI_WEB_CANVAS === "true" || "1"`。
 */
export function isCanvasEnabled(): boolean {
  if (typeof process === "undefined") return false;
  const v = process.env?.NEXT_PUBLIC_PI_WEB_CANVAS;
  return v === "true" || v === "1";
}

export interface CanvasLauncherProps {
  readonly extId?: string;
  readonly surface?: WebExtSurfaceAccess;
  /** 测试 / 强制覆盖门控(缺省读 env)。 */
  readonly enabled?: boolean;
}

/** launcherRail 入口按钮(被 source 声明挂载即显示;`enabled` 显式传可覆盖,如强制关)。 */
export function CanvasLauncher({ enabled }: CanvasLauncherProps): React.JSX.Element | null {
  const on = enabled ?? true;
  const { open, toggle } = useCanvasOpen();
  if (!on) return null;
  return (
    <button
      type="button"
      data-canvas-launcher
      aria-expanded={open}
      onClick={toggle}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-[hsl(var(--accent))]"
    >
      <span aria-hidden>🖼️</span>
      <span>Canvas 画廊</span>
    </button>
  );
}

export interface CanvasPanelProps {
  readonly extId?: string;
  readonly surface?: WebExtSurfaceAccess;
  readonly enabled?: boolean;
  /** 轮末 idle 边沿信号(透传 CanvasGallery → run("sync"))。 */
  readonly syncSignal?: unknown;
  /** 退化态图库来源(消息历史图片)。 */
  readonly historyImages?: readonly GalleryAsset[];
  /** 带入对话(Prompt 注入 att_id)。 */
  readonly onBringToConversation?: (attachmentId: string) => void;
  // ── B 档上传接缝(可注入)────────────────────────────────────────────────────
  readonly upload?: UploadFn;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  /** 会话能力对象(契约 §4.2;canvas 生成走对话流经此提交,取代 onSubmitPrompt)。 */
  readonly conversation?: ConversationAccess;
  /**
   * 经宿主 Prompt 通道发用户消息(canvas 生成走对话流,LLM 调工具执行)。
   * @deprecated 使用 `conversation`(过渡别名,行为等价)。
   */
  readonly onSubmitPrompt?: (text: string) => void;
  /** 宿主转发的当前轮流式图像预览(由糊变清);配合 surface `livePreview.stage` 显示渐进图。 */
  readonly livePreviewImage?: string;
}

/** panelRight 画廊 / 工作台面板(门控关或未开 → null)。 */
export function CanvasPanel({
  surface,
  enabled,
  syncSignal,
  historyImages,
  onBringToConversation,
  upload,
  baseUrl,
  sessionId,
  conversation,
  onSubmitPrompt,
  livePreviewImage,
}: CanvasPanelProps): React.JSX.Element | null {
  const on = enabled ?? true;
  const { open, setOpen } = useCanvasOpen();
  const [openId, setOpenId] = React.useState<string | null>(null);

  // 「点 chat 生成图 → 进 Canvas 编辑」:对话流工具卡的图带通用 `data-att-id`(见 pi-tool-part),
  // 这里挂 document 级**委托监听**——命中即开面板并把工作台切到该 att_id(此时面板可能仍关闭,故
  // 监听须在早返回之前、恒常挂载)。asset 生成后经 idle 边沿 sync 已进画廊 `assets`;openId 具粘性,
  // 万一点击早于 sync,待 asset 到达即自动展开工作台。canvas 关闭态(!on)不接管。
  React.useEffect(() => {
    if (!on) return undefined;
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      const img = target?.closest?.("img[data-att-id]") as HTMLElement | null;
      if (img === null || img === undefined) return;
      if (img.closest("[data-pi-tool-images]") === null) return; // 仅工具卡图片
      const id = img.getAttribute("data-att-id");
      if (id === null || id === "") return;
      setOpenId(id);
      setOpen(true);
    };
    document.addEventListener("click", onDocClick);
    // canvas 活跃期给 body 打标记 → 工具图悬浮态显「可点」affordance(见 styles.css)。
    document.body.setAttribute("data-canvas-tool-image-clickable", "true");
    return () => {
      document.removeEventListener("click", onDocClick);
      document.body.removeAttribute("data-canvas-tool-image-clickable");
    };
  }, [on, setOpen]);

  if (!on || !open) return null;

  const snap = surface?.getState<GalleryState>(STATE_KEY);
  const assets: readonly GalleryAsset[] = snap?.assets ?? historyImages ?? [];
  const workbenchAsset = openId !== null ? assets.find((a) => a.attachmentId === openId) : undefined;

  return (
    <div
      data-canvas-panel
      className="pi-scrollbar-ghost flex h-full min-h-0 flex-col overflow-y-auto animate-in fade-in-0 duration-200"
    >
      {workbenchAsset !== undefined ? (
        <CanvasWorkbench
          {...(surface !== undefined ? { surface } : {})}
          asset={workbenchAsset}
          assets={assets}
          onClose={() => setOpenId(null)}
          {...(onBringToConversation !== undefined ? { onBringToConversation } : {})}
          {...(upload !== undefined ? { upload } : {})}
          {...(baseUrl !== undefined ? { baseUrl } : {})}
          {...(sessionId !== undefined ? { sessionId } : {})}
          {...(conversation !== undefined ? { conversation } : {})}
          {...(onSubmitPrompt !== undefined ? { onSubmitPrompt } : {})}
          {...(livePreviewImage !== undefined ? { livePreviewImage } : {})}
          {...(syncSignal !== undefined ? { syncSignal } : {})}
        />
      ) : (
        <CanvasGallery
          {...(surface !== undefined ? { surface } : {})}
          {...(historyImages !== undefined ? { historyImages } : {})}
          {...(syncSignal !== undefined ? { syncSignal } : {})}
          {...(livePreviewImage !== undefined ? { livePreviewImage } : {})}
          onOpenAsset={(id) => setOpenId(id)}
        />
      )}
    </div>
  );
}
