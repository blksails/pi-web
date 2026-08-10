/**
 * ProviderVisibilityField — providers 设置面板的 provider / 模型展示配置控件
 * (provider-visibility-config spec 任务 3.1;Req 1.1–1.4, 2.3, 2.5, 3.1, 3.3,
 * 4.1, 4.5, 4.6, 5.3)。
 *
 * 由既有只读汇总 `ProviderRegistrySummary` 升级而来:清单取数与三档来源分类原样
 * 保留(那部分逻辑连同它踩过的坑一起沿用,见下),在其上加可见性开关与逐模型勾选。
 *
 * ★ 取数**必须**带筛选参数,不能零参数调用 `/api/config/models`:
 * `config-routes.ts` 的装配闭包对「URL 上 input/output 均缺席」有专门处理 —— 刻意
 * 退回旧版 `chatOptions()`(multi-gateway-providers Req 10.1 的字节兼容承诺),那条
 * 路径**不含**自定义 provider 与图像目录,零参数请求会让本清单恒空(已用真实网关
 * 实测复现)。故按 `output=text` 与 `output=image` 各取一次再合并。
 *
 * ★ 本控件是「静态 schema + 动态 values」架构的产物:表单 schema 在 protocol 里保持
 * 静态、只打 `widget: "providerVisibility"` 标记,运行时清单由本控件自己取数。在后端
 * enrich formSchema 是无效的(前端只消费 `json.values`,丢弃 `formSchema`)。
 *
 * ★ 语义边界:本控件配的是**展示**——关掉只让 provider / 模型从清单与选择器里消失,
 * 已有会话与工具照常可用(Req 3.1 要求在界面上明示这一点)。彻底禁用是部署方的
 * `PI_WEB_HIDE_PROVIDERS`,被它禁掉的 provider 根本不会出现在本清单里(Req 3.2)。
 */
import * as React from "react";
import { useI18n } from "../i18n/index.js";
import type { FieldProps } from "./field-registry.js";

interface CatalogModel {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
  readonly source: string;
}
interface ModelsResponse {
  readonly models?: readonly CatalogModel[];
}

/** 单个 provider 的可见性(与 protocol 的 providers 域 `visibility` 值同形)。 */
export interface ProviderVisibilityValue {
  readonly hidden?: boolean;
  readonly hiddenModels?: readonly string[];
}
export type ProviderVisibilityMap = Readonly<Record<string, ProviderVisibilityValue>>;

let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
/** 测试注入点(风格同 model-select-field 的 __set*FetchImpl)。 */
export function __setProviderVisibilityFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
export function __resetProviderVisibilityFetchImpl(): void {
  fetchImpl = (...args) => globalThis.fetch(...args);
}

type SourceCategory = "builtin" | "cloud" | "custom";

/** `CatalogModel.source` 原始字符串 → Req 7.1 的三档分类(沿用既有汇总的判据)。 */
function categoryOf(source: string): SourceCategory {
  if (source === "custom") return "custom";
  // 预留:云端下发来源接入后取一个稳定前缀/字面量,此处先按字面量匹配。
  if (source === "cloud") return "cloud";
  return "builtin";
}

interface ProviderRow {
  readonly provider: string;
  readonly category: SourceCategory;
  readonly models: readonly { readonly id: string; readonly name: string }[];
  /**
   * true = 该行不是从目录取来的,而是据配置补回的(见 `mergeHiddenRows`)。
   * 这类行没有来源与模型信息可显示,但必须存在,否则使用者无法把它改回可见。
   */
  readonly restoredFromConfig?: boolean;
}

/**
 * 合并多批取数结果,按 `${provider}/${id}` 去重(两批可能对同一 provider 各贡献不
 * 相交的模型集,不去重会重复计数)。
 */
function summarize(batches: readonly (readonly CatalogModel[])[]): readonly ProviderRow[] {
  const order: string[] = [];
  const byProvider = new Map<
    string,
    { category: SourceCategory; models: Map<string, string> }
  >();
  for (const models of batches) {
    for (const m of models) {
      let entry = byProvider.get(m.provider);
      if (entry === undefined) {
        entry = { category: categoryOf(m.source), models: new Map() };
        byProvider.set(m.provider, entry);
        order.push(m.provider);
      }
      if (!entry.models.has(m.id)) entry.models.set(m.id, m.name ?? m.id);
    }
  }
  return order.map((provider) => {
    const entry = byProvider.get(provider)!;
    return {
      provider,
      category: entry.category,
      models: [...entry.models].map(([id, name]) => ({ id, name })),
    };
  });
}

