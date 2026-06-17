/**
 * PiModelSelector — 模型选择 → usePiControls.setModel。
 *
 * 展示可选模型列表;选择后经 `setModel` 提交;进行中态(controls.state.setModel.pending);
 * 失败显示可辨识错误(controls.state.setModel.error)不静默。不向 useChat 消息流写入。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@pi-web/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { cn } from "../lib/cn.js";

export interface PiModelOption {
  readonly provider: string;
  readonly modelId: string;
  readonly label?: string;
}

export interface PiModelSelectorProps {
  readonly controls: UsePiControlsResult;
  /** 可选模型列表;由宿主提供(本层不持服务端真值)。 */
  readonly models?: readonly PiModelOption[];
  readonly className?: string;
}

function keyOf(o: PiModelOption): string {
  return `${o.provider}:${o.modelId}`;
}

export function PiModelSelector({
  controls,
  models = [],
  className,
}: PiModelSelectorProps): React.JSX.Element {
  const op = controls.state.setModel;
  const errorMsg =
    op.error === undefined || op.error === null
      ? undefined
      : op.error instanceof Error
        ? op.error.message
        : String(op.error);

  const onValueChange = (value: string): void => {
    const found = models.find((m) => keyOf(m) === value);
    if (found === undefined) return;
    void controls
      .setModel({ provider: found.provider, modelId: found.modelId })
      .catch(() => {
        // 错误态经 controls.state 暴露;此处吞掉以免未捕获 rejection。
      });
  };

  return (
    <div className={cn("flex flex-col gap-1", className)} data-pi-model-selector>
      <Select onValueChange={onValueChange} disabled={op.pending}>
        <SelectTrigger aria-label="Select model" aria-busy={op.pending}>
          <SelectValue placeholder={op.pending ? "Switching…" : "Model"} />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={keyOf(m)} value={keyOf(m)}>
              {m.label ?? m.modelId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorMsg !== undefined ? (
        <p
          role="alert"
          className="text-xs text-[hsl(var(--destructive))]"
          data-pi-model-error
        >
          {errorMsg}
        </p>
      ) : null}
    </div>
  );
}
