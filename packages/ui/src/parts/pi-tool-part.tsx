/**
 * PiToolPart — 默认工具卡(start / update / end 三态)。
 *
 * 对应 AI SDK `ToolUIPart` / `DynamicToolUIPart` 的 `state`:
 *   - input-streaming / input-available  → start 态(显示工具名 + 入参)
 *   - output-available(preliminary)     → update 态(用最新累积值替换显示)
 *   - output-available(最终)            → end 态(显示结果)
 *   - output-error                       → end 态错误样式(errorText)
 *
 * 明细区可折叠并带键盘可达 + aria 状态。
 */
import * as React from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import type { UIMessage } from "ai";
import { Card } from "../ui/card.js";
import { cn } from "../lib/cn.js";

type AnyPart = UIMessage["parts"][number];
export type ToolPart =
  | Extract<AnyPart, { type: `tool-${string}` }>
  | Extract<AnyPart, { type: "dynamic-tool" }>;

export interface PiToolPartProps {
  readonly part: ToolPart;
  readonly message?: UIMessage;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

/** 从 part 推导工具名(dynamic-tool 用 toolName,静态用 `tool-<name>`)。 */
function toolNameOf(part: ToolPart): string {
  if (part.type === "dynamic-tool") return part.toolName;
  return part.type.slice("tool-".length);
}

type ToolPhase = "start" | "update" | "end" | "error";

function phaseOf(part: ToolPart): ToolPhase {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "start";
    case "output-error":
      return "error";
    case "output-available":
      return part.preliminary === true ? "update" : "end";
    default:
      return "start";
  }
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const PHASE_LABEL: Record<ToolPhase, string> = {
  start: "Running",
  update: "Streaming",
  end: "Completed",
  error: "Error",
};

export function PiToolPart({
  part,
  defaultOpen = true,
  className,
}: PiToolPartProps): React.JSX.Element {
  const [open, setOpen] = React.useState<boolean>(defaultOpen);
  const contentId = React.useId();
  const phase = phaseOf(part);
  const name = toolNameOf(part);
  const isError = phase === "error";

  const detail =
    phase === "start"
      ? stringify(part.state === "input-available" || part.state === "input-streaming" ? part.input : undefined)
      : isError
        ? part.state === "output-error"
          ? part.errorText
          : ""
        : part.state === "output-available"
          ? stringify(part.output)
          : "";

  return (
    <Card
      className={cn(
        "overflow-hidden",
        isError && "border-[hsl(var(--destructive))]",
        className,
      )}
      data-pi-tool
      data-pi-tool-phase={phase}
      data-pi-tool-name={name}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        <Wrench className="h-4 w-4 opacity-70" aria-hidden="true" />
        <span className="font-medium">{name}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            isError
              ? "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]"
              : "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          )}
          data-pi-tool-status
        >
          {phase === "update" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : null}
          {PHASE_LABEL[phase]}
        </span>
      </button>
      {open ? (
        <div
          id={contentId}
          className={cn(
            "border-t border-[hsl(var(--border))] px-3 py-2",
            isError && "text-[hsl(var(--destructive))]",
          )}
          data-pi-tool-detail
        >
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
            {detail}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}
