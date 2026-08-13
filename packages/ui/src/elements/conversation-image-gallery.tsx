"use client";

import * as React from "react";
import {
  Download,
  ExternalLink,
  ImagePlus,
  Images,
  Palette,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type {
  ConversationImageAction,
  ConversationImageAsset,
} from "@blksails/pi-web-kit";
import { cn } from "../lib/cn.js";

export interface ConversationImageGalleryProps {
  readonly assets: readonly ConversationImageAsset[];
  readonly actions?: readonly ConversationImageAction[];
  readonly publishPaneEvent?: (topic: string, payload?: unknown) => void;
  readonly className?: string;
}

const ICONS: Readonly<Record<string, LucideIcon>> = {
  download: Download,
  images: Images,
  "image-plus": ImagePlus,
  "external-link": ExternalLink,
  palette: Palette,
  sparkles: Sparkles,
  "wand-sparkles": WandSparkles,
};

function safeFilename(asset: ConversationImageAsset, index: number): string {
  if (asset.filename !== undefined && asset.filename.trim() !== "") return asset.filename;
  try {
    const leaf = new URL(asset.url, window.location.href).pathname.split("/").pop();
    if (leaf !== undefined && leaf !== "" && leaf !== "raw") return decodeURIComponent(leaf);
  } catch {
    // 非标准 URL 退回稳定文件名。
  }
  const ext = asset.mediaType.split("/")[1]?.split("+")[0] || "png";
  return `aigc-image-${index + 1}.${ext}`;
}

/** 始终在当前页取 blob 后触发下载；不导航至素材地址。 */
export async function downloadConversationImage(
  asset: ConversationImageAsset,
  index = 0,
): Promise<void> {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`下载失败 (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = safeFilename(asset, index);
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function dedupeActions(actions: readonly ConversationImageAction[]): ConversationImageAction[] {
  const byId = new Map<string, ConversationImageAction>();
  for (const action of actions) {
    if (!byId.has(action.id)) byId.set(action.id, action);
  }
  return [...byId.values()].sort(
    (left, right) => (left.order ?? 100) - (right.order ?? 100),
  );
}

export function ConversationImageGallery({
  assets,
  actions = [],
  publishPaneEvent,
  className,
}: ConversationImageGalleryProps): React.JSX.Element | null {
  const [busy, setBusy] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const registered = React.useMemo(() => dedupeActions(actions), [actions]);
  if (assets.length === 0) return null;

  const run = (key: string, task: () => Promise<void>): void => {
    if (busy !== undefined) return;
    setBusy(key);
    setError(undefined);
    void task()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setBusy(undefined));
  };

  const publish = (topic: string, payload?: unknown): void => {
    publishPaneEvent?.(topic, payload);
  };

  return (
    <div
      className={cn(
        "grid w-fit max-w-full gap-3",
        assets.length === 1 && "max-w-[min(100%,420px)]",
        assets.length > 1 && "sm:max-w-[840px]",
        assets.length > 1 && "sm:grid-cols-2",
        className,
      )}
      data-pi-conversation-images
      data-image-count={assets.length}
    >
      {assets.map((asset, index) => {
        const context = { asset, assets, publishPaneEvent: publish };
        const applicable = registered.filter((action) => {
          try {
            return action.when?.(context) ?? true;
          } catch {
            return false;
          }
        });
        return (
          <figure
            key={asset.id}
            className="group m-0 flex min-h-0 max-w-full flex-col overflow-hidden rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]"
            data-pi-conversation-image
          >
            <div className="flex aspect-[4/3] min-h-0 w-full items-center justify-center bg-[hsl(var(--surface-subtle))]">
              {/* eslint-disable-next-line @next/next/no-img-element -- SDK 组件须支持 blob/data/签名 URL。 */}
              <img
                src={asset.url}
                alt={asset.filename ?? "AIGC 生成图片"}
                className="block h-full w-full object-contain"
                // ui-redesign:图片最大不超过屏幕高度 2/5(40dvh)。
                style={{ maxHeight: "40dvh" }}
              />
            </div>
            <div
              className="flex max-w-full flex-wrap items-center gap-1 border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1.5 text-[hsl(var(--foreground))]"
              data-pi-conversation-image-pill
            >
              {applicable.map((action) => {
                const Icon = ICONS[action.icon] ?? Sparkles;
                return (
                  <button
                    key={action.id}
                    type="button"
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-2 text-xs hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50"
                    aria-label={action.label}
                    title={action.label}
                    disabled={busy !== undefined}
                    onClick={() =>
                      run(`${asset.id}:${action.id}`, async () => {
                        await action.run(context);
                      })
                    }
                    data-image-action={action.id}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{action.label}</span>
                  </button>
                );
              })}
              {!applicable.some((action) => action.id === "download") ? (
                <button
                  type="button"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-2 text-xs hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50"
                  aria-label="下载"
                  title="下载"
                  disabled={busy !== undefined}
                  onClick={() =>
                    run(`${asset.id}:download`, () => downloadConversationImage(asset, index))
                  }
                  data-image-action="download"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>下载</span>
                </button>
              ) : null}
              {index === 0 && assets.length > 1 &&
              !applicable.some((action) => action.id === "download-all") ? (
                <button
                  type="button"
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-2 text-xs hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50"
                  aria-label="下载全部"
                  title="下载全部"
                  disabled={busy !== undefined}
                  onClick={() =>
                    run("download-all", async () => {
                      for (let i = 0; i < assets.length; i += 1) {
                        const next = assets[i];
                        if (next !== undefined) await downloadConversationImage(next, i);
                      }
                    })
                  }
                  data-image-action="download-all"
                >
                  <Images className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>下载全部</span>
                </button>
              ) : null}
            </div>
          </figure>
        );
      })}
      {error !== undefined ? (
        <div
          role="alert"
          className="col-span-full text-xs text-[hsl(var(--destructive))]"
          data-pi-conversation-image-error
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
