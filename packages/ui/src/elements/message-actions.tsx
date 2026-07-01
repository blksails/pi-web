"use client";
/**
 * MessageActions — 消息操作区(复制 / 赞 / 踩),从 message.tsx 抽出为独立可覆盖元件
 * (pi-chat-customization 任务 2.1)。图标经 useIcon 注入,默认回退既有 lucide(Req 8.1)。
 *
 * 默认实现与抽出前外观一致(Req 1.1);可由 components.MessageActions 覆盖(Req 5.1/5.2)。
 */
import * as React from "react";
import { Copy, Check, ThumbsUp, ThumbsDown } from "lucide-react";
import { useIcon } from "../customization/icons.js";
import { useI18n } from "../i18n/index.js";
import { cn } from "../lib/cn.js";

export interface MessageActionsProps {
  /** 用于"复制"的纯文本;提供时复制按钮可用。 */
  readonly copyText?: string;
  /** 反馈回调(赞/踩);无后端时仅本地切换视觉态。 */
  readonly onFeedback?: (value: "up" | "down") => void;
  readonly className?: string;
}

const ACTION_BTN =
  "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius)] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50";

export function MessageActions({
  copyText,
  onFeedback,
  className,
}: MessageActionsProps): React.JSX.Element {
  const t = useI18n();
  const CopyIcon = useIcon("copy", Copy);
  const CopiedIcon = useIcon("copied", Check);
  const ThumbUpIcon = useIcon("thumbUp", ThumbsUp);
  const ThumbDownIcon = useIcon("thumbDown", ThumbsDown);

  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<"up" | "down" | null>(null);

  const handleCopy = (): void => {
    if (copyText === undefined) return;
    void (async () => {
      try {
        await navigator.clipboard?.writeText(copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // 复制失败静默降级,不阻断。
      }
    })();
  };

  const pick = (value: "up" | "down"): void => {
    setFeedback((prev) => (prev === value ? null : value));
    onFeedback?.(value);
  };

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      data-pi-message-actions-builtin
    >
      <button
        type="button"
        onClick={handleCopy}
        disabled={copyText === undefined}
        aria-label={t("messageActions.copy")}
        className={ACTION_BTN}
        data-pi-message-copy
      >
        {copied ? (
          <CopiedIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <CopyIcon className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => pick("up")}
        aria-label={t("messageActions.like")}
        aria-pressed={feedback === "up"}
        className={cn(
          ACTION_BTN,
          feedback === "up" && "text-[hsl(var(--foreground))]",
        )}
        data-pi-message-like
      >
        <ThumbUpIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => pick("down")}
        aria-label={t("messageActions.dislike")}
        aria-pressed={feedback === "down"}
        className={cn(
          ACTION_BTN,
          feedback === "down" && "text-[hsl(var(--foreground))]",
        )}
        data-pi-message-dislike
      >
        <ThumbDownIcon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
