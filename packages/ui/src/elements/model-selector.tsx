/**
 * ModelSelector — 无状态的可搜索、按 provider 分组的富模型选择器。
 *
 * shadcn 推荐的 Combobox 实现:Popover(向上弹出 side=top,自动避让)+ Command(cmdk
 * 内建模糊搜索/键盘导航/分组/空态)。trigger 显示当前模型(`aria-haspopup`/`aria-expanded`);
 * 面板内搜索框(按 modelId/label/provider 过滤,Req 4.2)+ 按 provider 分组列表 + 当前项
 * 打勾(Req 4.1);选择 → onSelect 并关闭(Req 4.3)。
 *
 * 无状态展示:不持 pi 接线,所有模型项来自 props.groups(Req 4.5),不渲染写死项。
 * `available=false` → 整个选择器不渲染(返回 null,Req 4.4)。主题经 shadcn CSS 变量。
 */
import * as React from "react";
import { ChevronsUpDown, Check, Sparkles } from "lucide-react";
import type { ModelGroup, ModelSelection } from "@blksails/react";
import { useIcon } from "../customization/icons.js";
import { Button } from "../ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command.js";
import { cn } from "../lib/cn.js";

export interface ModelSelectorProps {
  /** 可用模型(按 provider 分组,来自 useModels.groups)(Req 4.1/4.5)。 */
  readonly groups: ReadonlyArray<ModelGroup>;
  /** 当前选中模型;无则不打勾(Req 4.1)。 */
  readonly current: ModelSelection | undefined;
  /** get_available_models 是否可用且非空;false 时整个选择器不渲染(Req 4.4)。 */
  readonly available: boolean;
  /** 选择某模型(Req 4.3)。 */
  readonly onSelect: (provider: string, modelId: string) => void;
  /** 面板打开回调,用于触发 useModels.ensureLoaded 懒加载(可选,Req 4.1)。 */
  readonly onOpen?: () => void;
  /** 触发按钮无障碍标签 / 占位,默认中文。 */
  readonly triggerLabel?: string;
  /** 搜索框占位,默认中文。 */
  readonly searchPlaceholder?: string;
  /** 无匹配提示,默认中文。 */
  readonly emptyLabel?: string;
  /** 禁用触发器(如外部进行中态);禁用时不可打开。 */
  readonly disabled?: boolean;
  /** 触发器 aria-busy(如 setModel 进行中);仅无障碍提示,不阻断。 */
  readonly busy?: boolean;
  readonly className?: string;
}

/** 模型项展示文案:优先 label,回退 modelId。 */
function labelOf(m: ModelGroup["models"][number]): string {
  return m.label ?? m.modelId;
}

/** cmdk 过滤键:拼 provider/modelId/label,使三者任一可被搜索命中(Req 4.2)。 */
function filterValue(m: ModelGroup["models"][number]): string {
  return `${m.provider} ${m.modelId} ${labelOf(m)}`;
}

function triggerText(
  current: ModelSelection | undefined,
  groups: ReadonlyArray<ModelGroup>,
  fallback: string,
): string {
  if (current === undefined) return fallback;
  for (const g of groups) {
    for (const m of g.models) {
      if (m.provider === current.provider && m.modelId === current.modelId) {
        return labelOf(m);
      }
    }
  }
  return current.modelId;
}

export function ModelSelector({
  groups,
  current,
  available,
  onSelect,
  onOpen,
  triggerLabel = "模型",
  searchPlaceholder = "搜索模型…",
  emptyLabel = "无匹配模型",
  disabled,
  busy,
  className,
}: ModelSelectorProps): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);

  const ModelIcon = useIcon("model", ChevronsUpDown);
  const CheckIcon = useIcon("modelCheck", Check);

  // available=false:整个选择器不渲染(Req 4.4)。
  if (!available) return null;

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) onOpen?.(); // 打开时触发懒加载(Req 4.1)。
  };

  const choose = (provider: string, modelId: string): void => {
    onSelect(provider, modelId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={triggerLabel}
          aria-busy={busy === true ? true : undefined}
          disabled={disabled}
          className={cn("gap-1.5 rounded-full", className)}
          data-pi-model-selector
          data-pi-model-trigger
        >
          <Sparkles className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          <span className="max-w-[12rem] truncate">
            {triggerText(current, groups, triggerLabel)}
          </span>
          <ModelIcon className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-0"
        data-pi-model-panel
      >
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            data-pi-model-search
          />
          <CommandList aria-label={triggerLabel} data-pi-model-list>
            <CommandEmpty data-pi-model-empty>{emptyLabel}</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup
                key={g.provider}
                heading={g.provider}
                data-pi-model-group
              >
                {g.models.map((m) => {
                  const selected =
                    current !== undefined &&
                    current.provider === m.provider &&
                    current.modelId === m.modelId;
                  return (
                    <CommandItem
                      key={`${m.provider}:${m.modelId}`}
                      value={filterValue(m)}
                      onSelect={() => choose(m.provider, m.modelId)}
                      data-pi-model-option
                      {...(selected
                        ? { "data-pi-model-current": "true" }
                        : {})}
                    >
                      <CheckIcon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          selected ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{labelOf(m)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
