/**
 * ProviderRegistrySummary — providers 设置面板顶部的只读清单(multi-gateway-providers
 * 任务 5.4;Req 7.1)。
 *
 * Req 7.1:「设置界面 shall 列出全部 provider,并标明每个来自内置注册、云端下发还是
 * 使用者自定义」——这与下方 `providers` objectList 字段是两件事:objectList 只承载
 * **使用者自己新增**的自定义条目(可增删/可编辑),不包含部署方配置的网关实例、本地
 * `models.json` 里的 provider 这些"内置注册"来源;要把三类**放进同一份清单**只能取自
 * 已经把三者聚合到同一命名空间的统一目录端点(`GET /api/config/models`,
 * `ModelCatalogService.query()` 的产出,`CatalogModel.source` 已标注每条目的来源)。
 *
 * ★ 取数**必须**带筛选参数,不能零参数调用该端点:`config-routes.ts` 的装配闭包
 * (`lib/app/pi-handler.ts` 的 `listModelOptions`)对"URL 上 `input`/`output` 均缺席"这一
 * 特定形态有专门处理——刻意退回旧版 `chatOptions()`(Req 10.1「零筛选 = 行为不变」的
 * 字节兼容承诺),那条路径**不含**自定义 provider 与图像目录,零参数请求会让本组件
 * 恒空(已用真实网关实测复现)。故分别按 `output=text`(覆盖对话类 provider,含大多数
 * 自定义 provider——未声明 output 时缺省即补 `["text"]`,见 `modality.ts`
 * `normalizeModalities`)与 `output=image`(覆盖 AIGC 图像类 provider)各取一次再合并,
 * 覆盖当前产品实际存在的两大类;若自定义 provider 只声明了 video/audio 输出,本清单
 * 暂时看不到它(与"零筛选恒等"这条更高优先级的兼容承诺冲突,取舍已在此处写明)。
 *
 * 来源分类只有三档(与 Req 7.1 的字面三分类对齐):
 *  - `"custom"`(`assembleCustomProviderModels` 写死的字面量,见 model-catalog/service.ts)
 *    → 使用者自定义。
 *  - 未来云端下发来源(Req 8,当前尚未接入,`source` 永不会是该值,写在这里是前向兼容,
 *    接入时零改动本组件)→ 云端下发。
 *  - 其余(`"self"`、网关实例标识、`"cloudflare"` 等)→ 内置注册:凡是不经由本面板的
 *    「新增」按钮产生的 provider,对使用者而言都是部署方已经配好的。
 */
import * as React from "react";
import { useI18n } from "../i18n/index.js";

interface CatalogModel {
  readonly provider: string;
  readonly id: string;
  readonly source: string;
}
interface ModelsResponse {
  readonly models?: readonly CatalogModel[];
}

let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
/** 测试注入点(风格同 model-select-field 的 __set*FetchImpl)。 */
export function __setProviderRegistryFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
export function __resetProviderRegistryFetchImpl(): void {
  fetchImpl = (...args) => globalThis.fetch(...args);
}

type SourceCategory = "builtin" | "cloud" | "custom";

/** `CatalogModel.source` 原始字符串 → Req 7.1 的三档分类。 */
function categoryOf(source: string): SourceCategory {
  if (source === "custom") return "custom";
  // 预留:云端下发来源接入后取一个稳定前缀/字面量,此处先按字面量匹配(Req 8)。
  if (source === "cloud") return "cloud";
  return "builtin";
}

interface ProviderRow {
  readonly provider: string;
  readonly category: SourceCategory;
  readonly modelCount: number;
}

/**
 * 合并多批取数结果并按 `${provider}/${id}` 去重计数(`output=text` 与 `output=image`
 * 两批可能对同一 provider 各贡献不相交的模型集,不去重会重复计数;理论上同一
 * provider+id 组合不会同时具备两种截然不同的 output 声明,但去重使计数在边界情况下
 * 仍然可靠)。
 */
function summarize(batches: readonly (readonly CatalogModel[])[]): readonly ProviderRow[] {
  const order: string[] = [];
  const byProvider = new Map<string, { category: SourceCategory; ids: Set<string> }>();
  for (const models of batches) {
    for (const m of models) {
      let entry = byProvider.get(m.provider);
      if (entry === undefined) {
        entry = { category: categoryOf(m.source), ids: new Set() };
        byProvider.set(m.provider, entry);
        order.push(m.provider);
      }
      entry.ids.add(m.id);
    }
  }
  return order.map((provider) => {
    const entry = byProvider.get(provider)!;
    return { provider, category: entry.category, modelCount: entry.ids.size };
  });
}

const BADGE_CLASS: Readonly<Record<SourceCategory, string>> = {
  builtin: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  cloud: "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]",
  custom: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
};

export function ProviderRegistrySummary(): React.JSX.Element {
  const t = useI18n();
  const [rows, setRows] = React.useState<readonly ProviderRow[] | undefined>(undefined);

  React.useEffect(() => {
    let alive = true;
    const fetchOne = async (output: "text" | "image"): Promise<readonly CatalogModel[]> => {
      try {
        const res = await fetchImpl(`/api/config/models?output=${output}`, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ModelsResponse;
        return json.models ?? [];
      } catch {
        return [];
      }
    };
    void (async (): Promise<void> => {
      const [textModels, imageModels] = await Promise.all([fetchOne("text"), fetchOne("image")]);
      if (alive) setRows(summarize([textModels, imageModels]));
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

  return (
    <section className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3" data-pi-provider-registry>
      <h3 className="text-sm font-medium">{t("config.providerRegistry.title")}</h3>
      {rows === undefined ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("config.providerRegistry.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.provider}
              className="flex items-center gap-2 text-sm"
              data-pi-provider-registry-row={row.provider}
            >
              <span className="font-mono">{row.provider}</span>
              <span
                data-pi-provider-registry-source={row.category}
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${BADGE_CLASS[row.category]}`}
              >
                {labelOf(row.category)}
              </span>
              <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))]">
                {row.modelCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
