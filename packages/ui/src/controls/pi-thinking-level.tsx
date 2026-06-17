/**
 * PiThinkingLevel — 思考等级选择 → usePiControls.setThinking。
 *
 * 展示可选思考等级;选择后经 `setThinking` 提交。不向 useChat 消息流写入。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@pi-web/react";
import type { ThinkingLevel } from "@pi-web/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { cn } from "../lib/cn.js";

const LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export interface PiThinkingLevelProps {
  readonly controls: UsePiControlsResult;
  readonly levels?: readonly ThinkingLevel[];
  readonly className?: string;
}

export function PiThinkingLevel({
  controls,
  levels = LEVELS,
  className,
}: PiThinkingLevelProps): React.JSX.Element {
  const op = controls.state.setThinking;
  const errorMsg =
    op.error === undefined || op.error === null
      ? undefined
      : op.error instanceof Error
        ? op.error.message
        : String(op.error);

  const onValueChange = (value: string): void => {
    void controls
      .setThinking({ level: value as ThinkingLevel })
      .catch(() => {
        // 错误态经 controls.state 暴露。
      });
  };

  return (
    <div
      className={cn("flex flex-col gap-1", className)}
      data-pi-thinking-level
    >
      <Select onValueChange={onValueChange} disabled={op.pending}>
        <SelectTrigger aria-label="Select thinking level" aria-busy={op.pending}>
          <SelectValue placeholder={op.pending ? "Switching…" : "Thinking"} />
        </SelectTrigger>
        <SelectContent>
          {levels.map((l) => (
            <SelectItem key={l} value={l}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorMsg !== undefined ? (
        <p
          role="alert"
          className="text-xs text-[hsl(var(--destructive))]"
          data-pi-thinking-error
        >
          {errorMsg}
        </p>
      ) : null}
    </div>
  );
}
