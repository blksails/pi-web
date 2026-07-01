/**
 * PiReasoning — 可折叠思考块(对齐 AI SDK `ReasoningUIPart` 与 ai-sdk Reasoning 组件)。
 *
 * 默认:折叠 + 点击/键盘切换;`aria-expanded` 反映状态;流式进行中指示(role=status)。
 * 可选(opt-in,默认关闭以保持既有行为):
 *  - streamingAutoOpen:流式期间自动展开、结束自动收起(对齐 ai-sdk isStreaming 行为)。
 *  - getThinkingMessage(isStreaming, durationSec?):自定义触发器标签,如 "Thought for 3s"。
 * 外观可经 components.Reasoning 整体替换(pi-chat-customization)。
 */
import * as React from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { UIMessage } from "ai";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

type AnyPart = UIMessage["parts"][number];
export type ReasoningPart = Extract<AnyPart, { type: "reasoning" }>;

export interface PiReasoningProps {
  readonly part: ReasoningPart;
  readonly defaultOpen?: boolean;
  readonly className?: string;
  /** 流式期间自动展开、结束自动收起(对齐 ai-sdk Reasoning);默认 false 保持原行为。 */
  readonly streamingAutoOpen?: boolean;
  /**
   * 自定义触发器标签;接收 isStreaming 与(结束后的)思考时长秒数。
   * 缺省显示 "Reasoning"(保持既有外观与测试)。
   */
  readonly getThinkingMessage?: (
    isStreaming: boolean,
    durationSec?: number,
  ) => string;
}

export function PiReasoning({
  part,
  defaultOpen = false,
  className,
  streamingAutoOpen = false,
  getThinkingMessage,
}: PiReasoningProps): React.JSX.Element {
  const t = useI18n();
  const streaming = part.state === "streaming";
  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const [durationSec, setDurationSec] = React.useState<number | undefined>(
    undefined,
  );
  const contentId = React.useId();
  const startRef = React.useRef<number | undefined>(undefined);
  const prevStreamingRef = React.useRef<boolean>(streaming);

  // 跟踪流式起止:记录时长;streamingAutoOpen 时自动展开/收起(对齐 ai-sdk)。
  React.useEffect(() => {
    const prev = prevStreamingRef.current;
    if (streaming && !prev) {
      startRef.current = Date.now();
      if (streamingAutoOpen) setOpen(true);
    } else if (!streaming && prev) {
      if (startRef.current !== undefined) {
        setDurationSec(
          Math.max(1, Math.round((Date.now() - startRef.current) / 1000)),
        );
      }
      if (streamingAutoOpen) setOpen(false);
    }
    prevStreamingRef.current = streaming;
  }, [streaming, streamingAutoOpen]);

  const label = getThinkingMessage
    ? getThinkingMessage(streaming, durationSec)
    : t("reasoning.label");

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
        className,
      )}
      data-pi-reasoning
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{label}</span>
        {streaming ? (
          <Loader2
            className="ml-auto h-3.5 w-3.5 animate-spin"
            aria-label={t("reasoning.thinking")}
            role="status"
          />
        ) : null}
      </button>
      {open ? (
        <div
          id={contentId}
          className="whitespace-pre-wrap px-3 pb-3 text-sm"
          data-pi-reasoning-content
        >
          {part.text}
        </div>
      ) : null}
    </div>
  );
}
