/**
 * Attachments — 无状态的附件展示与拖拽/粘贴/选择入口(含呈现增强)。
 *
 * 本元件不持有任何附件状态或编码逻辑(实际图片过滤/base64 编码在 `useAttachments`)。
 * 它负责展示与本地交互:
 *  - 展示待发送/已发送附件:缩略图(dataUrl)、文件名、可读类型标签、移除按钮(Req 3.1/3.3、12.1)。
 *  - dropzone:拖拽 drop、粘贴 paste、点击选择(file input)→ 调 `onAdd(files)`(Req 3.1)。
 *  - 展示上层 `useAttachments.add` 返回的 `rejected` 非图片文件名,提示"暂不支持该类型附件";
 *    不入列、不阻断已有图片或文本的发送(Req 3.4、12.5)。
 *  - 悬停/键盘聚焦图片缩略图 → 放大预览浮层(自定义轻量浮层,非 radix-hover-card,Req 12.2)。
 *  - 无可用缩略图时以该类别占位图标降级,仍保留文件名与移除(Req 12.4)。
 *  - 布局变体 panel/compact/inline/grid/list(Req 12.3);panel/compact 行为与历史完全一致(向后兼容)。
 *  - panel/compact 在 `supported=false` 时隐藏附件入口(Req 3.5);inline/grid/list 为纯展示变体,
 *    不含 add 入口,故不受 `supported` 影响。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色(Req 11.5、12.6);移除按钮/预览/入口带 `aria-label`,
 * 键盘可达(Req 11.4、12.6)。
 */
import * as React from "react";
import {
  X,
  ImagePlus,
  Paperclip,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  File as FileIcon,
} from "lucide-react";
import type { PendingAttachment } from "@pi-web/react";
import { cn } from "../lib/cn.js";

/** 附件媒体类别(本期入列恒为 image,其余为未来非图片留口)。 */
export type MediaCategory = "image" | "video" | "audio" | "file";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"];
const VIDEO_EXT = ["mp4", "webm", "mov", "mkv", "avi", "m4v"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];

/** 从 `mimeType`(优先)或文件名后缀推导媒体类别(纯函数,可独立单测)。 */
export function getMediaCategory(att: PendingAttachment): MediaCategory {
  const mime = (att.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = (att.name ?? "").toLowerCase().split(".").pop() ?? "";
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (AUDIO_EXT.includes(ext)) return "audio";
  return "file";
}

const CATEGORY_LABEL: Record<MediaCategory, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
};

/** 附件可读类型标签(纯函数,可独立单测)。 */
export function getAttachmentLabel(att: PendingAttachment): string {
  return CATEGORY_LABEL[getMediaCategory(att)];
}

function categoryIcon(cat: MediaCategory): React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}> {
  switch (cat) {
    case "image":
      return ImageIcon;
    case "video":
      return FileVideo;
    case "audio":
      return FileAudio;
    default:
      return FileIcon;
  }
}

/** 五种布局变体。 */
export type AttachmentsVariant =
  | "panel"
  | "compact"
  | "inline"
  | "grid"
  | "list";

/** 展示变体(无 add 入口、纯展示,不受 supported 影响)。 */
const DISPLAY_VARIANTS: ReadonlyArray<AttachmentsVariant> = [
  "inline",
  "grid",
  "list",
];

type ThumbSize = "sm" | "md" | "lg";

const THUMB_DIM: Record<ThumbSize, string> = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

