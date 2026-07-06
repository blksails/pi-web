/**
 * AigcModelTogglesField — AIGC 图像「模型开关」字段(widget: "aigcModelToggles",aigc-tool-settings)。
 *
 * config 域 `aigc` 的 `disabledModels` 字段(值 = 被禁 model id 数组)。渲染为图像模型勾选清单:
 * 勾选 = 启用,取消 = 禁用(加入 disabledModels)。清单来自 `GET /api/aigc/models`(纯模型目录,
 * 每项含 label + provider),复用选择器同款 provider 字母徽章与显示名。
 *
 * 取数按模块级 Promise 缓存(整页一次);测试经 __setAigcModelsFetchImpl / __resetAigcModelsCache
 * 注入与复位(仿 ModelSelectField)。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { FieldShell, errorAt } from "./field-shell.js";
/* ses-h1-exempt-next-line: config 域对 canvas-ui 的合法跨包消费(设置面板字段;sanity F3) */
import { ProviderBadge, displayNameOf } from "../../canvas/aigc-model-meta.js";

interface CatalogEntry {
  readonly model: string;
  readonly label: string;
  readonly provider: string;
}
interface CatalogResponse {
  readonly models: readonly CatalogEntry[];
}

// ── 取数(模块级缓存 + 测试注入)──
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setAigcModelsFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
let cache: Promise<CatalogResponse> | undefined;
export function __resetAigcModelsCache(): void {
  cache = undefined;
}

async function loadCatalog(): Promise<CatalogResponse> {
  if (cache === undefined) {
    cache = (async () => {
      try {
        const res = await fetchImpl("/api/aigc/models", { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Partial<CatalogResponse>;
        return { models: json.models ?? [] };
      } catch {
        return { models: [] }; // 取数失败回退空集(不阻断面板)
      }
    })();
  }
  return cache;
}

/** 值(被禁 id 数组)归一化为 string[]。 */
function asDisabled(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

export function AigcModelTogglesField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const [models, setModels] = React.useState<readonly CatalogEntry[]>([]);
  React.useEffect(() => {
    let alive = true;
    void loadCatalog().then((d) => {
      if (alive) setModels(d.models);
    });
    return () => {
      alive = false;
    };
  }, []);

  const disabledSet = React.useMemo(() => new Set(asDisabled(value)), [value]);
  const err = errorAt(errors, path);

  const toggle = (model: string, enabled: boolean): void => {
    const next = new Set(disabledSet);
    if (enabled) next.delete(model);
    else next.add(model);
    onChange([...next]);
  };

  return (
    <FieldShell descriptor={descriptor} error={err}>
      {models.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">模型清单加载中…</p>
      ) : (
        <ul data-aigc-model-toggles className="space-y-1">
          {models.map((m) => {
            const enabled = !disabledSet.has(m.model);
            return (
              <li key={m.model} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-aigc-model-toggle={m.model}
                  aria-label={m.model}
                  checked={enabled}
                  disabled={disabled}
                  onChange={(e) => toggle(m.model, e.target.checked)}
                />
                <ProviderBadge providerId={m.provider} />
                <span className="truncate text-sm" title={m.model}>
                  {displayNameOf(m.label, m.provider)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </FieldShell>
  );
}
