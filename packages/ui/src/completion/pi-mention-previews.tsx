/**
 * PiMentionPreviews — 输入区被引用附件的缩略图预览条(attachment-mention-preview)。
 *
 * `@` 补全选中附件后,输入框里只留一段裸 token `@attachment:<id>`(无预览)。本组件扫描当前
 * 输入值里的附件 mention token,为每个渲染一枚 chip(缩略图 + 名字 + 移除按钮),让用户「看得见」
 * 引用了哪份附件。预览数据(name/previewUrl/mediaType)由装配层在选中时捕获(候选自带 previewUrl)并经
 * `previews` 传入;未捕获到的 token(如手动键入 / 刷新后)退化为「仅名字/ id」的无图 chip。
 *
 * 纯展示 + 移除回调;不发请求、不改协议。token 文法 `@attachment:<id>`(见 server serializeToken)。
 */
import * as React from "react";
import { File, FileAudio, FileVideo, Image as ImageIcon } from "lucide-react";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

/** 单个被引用附件的预览数据。 */
export interface MentionPreview {
  readonly name: string;
  readonly previewUrl?: string;
  readonly mediaType?: string;
}

export interface PiMentionPreviewsProps {
  /** 当前输入值(扫描其中的 `@attachment:<id>` token)。 */
  readonly value: string;
  /** id → 预览数据(装配层选中时捕获)。缺失的 token 退化为无图 chip。 */
  readonly previews: ReadonlyMap<string, MentionPreview>;
  /** 移除某引用(装配层据此从输入值删去对应 token)。 */
  readonly onRemove?: (id: string) => void;
  readonly className?: string;
}

/** 附件 mention token 文法:`@attachment:<id>`(id = `att_<nanoid>`,charset `A-Za-z0-9_-`)。 */
const ATTACHMENT_TOKEN_RE = /@attachment:(att_[A-Za-z0-9_-]+)/g;

/** 扫描输入值里出现的附件 mention id(去重、保序)。 */
export function scanAttachmentMentions(value: string): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of value.matchAll(ATTACHMENT_TOKEN_RE)) {
    const id = m[1];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 从输入值删去某附件 mention token(连带其后紧邻的一个空白),供 onRemove 装配层复用。 */
export function removeAttachmentMention(value: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`@attachment:${escaped}\\s?`), "");
}

type MentionMedia = "image" | "video" | "audio" | "file";

function mediaOf(preview: MentionPreview): MentionMedia {
  const mime = preview.mediaType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = preview.name.toLowerCase().split(".").pop() ?? "";
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"].includes(ext)
  ) {
    return "image";
  }
  if (["mp4", "webm", "mov", "mkv", "avi", "m4v"].includes(ext)) {
    return "video";
  }
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext)) {
    return "audio";
  }
  return "file";
}

function MentionThumb({
  preview,
}: {
  readonly preview: MentionPreview;
}): React.JSX.Element | null {
  const src = preview.previewUrl;
  const media = mediaOf(preview);
  const isImage = media === "image";
  const isVideo = media === "video";
  const isAudio = media === "audio";
  const previewable = isImage || isVideo || isAudio;
  const [hovered, setHovered] = React.useState(false);
  if (src === undefined) return null;
  const Icon =
    media === "video"
      ? FileVideo
      : media === "audio"
        ? FileAudio
        : media === "file"
          ? File
          : ImageIcon;
  return (
    <span
      className="relative inline-flex shrink-0"
      data-pi-mention-preview-thumb
      tabIndex={previewable ? 0 : undefined}
      aria-label={previewable ? `预览 ${preview.name}` : undefined}
      onMouseEnter={previewable ? () => setHovered(true) : undefined}
      onMouseLeave={previewable ? () => setHovered(false) : undefined}
      onFocus={previewable ? () => setHovered(true) : undefined}
      onBlur={previewable ? () => setHovered(false) : undefined}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- ui 包不依赖 next/image
        <img
          src={src}
          alt=""
          loading="lazy"
          data-pi-mention-preview-img
          className="h-6 w-6 shrink-0 rounded-[4px] object-cover"
        />
      ) : isVideo ? (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          aria-label={preview.name}
          className="h-6 w-6 shrink-0 rounded-[4px] object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
      {previewable && hovered ? (
        <span
          role="tooltip"
          data-pi-mention-preview-popup
          // 与 pill 直接相接,避免 hover 经过空隙时触发 mouseleave 导致播放器消失。
          className="absolute bottom-full left-0 z-50 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1 shadow-md"
        >
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- ui 包不依赖 next/image
            <img
              src={src}
              alt={preview.name}
              className="max-h-48 max-w-[12rem] rounded-[4px] object-contain"
            />
          ) : isVideo ? (
            <video
              src={src}
              controls
              autoPlay
              playsInline
              className="max-h-48 max-w-[16rem] rounded-[4px]"
            />
          ) : (
            <audio src={src} controls autoPlay className="max-w-[16rem]" />
          )}
        </span>
      ) : null}
    </span>
  );
}

export function PiMentionPreviews({
  value,
  previews,
  onRemove,
  className,
}: PiMentionPreviewsProps): React.JSX.Element | null {
  const t = useI18n();
  const ids = React.useMemo(() => scanAttachmentMentions(value), [value]);
  if (ids.length === 0) return null;

  return (
    <div
      data-pi-mention-previews
      className={cn("mb-1.5 flex flex-wrap gap-1.5", className)}
    >
      {ids.map((id) => {
        const p = previews.get(id);
        const name = p?.name ?? id;
        return (
          <span
            key={id}
            data-pi-mention-preview={id}
            className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] py-0.5 pl-0.5 pr-1.5 text-xs"
          >
            {p !== undefined ? <MentionThumb preview={p} /> : null}
            <span className="truncate text-[hsl(var(--foreground))]" title={name}>
              {name}
            </span>
            {onRemove !== undefined ? (
              <button
                type="button"
                aria-label={t("mentionPreview.remove").replace("{name}", name)}
                onClick={() => onRemove(id)}
                className="shrink-0 rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                ×
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
