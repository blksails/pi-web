/**
 * PiReasoning — 可折叠思考块。
 *
 * 增量渲染 reasoning 文本;默认折叠 + 切换;`aria-expanded` 反映状态;流式进行中指示;
 * 键盘可触发(button 元素天然支持 Enter/Space)。对应 AI SDK `ReasoningUIPart`。
 */
import * as React from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { UIMessage } from "ai";
import { cn } from "../lib/cn.js";

type AnyPart = UIMessage["parts"][number];
export type ReasoningPart = Extract<AnyPart, { type: "reasoning" }>;

export interface PiReasoningProps {
  readonly part: ReasoningPart;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

export function PiReasoning({
  part,
  defaultOpen = false,
  className,
}: PiReasoningProps): React.JSX.Element {
  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const contentId = React.useId();
  const streaming = part.state === "streaming";

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
        <span>Reasoning</span>
        {streaming ? (
          <Loader2
            className="ml-auto h-3.5 w-3.5 animate-spin"
            aria-label="Thinking"
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