/**
 * ★ 把「配置里已隐藏、但目录已不再返回」的 provider 补回清单(Req 1.4)。
 *
 * 本控件取数走的是 `/api/config/models` —— 而那正是被可见性过滤的出口。于是一旦
 * 隐藏某个 provider,它下次就不会再出现在取数结果里,行也就没了,使用者**再也无法
 * 把它改回可见**(单向门)。这个缺陷单测抓不到:测试里的 fetch 是 stub,恒返回全集。
 * 是浏览器 e2e 在真实数据流上抓到的。
 *
 * 补回的行没有来源与模型信息(目录里查不到),只承担一件事:让使用者能点回来。
 */
function mergeHiddenRows(
  rows: readonly ProviderRow[],
  visibility: ProviderVisibilityMap,
): readonly ProviderRow[] {
  const known = new Set(rows.map((r) => r.provider));
  const missing = Object.entries(visibility)
    .filter(([provider, entry]) => entry?.hidden === true && !known.has(provider))
    .map(([provider]) => ({
      provider,
      category: "builtin" as SourceCategory,
      models: [] as readonly { readonly id: string; readonly name: string }[],
      restoredFromConfig: true,
    }));
  return missing.length === 0 ? rows : [...rows, ...missing];
}

const BADGE_CLASS: Readonly<Record<SourceCategory, string>> = {
  builtin: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  cloud: "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]",
  custom: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
};

/** 读当前值里某 provider 的条目(缺省即全可见)。 */
function entryOf(value: ProviderVisibilityMap, provider: string): ProviderVisibilityValue {
  return value[provider] ?? {};
}

/**
 * 写回一个 provider 的条目;写成「全可见」时**删键**而非留空壳 —— 使配置回到
 * 未配置状态,零侵入判据(空配置直通)因此在改回全可见后重新成立。
 */
function withEntry(
  value: ProviderVisibilityMap,
  provider: string,
  next: ProviderVisibilityValue,
): ProviderVisibilityMap {
  const isEmpty =
    next.hidden !== true && (next.hiddenModels === undefined || next.hiddenModels.length === 0);
  const out: Record<string, ProviderVisibilityValue> = { ...value };
  if (isEmpty) delete out[provider];
  else out[provider] = next;
  return out;
}

/** 宽松窄化:磁盘上的值理应已经过 schema 校验,但控件对脏值仍须 fail-soft。 */
function asVisibilityMap(value: unknown): ProviderVisibilityMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as ProviderVisibilityMap;
}

