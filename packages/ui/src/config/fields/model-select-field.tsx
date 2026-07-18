/**
 * ModelSelectField — provider/model 选择(widget:"providerSelect"/"modelSelect")。
 *
 * shadcn 推荐 Combobox(Popover + Command/cmdk):trigger 显示当前值,面板内搜索 + 列表选择。
 * 选项来自 GET /api/config/models(已配置凭证的可用 provider/模型,含 models.json 自定义
 * provider)。
 *
 * 注:本版改为**从列表选**(与全站 ModelSelector 统一);不再支持列表外自由输入 / fuzzy
 * pattern。存量自定义值仍会在 trigger 上原样显示(可见),但只能改选为列表内选项。
 *
 * 取数按模块级 Promise 缓存(整页一次);测试经 __setModelOptionsFetchImpl /
 * __resetModelOptionsCache 注入与复位。
 */
import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { FieldProps } from "../field-registry.js";
import { Button } from "../../ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command.js";
import { cn } from "../../lib/cn.js";
import { useI18n } from "../../i18n/index.js";
import { FieldShell, errorAt } from "./field-shell.js";

interface ModelOption {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  /**
   * 来源标记(ai-gateway-providers spec,Req 4.2):`"ai-gateway"` = 网关托管目录,
   * `"self"` = 自配 provider 目录。仅在装配端启用 ai-gateway 套件并聚合目录后才会
   * 出现;未启用时该字段不存在,不渲染徽章(与启用前逐字节一致)。
   */
  readonly source?: "ai-gateway" | "self";
}
interface ModelOptionsResponse {
  readonly providers: readonly string[];
  readonly models: readonly ModelOption[];
}

// ── 取数(模块级缓存 + 测试注入)──
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setModelOptionsFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
let cache: Promise<ModelOptionsResponse> | undefined;
export function __resetModelOptionsCache(): void {
  cache = undefined;
}

async function loadModelOptions(): Promise<ModelOptionsResponse> {
  if (cache === undefined) {
    cache = (async (): Promise<ModelOptionsResponse> => {
      try {
        const res = await fetchImpl("/api/config/models", { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Partial<ModelOptionsResponse>;
        return { providers: json.providers ?? [], models: json.models ?? [] };
      } catch {
        return { providers: [], models: [] };
      }
    })();
  }
  return cache;
}

interface Opt {
  readonly value: string;
  readonly label: string;
  /** 来源徽章(仅 modelSelect 组透传;providerSelect 恒为 undefined)。 */
  readonly source?: "ai-gateway" | "self";
}
/** 选项分组:`provider === ""` 表示无分组标题的平铺组(providerSelect 用)。 */
interface OptGroup {
  readonly provider: string;
  readonly options: readonly Opt[];
}

/**
 * 由响应按 widget 构造分组选项:
 * - providerSelect → 单个无标题平铺组(选项即 provider 名,去重)。
 * - modelSelect → 按 provider 分组(每组标题为 provider,组内项 label 用裸 id、value 用裸
 *   id 兼容存量值;组内按 id 去重,保持出现顺序)。
 */
function buildGroups(widget: string | undefined, data: ModelOptionsResponse): OptGroup[] {
  if (widget === "providerSelect") {
    const seen = new Set<string>();
    const opts: Opt[] = [];
    for (const p of data.providers) {
      if (p.length > 0 && !seen.has(p)) {
        seen.add(p);
        opts.push({ value: p, label: p });
      }
    }
    return [{ provider: "", options: opts }];
  }
  const order: string[] = [];
  const map = new Map<string, Opt[]>();
  for (const m of data.models) {
    if (m.id.length === 0) continue;
    let bucket = map.get(m.provider);
    if (bucket === undefined) {
      bucket = [];
      map.set(m.provider, bucket);
      order.push(m.provider);
    }
    if (!bucket.some((o) => o.value === m.id)) {
      bucket.push({ value: m.id, label: m.id, source: m.source });
    }
  }
  return order.map((provider) => ({ provider, options: map.get(provider) ?? [] }));
}

/** 当前选中值在分组中的展示文案:模型项附 ` · provider` 消歧,provider 项即其名。 */
function triggerLabelFor(
  groups: readonly OptGroup[],
  current: string,
): string | undefined {
  for (const g of groups) {
    for (const o of g.options) {
      if (o.value === current) {
        return g.provider.length > 0 ? `${o.label} · ${g.provider}` : o.label;
      }
    }
  }
  return undefined;
}

export function ModelSelectField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const t = useI18n();
  const id = React.useId();
  const error = errorAt(errors, path);
  const current = typeof value === "string" ? value : "";
  const [groups, setGroups] = React.useState<readonly OptGroup[]>([]);
  const [open, setOpen] = React.useState(false);
  const isDisabled = disabled ?? descriptor.readOnly ?? false;

  React.useEffect(() => {
    let alive = true;
    void loadModelOptions().then((d) => {
      if (alive) setGroups(buildGroups(descriptor.widget, d));
    });
    return () => {
      alive = false;
    };
  }, [descriptor.widget]);

  const selectedLabel = triggerLabelFor(groups, current);
  const triggerText =
    current.length > 0
      ? (selectedLabel ?? current)
      : (descriptor.placeholder ?? t("config.modelSelect.triggerPlaceholder"));

  const commit = (v: string): void => {
    onChange(v);
    setOpen(false);
  };

  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <div data-pi-model-select={descriptor.widget}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-invalid={error !== undefined}
              disabled={isDisabled}
              className={cn(
                "w-full justify-between font-normal",
                current.length === 0 && "text-[hsl(var(--muted-foreground))]",
              )}
            >
              <span className="truncate">{triggerText}</span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] p-0"
            align="start"
          >
            <Command>
              <CommandInput
                placeholder={descriptor.placeholder ?? t("config.modelSelect.searchPlaceholder")}
                aria-label={descriptor.label ?? t("config.modelSelect.searchAria")}
              />
              <CommandList>
                <CommandEmpty>{t("config.modelSelect.empty")}</CommandEmpty>
                {groups.map((g) => {
                  const items = g.options.map((o) => {
                    const selected = o.value === current;
                    return (
                      <CommandItem
                        key={`${g.provider}:${o.value}`}
                        value={`${o.value} ${g.provider}`}
                        onSelect={() => commit(o.value)}
                      >
                        <Check
                          className={cn(
                            "h-4 w-4 shrink-0",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{o.label}</span>
                        {o.source !== undefined && (
                          <span
                            data-pi-model-source={o.source}
                            className={cn(
                              "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
                              o.source === "ai-gateway"
                                ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]"
                                : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
                            )}
                          >
                            {o.source === "ai-gateway"
                              ? t("config.modelSelect.sourceAiGateway")
                              : t("config.modelSelect.sourceSelf")}
                          </span>
                        )}
                      </CommandItem>
                    );
                  });
                  // provider === "" 表示无分组标题(providerSelect),平铺渲染。
                  return g.provider.length > 0 ? (
                    <CommandGroup key={g.provider} heading={g.provider}>
                      {items}
                    </CommandGroup>
                  ) : (
                    <React.Fragment key="__flat">{items}</React.Fragment>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </FieldShell>
  );
}
