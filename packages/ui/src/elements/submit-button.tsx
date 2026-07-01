/**
 * SubmitButton — 无状态的状态化发送/停止按钮。
 *
 * 依 useChat 的 `status` 与 `canSubmit` 切换四态(Req 2.1/2.2/2.3/2.4、1.3):
 *  - ready:    显示"发送"态;仅在 `canSubmit` 时可用,点击触发 `onSubmit` (Req 2.1/1.3)。
 *  - submitted / streaming: 显示"停止/中断"态;点击触发 `onStop` 终止生成 (Req 2.2/2.3)。
 *  - error:    显示可读错误态(发送图标 + 错误/重试 aria-label);允许在有可发送内容时
 *              点击重试(触发 `onSubmit`),否则禁用 (Req 2.4)。
 *
 * 本组件不持有任何 pi 接线逻辑,仅依传入 props 渲染与本地交互。
 * 主题经 shadcn CSS 变量(既有 Button 基元 + cn),无硬编码颜色 (Req 11.5);
 * 始终带 `aria-label` 以满足无障碍 (Req 11.4)。
 */
import * as React from "react";
import { type ChatStatus } from "ai";
import { ArrowUp, Square, RotateCcw } from "lucide-react";
import { useIcon } from "../customization/icons.js";
import { useI18n } from "../i18n/index.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export interface SubmitButtonProps {
  /** useChat 的会话状态。 */
  readonly status: ChatStatus;
  /** 是否有可发送内容(非空文本或附件);决定 ready/error 态可用性 (Req 1.3)。 */
  readonly canSubmit: boolean;
  /** ready / error(重试)态点击发送。 */
  readonly onSubmit: () => void;
  /** submitted / streaming 态点击中断生成 (Req 2.3)。 */
  readonly onStop: () => void;
  /** 各态无障碍标签覆盖(默认中文)。 */
  readonly submitLabel?: string;
  readonly stopLabel?: string;
  readonly retryLabel?: string;
  readonly className?: string;
}

export function SubmitButton({
  status,
  canSubmit,
  onSubmit,
  onStop,
  submitLabel,
  stopLabel,
  retryLabel,
  className,
}: SubmitButtonProps): React.JSX.Element {
  const t = useI18n();
  const resolvedSubmitLabel = submitLabel ?? t("submitButton.send");
  const resolvedStopLabel = stopLabel ?? t("submitButton.stop");
  const resolvedRetryLabel = retryLabel ?? t("submitButton.retry");
  const isBusy = status === "submitted" || status === "streaming";
  const isError = status === "error";

  const SendIcon = useIcon("send", ArrowUp);
  const StopIcon = useIcon("stop", Square);
  const RetryIcon = useIcon("retry", RotateCcw);

  if (isBusy) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={resolvedStopLabel}
        onClick={onStop}
        className={cn("rounded-full", className)}
        data-pi-submit-state="stop"
      >
        <StopIcon className="h-4 w-4 fill-current" aria-hidden="true" />
      </Button>
    );
  }

  const label = isError ? resolvedRetryLabel : resolvedSubmitLabel;

  return (
    <Button
      type="button"
      variant={isError ? "destructive" : "default"}
      size="icon"
      aria-label={label}
      disabled={!canSubmit}
      onClick={onSubmit}
      className={cn("rounded-full", className)}
      data-pi-submit-state={isError ? "error" : "send"}
    >
      {isError ? (
        <RetryIcon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <SendIcon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
