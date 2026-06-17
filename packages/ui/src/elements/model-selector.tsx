/**
 * ModelSelector — 无状态的可搜索、按 provider 分组的富模型选择器。
 *
 * 自定义轻量 popover(不引入 @radix-ui/react-popover):button(显示当前模型,
 * `aria-haspopup`/`aria-expanded`)+ 受控展开面板;点击外部 / Esc 关闭(Req 11.4)。
 * 面板内:搜索框(本地过滤 groups 内 modelId/label/provider,Req 4.2)+ 按 provider
 * 分组列表 + 当前选中项打勾(lucide Check,Req 4.1);选择项 → onSelect 并关闭(Req 4.3)。
 *
 * 本元件无状态展示:不持有 pi 接线逻辑,所有模型项来自 props.groups(Req 4.5),
 * 不渲染任何写死模型项。`available=false` → 整个选择器不渲染(返回 null,Req 4.4)。
 * 主题经 shadcn CSS 变量(既有 Button 基元 + cn),无硬编码颜色(Req 11.5)。
 */
import * as React from "react";
import { ChevronsUpDown, Check, Sparkles } from "lucide-react";
import type { ModelGroup, ModelSelection } from "@pi-web/react";
import { Button } from "../ui/button.js";
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
  readonly className?: string;
}

/** 模型项展示文案:优先 label,回退 modelId。 */
function labelOf(m: ModelGroup["models"][number]): string {
  return m.label ?? m.modelId;
}

/** 本地过滤:按 modelId / label / provider 大小写不敏感匹配。 */
function filterGroups(
  groups: ReadonlyArray<ModelGroup>,
  query: string,
): ReadonlyArray<ModelGroup> {
  const q = query.trim().toLowerCase();
  if (q === "") return groups;
  const result: ModelGroup[] = [];
  for (const g of groups) {
    const models = g.models.filter(
      (m) =>
        m.modelId.toLowerCase().includes(q) ||
        (m.label ?? "").toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        g.provider.toLowerCase().includes(q),
    );
    if (models.length > 0) result.push({ provider: g.provider, models });
  }
  return result;
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
  className,
}: ModelSelectorProps): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // 点击外部关闭(jsdom 下经 document mousedown 监听可触发)。
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent): void => {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // 打开时聚焦搜索框,提升键盘可达性(Req 11.4)。
  React.useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // available=false:整个选择器不渲染(Req 4.4)。
  if (!available) return null;

  const toggle = (): void => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setQuery("");
        onOpen?.();
      }
      return next;
    });
  };

  const choose = (provider: string, modelId: string): void => {
    onSelect(provider, modelId);
    setOpen(false);
  };

  const filtered = filterGroups(groups, query);

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-block", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      data-pi-model-selector
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="gap-1.5 rounded-full"
        data-pi-model-trigger
      >
        <Sparkles className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        <span className="max-w-[12rem] truncate">
          {triggerText(current, groups, triggerLabel)}
        </span>
        <ChevronsUpDown
          className="h-3.5 w-3.5 opacity-60"
          aria-hidden="true"
        />
      </Button>

      {open ? (
        <div
          className="absolute z-50 mt-1 w-64 overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--popover,var(--background)))] text-[hsl(var(--popover-foreground,var(--foreground)))] shadow-md"
          data-pi-model-panel
        >
          <div className="border-b border-[hsl(var(--border))] p-2">
            <input
              ref={searchRef}
              type="search"
              role="searchbox"
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-[calc(var(--radius)-2px)] border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              data-pi-model-search
            />
          </div>

          {filtered.length === 0 ? (
            <p
              className="px-3 py-4 text-center text-sm text-[hsl(var(--muted-foreground))]"
              data-pi-model-empty
            >
              {emptyLabel}
            </p>
          ) : (
            <ul
              role="listbox"
              aria-label={triggerLabel}
              className="max-h-72 overflow-y-auto py-1"
              data-pi-model-list
            >
              {filtered.map((g) => (
                <li key={g.provider} role="group" aria-label={g.provider}>
                  <p
                    className="px-3 pb-1 pt-2 text-xs font-medium text-[hsl(var(--muted-foreground))]"
                    data-pi-model-group
                  >
                    {g.provider}
                  </p>
                  {g.models.map((m) => {
                    const selected =
                      current !== undefined &&
                      current.provider === m.provider &&
                      current.modelId === m.modelId;
                    return (
                      <button
                        key={`${m.provider}:${m.modelId}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => choose(m.provider, m.modelId)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--accent))] focus-visible:bg-[hsl(var(--accent))] focus-visible:outline-none",
                          selected && "font-medium",
                        )}
                        data-pi-model-option
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{labelOf(m)}</span>
                      </button>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
