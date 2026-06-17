/**
 * Attachments — 无状态的图片附件展示与拖拽/粘贴/选择入口。
 *
 * 本元件不持有任何附件状态或编码逻辑(实际图片过滤/base64 编码在 task 2.2 的
 * `useAttachments`)。它只负责:
 *  - 展示待发送附件 chips:缩略图(dataUrl)、文件名、移除按钮(Req 3.1/3.3)。
 *  - 提供 dropzone:拖拽 drop、粘贴 paste、点击选择(file input)→ 调 `onAdd(files)`(Req 3.1)。
 *  - 展示上层 `useAttachments.add` 返回的 `rejected` 非图片文件名,提示
 *    "暂不支持该类型附件";不入列、不阻断已有图片或文本的发送(Req 3.4)。
 *  - `supported=false` 时隐藏附件入口(dropzone 与 file input)(Req 3.5)。
 *
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色(Req 11.5);移除按钮带 `aria-label`,
 * file input 带 `aria-label`,dropzone 可访问(Req 11.4)。
 */
import * as React from "react";
import { X, ImagePlus } from "lucide-react";
import type { PendingAttachment } from "@pi-web/react";
import { cn } from "../lib/cn.js";

export interface AttachmentsProps {
  /** 待发送附件项(来自 useAttachments.items)。 */
  readonly items: ReadonlyArray<PendingAttachment>;
  /** 当前会话/agent 是否支持图片输入;false 时隐藏附件入口(Req 3.5)。 */
  readonly supported: boolean;
  /** 新增附件回调,透传原始 files(由上层 useAttachments.add 过滤/编码)(Req 3.1)。 */
  readonly onAdd: (files: FileList | File[]) => void;
  /** 移除某附件回调(Req 3.3)。 */
  readonly onRemove: (id: string) => void;
  /** 上层拒收的非图片文件名;非空时展示"暂不支持"提示(Req 3.4)。 */
  readonly rejected?: ReadonlyArray<string>;
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

export function Attachments({
  items,
  supported,
  onAdd,
  onRemove,
  rejected,
  hint = "拖拽、粘贴或点击添加图片",
  rejectedLabel = "暂不支持该类型附件",
  addLabel = "添加图片附件",
  removeLabel = (name) => `移除附件 ${name}`,
  className,
}: AttachmentsProps): React.JSX.Element | null {
  const inputRef = React.useRef<HTMLInputElement>(null);

  // supported=false:隐藏附件入口(Req 3.5)。无 chips/rejected 时无需渲染。
  if (!supported) return null;

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

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-pi-attachments
    >
      {items.length > 0 ? (
        <ul
          className="flex flex-wrap gap-2"
          data-pi-attachments-chips
        >
          {items.map((it) => (
            <li
              key={it.id}
              className="relative flex items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] py-1 pl-1 pr-2 text-xs text-[hsl(var(--foreground))]"
              data-pi-attachment-chip
            >
              <img
                src={it.dataUrl}
                alt={it.name}
                className="h-8 w-8 shrink-0 rounded-[calc(var(--radius)-2px)] object-cover"
              />
              <span className="max-w-[10rem] truncate" title={it.name}>
                {it.name}
              </span>
              <button
                type="button"
                aria-label={removeLabel(it.name)}
                onClick={() => onRemove(it.id)}
                className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                data-pi-attachment-remove
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
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