export interface AttachmentsProps {
  /** 待发送/已发送附件项(来自 useAttachments.items 或消息附件)。 */
  readonly items: ReadonlyArray<PendingAttachment>;
  /** 当前会话/agent 是否支持图片输入;false 时隐藏 panel/compact 附件入口(Req 3.5)。 */
  readonly supported: boolean;
  /** 新增附件回调,透传原始 files(由上层 useAttachments.add 过滤/编码)(Req 3.1)。 */
  readonly onAdd: (files: FileList | File[]) => void;
  /** 移除某附件回调(Req 3.3)。 */
  readonly onRemove: (id: string) => void;
  /** 上层拒收的非图片文件名;非空时展示"暂不支持"提示(Req 3.4)。 */
  readonly rejected?: ReadonlyArray<string>;
  /**
   * 布局变体(Req 12.3):
   *  - "panel"(默认):虚线 dropzone(拖拽/粘贴/点击)+ chips,适合独立附件区。
   *  - "compact":paperclip 图标按钮(点击选择)+ chips,适合嵌入输入框工具条。
   *  - "inline":仅紧凑徽章排(无入口),适合输入区已选附件内联展示。
   *  - "grid":缩略图网格(无入口),适合消息内多图。
   *  - "list":带类型标签的行(无入口),适合元信息呈现。
   */
  readonly variant?: AttachmentsVariant;
  /** 是否启用图片缩略图的悬停/聚焦放大预览;默认 true(Req 12.2)。 */
  readonly hoverPreview?: boolean;
  /** dropzone 提示文案,默认中文。 */
  readonly hint?: string;
  /** 不支持类型的提示前缀,默认中文。 */
  readonly rejectedLabel?: string;
  /** file input / 选择入口的无障碍标签,默认中文。 */
  readonly addLabel?: string;
  /** 移除按钮 aria-label 构造器,默认 `移除附件 {name}`。 */
  readonly removeLabel?: (name: string) => string;
  readonly className?: string;
}

/** 从拖拽/粘贴事件取出 FileList(无文件返回 null,避免阻断纯文本粘贴,Req 3.4)。 */
function filesFrom(list: FileList | null | undefined): FileList | null {
  return list && list.length > 0 ? list : null;
}

/**
 * 附件缩略图 + 占位图标 + 悬停预览浮层(Req 12.2/12.4)。
 * 自定义轻量浮层:受控 hovered 态 + 绝对定位预览层;指针 enter/leave 与键盘 focus/blur 双触发,
 * 移开/失焦关闭。预览图仅在 hovered 时条件渲染,避免默认态出现第二个同名 `img`。
 */
