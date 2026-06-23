/**
 * PiModelSelector — 模型选择 → usePiControls.setModel。
 *
 * UI 复用 elements/ModelSelector(shadcn Combobox:Popover 向上弹出 + Command 可搜索),
 * 与富版选择器风格统一。选择后经 `setModel` 提交;进行中态(controls.state.setModel.pending
 * → 触发器 aria-busy + 禁用);失败显示可辨识错误(controls.state.setModel.error)不静默。
 * 不向 useChat 消息流写入。
 */
import * as React from "react";
import type { UsePiControlsResult } from "@pi-web/react";
import type { ModelGroup } from "@pi-web/react";
import { ModelSelector } from "../elements/model-selector.js";
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

/** 扁平 models 按 provider 分组(保持首次出现顺序),供 ModelSelector 渲染。 */
function toGroups(models: readonly PiModelOption[]): ModelGroup[] {
  const order: string[] = [];
  const byProvider = new Map<string, ModelGroup["models"][number][]>();
  for (const m of models) {
    if (!byProvider.has(m.provider)) {
      byProvider.set(m.provider, []);
      order.push(m.provider);
    }
    byProvider.get(m.provider)!.push({
      provider: m.provider,
      modelId: m.modelId,
      ...(m.label !== undefined ? { label: m.label } : {}),
    });
  }
  return order.map((provider) => ({
    provider,
    models: byProvider.get(provider)!,
  }));
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

  const groups = React.useMemo(() => toGroups(models), [models]);

  const onSelect = (provider: string, modelId: string): void => {
    void controls.setModel({ provider, modelId }).catch(() => {
      // 错误态经 controls.state 暴露;此处吞掉以免未捕获 rejection。
    });
  };

  return (
    <div className={cn("flex flex-col gap-1", className)} data-pi-model-selector>
      <ModelSelector
        groups={groups}
        current={undefined}
        available
        onSelect={onSelect}
        triggerLabel="Select model"
        busy={op.pending}
        disabled={op.pending}
      />
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