export function ProviderVisibilityField({
  value,
  onChange,
  disabled,
}: FieldProps): React.JSX.Element {
  const t = useI18n();
  const current: ProviderVisibilityMap = asVisibilityMap(value);
  const [rows, setRows] = React.useState<readonly ProviderRow[] | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | undefined>(undefined);
  const [filter, setFilter] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    let anyFailed = false;
    const fetchOne = async (output: "text" | "image"): Promise<readonly CatalogModel[]> => {
      try {
        // ★ 带筛选参数是硬要求,见文件头注。
        const res = await fetchImpl(`/api/config/models?output=${output}`, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ModelsResponse;
        return json.models ?? [];
      } catch {
        anyFailed = true;
        return [];
      }
    };
    void (async (): Promise<void> => {
      const [textModels, imageModels] = await Promise.all([fetchOne("text"), fetchOne("image")]);
      if (!alive) return;
      // 取数失败与「确实没有 provider」是两回事,必须能分辨(Req 1.3)。
      setFailed(anyFailed && textModels.length === 0 && imageModels.length === 0);
      setRows(summarize([textModels, imageModels]));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const labelOf = (c: SourceCategory): string =>
    c === "custom"
      ? t("config.providerRegistry.sourceCustom")
      : c === "cloud"
        ? t("config.providerRegistry.sourceCloud")
        : t("config.providerRegistry.sourceBuiltin");

  const toggleProvider = (row: ProviderRow): void => {
    const entry = entryOf(current, row.provider);
    const nextHidden = entry.hidden !== true;
    if (nextHidden && !globalThis.confirm(t("config.providerVisibility.confirmHideProvider"))) {
      return;
    }
    onChange(withEntry(current, row.provider, { ...entry, hidden: nextHidden }));
  };

  const toggleModel = (row: ProviderRow, modelId: string): void => {
    const entry = entryOf(current, row.provider);
    const hiddenModels = entry.hiddenModels ?? [];
    const isHidden = hiddenModels.includes(modelId);
    const nextModels = isHidden
      ? hiddenModels.filter((m) => m !== modelId)
      : [...hiddenModels, modelId];
    // 勾光某 provider 的全部模型 = 它将没有可选模型,须确认(Req 4.5)。
    if (
      !isHidden &&
      nextModels.length >= row.models.length &&
      !globalThis.confirm(t("config.providerVisibility.confirmHideAllModels"))
    ) {
      return;
    }
    onChange(withEntry(current, row.provider, { ...entry, hiddenModels: nextModels }));
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3"
      data-pi-provider-visibility
    >
      <h3 className="text-sm font-medium">{t("config.providerRegistry.title")}</h3>
      {/* Req 3.1:在开关处明示作用范围仅为展示。 */}
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {t("config.providerVisibility.scopeNote")}
      </p>

      {rows === undefined ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("common.loading")}</p>
      ) : failed ? (
        <p className="text-xs text-[hsl(var(--destructive))]" data-pi-provider-visibility-error>
          {t("config.providerVisibility.loadFailed")}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {t("config.providerRegistry.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {mergeHiddenRows(rows, current).map((row) => {
            const entry = entryOf(current, row.provider);
            const providerHidden = entry.hidden === true;
            const hiddenModels = entry.hiddenModels ?? [];
            const isOpen = expanded === row.provider;
            const visibleCount = row.models.filter((m) => !hiddenModels.includes(m.id)).length;
            const shown = isOpen
              ? row.models.filter(
                  (m) =>
                    filter.trim() === "" ||
                    m.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
                    m.id.toLowerCase().includes(filter.trim().toLowerCase()),
                )
              : [];
            return (
              <li key={row.provider} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left font-mono"
                    onClick={() => {
                      setExpanded(isOpen ? undefined : row.provider);
                      setFilter("");
                    }}
                    data-pi-provider-row={row.provider}
                  >
                    <span className={providerHidden ? "line-through opacity-60" : undefined}>
                      {row.provider}
                    </span>
                    {row.restoredFromConfig === true ? null : (
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] ${BADGE_CLASS[row.category]}`}
                      >
                        {labelOf(row.category)}
                      </span>
                    )}
                    {/* Req 1.4:被自己隐藏的 provider 仍列出并标明状态,以便改回来。 */}
                    {providerHidden ? (
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        {t("config.providerVisibility.hiddenTag")}
                      </span>
                    ) : null}
                  </button>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-[hsl(var(--muted-foreground))]">
                      {visibleCount}
                      {visibleCount === row.models.length ? "" : ` / ${row.models.length}`}
                    </span>
                    <input
                      type="checkbox"
                      checked={!providerHidden}
                      disabled={disabled}
                      onChange={() => toggleProvider(row)}
                      aria-label={`${row.provider} ${t("config.providerVisibility.toggleLabel")}`}
                      data-pi-provider-toggle={row.provider}
                    />
                  </span>
                </div>

                {isOpen ? (
                  <div className="flex flex-col gap-1 pl-3">
                    {/* Req 4.6:长清单要能按名称收敛。 */}
                    <input
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder={t("config.providerVisibility.filterPlaceholder")}
                      className="rounded border border-[hsl(var(--border))] px-2 py-1 text-xs"
                      data-pi-model-filter
                    />
                    <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                      {shown.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-mono" title={m.id}>
                            {m.name}
                          </span>
                          <input
                            type="checkbox"
                            checked={!hiddenModels.includes(m.id)}
                            disabled={disabled || providerHidden}
                            onChange={() => toggleModel(row, m.id)}
                            aria-label={m.id}
                            data-pi-model-toggle={m.id}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
