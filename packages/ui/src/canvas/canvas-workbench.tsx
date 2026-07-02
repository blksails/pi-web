/**
 * CanvasWorkbench — 格子展开工作台(aigc-canvas · Req 4.1 / 4.6 / 5.2 / 5.4 / 6.x / 10.3)。
 *
 * 展开态:预览当前工作图 + A/B 档工具栏 + C 档血缘视图 + 关闭回画廊。
 *  - **A 档**:工具栏发 `surface.run("canvas", action, args)`(`args` 仅 `att_` 引用 + 文本,无二进制);
 *    `edit` / `variants`;`inpaint` 先经 B 档 mask 画布产 mask att_ 再发(B 档产物喂 A 档,Req 5.4)。
 *  - **B 档**:经 `client-image-ops` 在本地 Canvas 2D 产物 → 既有上传接缝落新 `att_` →
 *    `run("register", {attachmentId, derivedFrom, genParams})`(Req 5.2);`available===false` 时
 *    B 档仅本地呈现、**不 register**(Req 9.3)。
 *  - **带入对话**:显式动作经 Prompt 通道注入 `att_id`(默认不注入,Req 4.6)。
 *
 * slot 组件经 prop 注入 surface(领域无关搬运)。B 档上传接缝与 canvas 工厂经 props 注入(可测)。
 */
import * as React from "react";
import type { WebExtSurfaceAccess } from "@blksails/pi-web-kit";
import type { GalleryAsset } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";
import {
  createMask,
  rotateImage,
  uploadDataUri,
  type CanvasFactory,
  type ImageSourceLike,
  type UploadFn,
} from "./client-image-ops.js";
import { LineageView } from "./lineage-view.js";

const DOMAIN = "canvas";
const PROBE = `surface:${DOMAIN}`;

export interface CanvasWorkbenchProps {
  readonly surface?: WebExtSurfaceAccess;
  /** 当前工作图。 */
  readonly asset: GalleryAsset;
  /** 全部资产(供 C 档血缘视图)。 */
  readonly assets: readonly GalleryAsset[];
  readonly onClose: () => void;
  /** 带入对话(显式 Prompt 注入 att_id);缺失则不提供该动作。 */
  readonly onBringToConversation?: (attachmentId: string) => void;
  /** 复用历史参数(C 档;预填表单)。 */
  readonly onReuseParams?: (asset: GalleryAsset) => void;
  // ── B 档上传接缝(可注入,测试用)──────────────────────────────────────────────
  readonly upload?: UploadFn;
  readonly baseUrl?: string;
  readonly sessionId?: string;
  readonly canvasFactory?: CanvasFactory;
}