function AttachmentThumb({
  att,
  size,
  hoverPreview,
}: {
  readonly att: PendingAttachment;
  readonly size: ThumbSize;
  readonly hoverPreview: boolean;
}): React.JSX.Element {
  const cat = getMediaCategory(att);
  const hasImage = cat === "image" && Boolean(att.dataUrl);
  const previewable = hoverPreview && hasImage;
  const [hovered, setHovered] = React.useState(false);
  const Icon = categoryIcon(cat);
  const dim = THUMB_DIM[size];

  const open = (): void => setHovered(true);
  const close = (): void => setHovered(false);

  return (
    <span
      className="relative inline-flex shrink-0"
      data-pi-attachment-thumb
      onMouseEnter={previewable ? open : undefined}
      onMouseLeave={previewable ? close : undefined}
      onFocus={previewable ? open : undefined}
      onBlur={previewable ? close : undefined}
      tabIndex={previewable ? 0 : undefined}
      aria-label={previewable ? `预览 ${att.name}` : undefined}
    >
      {hasImage ? (
        <img
          src={att.dataUrl}
          alt={att.name}
          className={cn(dim, "rounded-[calc(var(--radius)-2px)] object-cover")}
        />
      ) : (
        <span
          role="img"
          aria-label={att.name}
          className={cn(
            dim,
            "flex items-center justify-center rounded-[calc(var(--radius)-2px)] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      {previewable && hovered ? (
        <span
          role="tooltip"
          data-testid="pi-attachment-preview"
          data-pi-attachment-preview
          className="absolute bottom-full left-0 z-50 mb-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1 shadow-md"
        >
          <img
            src={att.dataUrl}
            alt={`${att.name} 预览`}
            className="max-h-48 max-w-[12rem] rounded-[calc(var(--radius)-2px)] object-contain"
          />
        </span>
      ) : null}
    </span>
  );
}

/** 可读类型标签(Req 12.1)。 */
function TypeLabel({
  att,
  className,
}: {
  readonly att: PendingAttachment;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span
      data-pi-attachment-type
      className={cn("text-[10px] text-[hsl(var(--muted-foreground))]", className)}
    >
      {getAttachmentLabel(att)}
    </span>
  );
}

/** 移除按钮(Req 3.3),aria-label 必带文件名(Req 11.4)。 */
function RemoveButton({
  att,
  onRemove,
  removeLabel,
}: {
  readonly att: PendingAttachment;
  readonly onRemove: (id: string) => void;
  readonly removeLabel: (name: string) => string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={removeLabel(att.name)}
      onClick={() => onRemove(att.id)}
      className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      data-pi-attachment-remove
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

export function Attachments({
  items,
  supported,
  onAdd,
  onRemove,
  rejected,
  variant = "panel",
  hoverPreview = true,
  hint = "拖拽、粘贴或点击添加图片",
  rejectedLabel = "暂不支持该类型附件",
  addLabel = "添加图片附件",
  removeLabel = (name) => `移除附件 ${name}`,
  className,
}: AttachmentsProps): React.JSX.Element | null {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const isDisplayOnly = DISPLAY_VARIANTS.includes(variant);

  // panel/compact 在 supported=false 时隐藏附件入口(Req 3.5)。展示变体不受影响。
  if (!supported && !isDisplayOnly) return null;

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    const files = filesFrom(event.dataTransfer?.files);
    if (!files) return;
    event.preventDefault();
    onAdd(files);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    const files = filesFrom(event.clipboardData?.files);
    // 无文件(纯文本粘贴)时不处理,不阻断(Req 3.4)。
    if (!files) return;
    onAdd(files);
  };

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const files = filesFrom(event.target.files);
    if (files) onAdd(files);
    // 复位以便重复选择同一文件可再次触发 change。
    event.target.value = "";
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      inputRef.current?.click();
    }
  };

  const hasRejected = rejected !== undefined && rejected.length > 0;

  const rejectedNode = hasRejected ? (
    <span
      role="alert"
      className="text-xs text-[hsl(var(--destructive))]"
      data-pi-attachments-rejected
    >
      {rejectedLabel}: {rejected!.join("、")}
    </span>
  ) : null;

  // compact:paperclip 图标按钮(点击选择)+ chips,嵌入输入框工具条用。
  if (variant === "compact") {
    return (
      <div
        className={cn("flex flex-wrap items-center gap-2", className)}
        data-pi-attachments
        data-pi-attachments-variant="compact"
      >
        <button
          type="button"
          aria-label={addLabel}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-pi-attachments-add
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            aria-label={addLabel}
            onChange={handleChange}
            className="hidden"
            data-pi-attachments-input
          />
        </button>
        {items.map((it) => (
          <span
            key={it.id}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] py-1 pl-1 pr-2 text-xs text-[hsl(var(--foreground))]"
            data-pi-attachment-chip
          >
            <AttachmentThumb att={it} size="sm" hoverPreview={hoverPreview} />
            <span className="max-w-[8rem] truncate" title={it.name}>
              {it.name}
            </span>
            <TypeLabel att={it} />
            <RemoveButton att={it} onRemove={onRemove} removeLabel={removeLabel} />
          </span>
        ))}
        {rejectedNode}
      </div>
    );
  }

  // inline:仅紧凑徽章排(无入口),适合输入区已选附件内联展示。
  if (variant === "inline") {
    if (items.length === 0 && !hasRejected) return null;
    return (
      <div
        className={cn("flex flex-wrap items-center gap-2", className)}
        data-pi-attachments
        data-pi-attachments-variant="inline"
      >
        {items.map((it) => (
          <span
            key={it.id}
            className="relative inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] py-1 pl-1 pr-2 text-xs text-[hsl(var(--foreground))]"
            data-pi-attachment-chip
          >
            <AttachmentThumb att={it} size="sm" hoverPreview={hoverPreview} />
            <span className="max-w-[8rem] truncate" title={it.name}>
              {it.name}
            </span>
            <TypeLabel att={it} />
            <RemoveButton att={it} onRemove={onRemove} removeLabel={removeLabel} />
          </span>
        ))}
        {rejectedNode}
      </div>
    );
  }

  // grid:缩略图网格(无入口),适合消息内多图。
  if (variant === "grid") {
    if (items.length === 0 && !hasRejected) return null;
    return (
      <div
        className={cn("flex flex-col gap-2", className)}
        data-pi-attachments
        data-pi-attachments-variant="grid"
      >
        {items.length > 0 ? (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2"
            data-pi-attachments-chips
          >
            {items.map((it) => (
              <li
                key={it.id}
                className="relative flex flex-col items-center gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-1.5 text-xs text-[hsl(var(--foreground))]"
                data-pi-attachment-chip
              >
                <div className="flex w-full items-start justify-between gap-1">
                  <AttachmentThumb att={it} size="lg" hoverPreview={hoverPreview} />
                  <RemoveButton
                    att={it}
                    onRemove={onRemove}
                    removeLabel={removeLabel}
                  />
                </div>
                <span
                  className="w-full max-w-[6rem] truncate text-center"
                  title={it.name}
                >
                  {it.name}
                </span>
                <TypeLabel att={it} />
              </li>
            ))}
          </ul>
        ) : null}
        {rejectedNode}
      </div>
    );
  }

  // list:带类型标签的行(无入口),适合元信息呈现。
  if (variant === "list") {
    if (items.length === 0 && !hasRejected) return null;
    return (
      <div
        className={cn("flex flex-col gap-1", className)}
        data-pi-attachments
        data-pi-attachments-variant="list"
      >
        {items.length > 0 ? (
          <ul className="flex flex-col gap-1" data-pi-attachments-chips>
            {items.map((it) => (
              <li
                key={it.id}
                className="relative flex items-center gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 text-xs text-[hsl(var(--foreground))]"
                data-pi-attachment-chip
              >
                <AttachmentThumb att={it} size="md" hoverPreview={hoverPreview} />
                <span className="min-w-0 flex-1 truncate" title={it.name}>
                  {it.name}
                </span>
                <TypeLabel att={it} />
                <RemoveButton
                  att={it}
                  onRemove={onRemove}
                  removeLabel={removeLabel}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {rejectedNode}
      </div>
    );
  }

  // panel(默认):虚线 dropzone(拖拽/粘贴/点击)+ chips,适合独立附件区。
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-pi-attachments
      data-pi-attachments-variant="panel"
    >
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2" data-pi-attachments-chips>
          {items.map((it) => (
            <li
              key={it.id}
              className="relative flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] py-1 pl-1 pr-2 text-xs text-[hsl(var(--foreground))]"
              data-pi-attachment-chip
            >
              <AttachmentThumb att={it} size="md" hoverPreview={hoverPreview} />
              <span className="max-w-[10rem] truncate" title={it.name}>
                {it.name}
              </span>
              <TypeLabel att={it} />
              <RemoveButton
                att={it}
                onRemove={onRemove}
                removeLabel={removeLabel}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        aria-label={addLabel}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onPaste={handlePaste}
        className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--ring))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        data-testid="pi-attachments-dropzone"
        data-pi-attachments-dropzone
      >
        <ImagePlus className="h-4 w-4" aria-hidden="true" />
        <span>{hint}</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          aria-label={addLabel}
          onChange={handleChange}
          className="hidden"
          data-pi-attachments-input
        />
      </div>

      {hasRejected ? (
        <p
          role="alert"
          className="text-xs text-[hsl(var(--destructive))]"
          data-pi-attachments-rejected
        >
          {rejectedLabel}: {rejected!.join("、")}
        </p>
      ) : null}
    </div>
  );
}
