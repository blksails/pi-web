/**
 * PiThinkingLevel — 思考等级选择 → usePiControls.setThinking。
 *
 * 展示可选思考等级;选择后经 `setThinking` 提交。不向 useChat 消息流写入。
 */
import * as React from "react";
import { Brain } from "lucide-react";
import type { UsePiControlsResult } from "@blksails/pi-web-react";
import type { ThinkingLevel } from "@blksails/pi-web-protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../ui/select.js";
import { cn } from "../lib/cn.js";
import { useI18n } from "../i18n/index.js";

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
  const t = useI18n();
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
      className={cn("inline-flex flex-col gap-1", className)}
      data-pi-thinking-level
    >
      <Select onValueChange={onValueChange} disabled={op.pending}>
        {/* 纯图标触发器:方圆按钮只显示 Brain 图标;隐藏 SelectTrigger 内置的下拉箭头
            ([&>svg:last-child]:hidden),避免在工具条里占用过宽。当前等级经 title/aria 暴露。 */}
        <SelectTrigger
          aria-label={t("thinkingLevel.aria.select")}
          aria-busy={op.pending}
          title={op.pending ? t("thinkingLevel.status.switching") : t("thinkingLevel.title")}
          className="h-8 w-8 justify-center gap-0 rounded-full p-0 [&>svg:last-child]:hidden"
        >
          <Brain
            className={cn("h-4 w-4 opacity-70", op.pending && "animate-pulse")}
            aria-hidden="true"
          />
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