export function CanvasWorkbench({
  surface,
  asset,
  assets,
  onClose,
  onBringToConversation,
  onReuseParams,
  upload,
  baseUrl,
  sessionId,
  canvasFactory,
}: CanvasWorkbenchProps): React.JSX.Element {
  const available = surface !== undefined && surface.hasCommand(PROBE);
  const [prompt, setPrompt] = React.useState("");
  const [model, setModel] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  const runA = React.useCallback(
    async (action: string, extra: Record<string, unknown>): Promise<void> => {
      if (!available || surface === undefined) return;
      const args: Record<string, unknown> = { image: asset.attachmentId, prompt, ...extra };
      if (model !== "") args.model = model;
      setBusy(true);
      try {
        await surface.run(DOMAIN, action, args);
      } finally {
        setBusy(false);
      }
    },
    [available, surface, asset.attachmentId, prompt, model],
  );

  /** 当前工作图的像素尺寸(用于 B 档坐标对齐);未加载时退化占位。 */
  const sourceSize = (): { width: number; height: number; source?: CanvasImageSource } => {
    const el = imgRef.current;
    const width = el?.naturalWidth && el.naturalWidth > 0 ? el.naturalWidth : 1024;
    const height = el?.naturalHeight && el.naturalHeight > 0 ? el.naturalHeight : 1024;
    return { width, height, ...(el !== null ? { source: el } : {}) };
  };

  /** B 档:本地旋转 90° → 上传 att_ → register(乐观回流画廊)。 */
  const rotateAndRegister = React.useCallback(async (): Promise<void> => {
    if (upload === undefined) return;
    const src: ImageSourceLike = sourceSize();
    const opts = canvasFactory !== undefined ? { canvasFactory } : {};
    const dataUri = rotateImage(src, 90, opts);
    setBusy(true);
    try {
      const { attachmentId } = await uploadDataUri({
        dataUri,
        name: `rotate-${asset.name}`,
        baseUrl: baseUrl ?? "",
        sessionId: sessionId ?? "",
        upload,
      });
      // 退化态(无 surface)→ 仅本地呈现,不 register(Req 9.3)。
      if (available && surface !== undefined) {
        await surface.run(DOMAIN, "register", {
          attachmentId,
          derivedFrom: asset.attachmentId,
          genParams: { op: "rotate", degrees: 90 },
        });
      }
    } finally {
      setBusy(false);
    }
  }, [upload, canvasFactory, asset, baseUrl, sessionId, available, surface]);

  /** B 档 mask 喂 A 档 inpaint:产全图 mask(占位:整图重绘区)→ 上传 → run inpaint。 */
  const inpaintWithMask = React.useCallback(async (): Promise<void> => {
    if (!available || surface === undefined || upload === undefined) return;
    const src = sourceSize();
    const opts = canvasFactory !== undefined ? { canvasFactory } : {};
    const maskUri = createMask(
      { width: src.width, height: src.height },
      [{ x: 0, y: 0, width: src.width, height: src.height }],
      opts,
    );
    setBusy(true);
    try {
      const { attachmentId: maskId } = await uploadDataUri({
        dataUri: maskUri,
        name: `mask-${asset.name}`,
        baseUrl: baseUrl ?? "",
        sessionId: sessionId ?? "",
        upload,
      });
      const args: Record<string, unknown> = {
        image: asset.attachmentId,
        mask: maskId,
        prompt,
      };
      if (model !== "") args.model = model;
      await surface.run(DOMAIN, "inpaint", args);
    } finally {
      setBusy(false);
    }
  }, [available, surface, upload, canvasFactory, asset, baseUrl, sessionId, prompt, model]);

  return (
    <div data-canvas-workbench data-att-id={asset.attachmentId} className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between">
        <span className="truncate text-xs font-medium">{asset.name}</span>
        <button
          type="button"
          data-canvas-workbench-close
          onClick={onClose}
          className="rounded px-2 py-0.5 text-xs hover:bg-[hsl(var(--accent))]"
        >
          关闭
        </button>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        data-canvas-workbench-image
        src={asset.displayUrl}
        alt={asset.name}
        className="max-h-64 w-full rounded object-contain"
        crossOrigin="anonymous"
      />

      {/* A 档工具栏。 */}
      <div className="flex flex-col gap-1">
        <input
          type="text"
          data-canvas-prompt
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="编辑指令(A 档;不经 LLM)"
          className="rounded border border-[hsl(var(--input))] px-2 py-1 text-sm"
        />
        <input
          type="text"
          data-canvas-model
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model(可选)"
          className="rounded border border-[hsl(var(--input))] px-2 py-1 text-xs"
        />
        <div className="flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            data-canvas-action="edit"
            disabled={!available || busy}
            onClick={() => void runA("edit", {})}
            className="rounded bg-[hsl(var(--muted))] px-2 py-1 disabled:opacity-40"
          >
            编辑
          </button>
          <button
            type="button"
            data-canvas-action="variants"
            disabled={!available || busy}
            onClick={() => void runA("variants", { n: 2 })}
            className="rounded bg-[hsl(var(--muted))] px-2 py-1 disabled:opacity-40"
          >
            变体
          </button>
          <button
            type="button"
            data-canvas-action="reframe"
            disabled={!available || busy}
            onClick={() => void runA("reframe", { size: "1024x1536" })}
            className="rounded bg-[hsl(var(--muted))] px-2 py-1 disabled:opacity-40"
          >
            重构比例
          </button>
          <button
            type="button"
            data-canvas-action="inpaint"
            disabled={!available || busy || upload === undefined}
            onClick={() => void inpaintWithMask()}
            className="rounded bg-[hsl(var(--muted))] px-2 py-1 disabled:opacity-40"
          >
            局部重绘
          </button>
        </div>
      </div>

      {/* B 档工具栏(客户端,产 att_ 回流)。 */}
      <div className="flex flex-wrap gap-1 text-xs">
        <button
          type="button"
          data-canvas-b-rotate
          disabled={busy || upload === undefined}
          onClick={() => void rotateAndRegister()}
          className="rounded border border-[hsl(var(--border))] px-2 py-1 disabled:opacity-40"
        >
          旋转 90°(本地)
        </button>
        {onBringToConversation !== undefined ? (
          <button
            type="button"
            data-canvas-bring-to-conversation
            onClick={() => onBringToConversation(asset.attachmentId)}
            className="rounded border border-[hsl(var(--border))] px-2 py-1"
          >
            带入对话
          </button>
        ) : null}
      </div>

      {/* C 档血缘视图。 */}
      <LineageView
        assets={assets}
        {...(onReuseParams !== undefined ? { onReuseParams } : {})}
      />
    </div>
  );
}
