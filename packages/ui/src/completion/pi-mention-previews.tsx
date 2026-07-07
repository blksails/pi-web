/**
 * PiMentionPreviews — 输入区被引用附件的缩略图预览条(attachment-mention-preview)。
 *
 * `@` 补全选中附件后,输入框里只留一段裸 token `@attachment:<id>`(无预览)。本组件扫描当前
 * 输入值里的附件 mention token,为每个渲染一枚 chip(缩略图 + 名字 + 移除按钮),让用户「看得见」
 * 引用了哪张图。预览数据(name/previewUrl)由装配层在选中时捕获(候选自带 previewUrl)并经
 * `previews` 传入;未捕获到的 token(如手动键入 / 刷新后)退化为「仅名字/ id」的无图 chip。
 *
 * 纯展示 + 移除回调;不发请求、不改协议。token 文法 `@attachment:<id>`(见 server serializeToken)。
 */
import * as React from "react";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

/** 单个被引用附件的预览数据。 */
export interface MentionPreview {
  readonly name: string;
  readonly previewUrl?: string;
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
            {p?.previewUrl !== undefined ? (
              // eslint-disable-next-line @next/next/no-img-element -- ui 包不依赖 next/image
              <img
                src={p.previewUrl}
                alt=""
                loading="lazy"
                data-pi-mention-preview-img
                className="h-5 w-5 shrink-0 rounded-full object-cover"
              />
            ) : null}
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
