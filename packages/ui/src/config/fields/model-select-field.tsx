/**
 * ModelSelectField — provider/model 可搜索下拉(widget:"providerSelect"/"modelSelect")。
 *
 * 选项来自 GET /api/config/models(已配置凭证的可用 provider/模型,含 models.json 自定义
 * provider)。自实现轻量 combobox(无 cmdk/popover 依赖):输入即过滤、点击即选,且**允许
 * 自由输入** —— 兼容列表外的值(pi 的 fuzzy model pattern)及端点为空时的降级(退化为
 * 文本框)。这正是「257 项纯滚动 Select」问题的解法。
 *
 * 取数按模块级 Promise 缓存(整页一次);测试经 __setModelOptionsFetchImpl /
 * __resetModelOptionsCache 注入与复位。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
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

const MAX_VISIBLE = 50;

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
  // undefined = 未编辑(展示当前值);string = 正在输入的查询。
  const [query, setQuery] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let alive = true;
    void loadModelOptions().then((d) => {
      if (alive) setOptions(buildOptions(descriptor.widget, d));
    });
    return () => {
      alive = false;
    };
  }, [descriptor.widget]);

  const text = query ?? current;
  const filtered = React.useMemo(() => {
    const q = text.trim().toLowerCase();
    const matched =
      q.length === 0
        ? options
        : options.filter(
            (o) =>
              o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
          );
    return { items: matched.slice(0, MAX_VISIBLE), total: matched.length };
  }, [options, text]);

  const commit = (v: string): void => {
    onChange(v);
    setQuery(undefined);
    setOpen(false);
  };

  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <div className="relative" data-pi-model-select={descriptor.widget}>
        <Input
          id={id}
          value={text}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled ?? descriptor.readOnly}
          placeholder={descriptor.placeholder ?? "输入以搜索…"}
          aria-invalid={error !== undefined}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
        />
        {open && options.length > 0 ? (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-1 shadow-md"
          >
            {filtered.items.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                无匹配 · 可直接输入自定义值
              </li>
            ) : (
              filtered.items.map((o) => (
                <li key={o.value} role="option" aria-selected={o.value === current}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(o.value);
                    }}
                    className={cn(
                      "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                      o.value === current
                        ? "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]"
                        : "hover:bg-[hsl(var(--muted))]",
                    )}
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
            {filtered.total > MAX_VISIBLE ? (
              <li className="px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                显示前 {MAX_VISIBLE} / 共 {filtered.total} 项 · 继续输入以缩小范围
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </FieldShell>
  );
}
