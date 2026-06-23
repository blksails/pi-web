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
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command.js";
import { cn } from "../../lib/cn.js";
import { FieldShell, errorAt } from "./field-shell.js";

interface ModelOption {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
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
}

/** 由响应按 widget 构造去重后的选项(modelSelect→models,providerSelect→providers)。 */
function buildOptions(widget: string | undefined, data: ModelOptionsResponse): Opt[] {
  const seen = new Set<string>();
  const out: Opt[] = [];
  if (widget === "providerSelect") {
    for (const p of data.providers) {
      if (p.length > 0 && !seen.has(p)) {
        seen.add(p);
        out.push({ value: p, label: p });
      }
    }
    return out;
  }
  // modelSelect:value 用裸 id(兼容存量值),label 附 provider 消歧;按 id 去重。
  for (const m of data.models) {
    if (m.id.length > 0 && !seen.has(m.id)) {
      seen.add(m.id);
      out.push({ value: m.id, label: `${m.id} · ${m.provider}` });
    }
  }
  return out;
}

export function ModelSelectField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const id = React.useId();
  const error = errorAt(errors, path);
  const current = typeof value === "string" ? value : "";
  const [options, setOptions] = React.useState<readonly Opt[]>([]);
  const [open, setOpen] = React.useState(false);
  const isDisabled = disabled ?? descriptor.readOnly ?? false;

  React.useEffect(() => {
    let alive = true;
    void loadModelOptions().then((d) => {
      if (alive) setOptions(buildOptions(descriptor.widget, d));
    });
    return () => {
      alive = false;
    };
  }, [descriptor.widget]);

  const selectedLabel = options.find((o) => o.value === current)?.label;
  const triggerText =
    current.length > 0
      ? (selectedLabel ?? current)
      : (descriptor.placeholder ?? "选择…");

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
                placeholder={descriptor.placeholder ?? "搜索…"}
                aria-label={descriptor.label ?? "搜索"}
              />
              <CommandList>
                <CommandEmpty>无匹配</CommandEmpty>
                {options.map((o) => {
                  const selected = o.value === current;
                  return (
                    <CommandItem
                      key={o.value}
                      value={`${o.value} ${o.label}`}
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
                    </CommandItem>
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
