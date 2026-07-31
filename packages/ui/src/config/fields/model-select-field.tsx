/**
 * ModelSelectField — provider/model 选择(widget:"providerSelect"/"modelSelect")。
 *
 * shadcn 推荐 Combobox(Popover + Command/cmdk):trigger 显示当前值,面板内搜索 + 列表选择。
 * 选项来自统一部署级目录端点 GET /api/config/models(multi-gateway-providers 任务 4.3,
 * Req 3.1)。本组件两个 widget 呈现的都是 defaultProvider/defaultModel(见
 * `packages/protocol/src/config/domains/settings.ts`),即会话可对话的 provider/模型,
 * 故按 `output=text` 筛选(Req 11.2/11.6:由消费面自行声明所需类型,而非服务端为其
 * 定制专用清单)——不再取零筛选的整份目录(其中含图像专用 provider,如
 * newapi/sufy/dashscope,从不应出现在这两个下拉里)。
 *
 * 注:本版改为**从列表选**(与全站 ModelSelector 统一);不再支持列表外自由输入 / fuzzy
 * pattern。存量自定义值仍会在 trigger 上原样显示(可见),但只能改选为列表内选项。
 *
 * 取数缓存按筛选参数分桶(Req 11.5:变更后各消费面无需重启即反映;不同参数的取数
 * 互不串扰,取代此前"整页一次"的模块级单 Promise——不同筛选参数的请求会共用同一个
 * 缓存槽,导致后到的参数吃到先到的结果)。测试经 __setModelOptionsFetchImpl /
 * __resetModelOptionsCache 注入与复位。
 *
 * provider 徽章(仅 modelSelect 组渲染)按来源实例标识展示(design.md「徽章按实例名」):
 * 徽章文案取 `CatalogModel.source` 原始字符串(即产出该条目的来源 sourceId,Req 3.5),
 * 不再折叠为"网关"/"自配"两档固定译文——后者会把非默认网关实例(如第二个网关实例的
 * sourceId)误判并显示为"自配",多实例部署下不可辨认模型出自哪个实例。
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
   * 来源标记(ai-gateway-providers spec,Req 4.2;放宽为 string——
   * multi-gateway-providers 任务 4.1/6.1,Req 3.5):产出该条目的来源 sourceId,
   * 如 `"self"`、`"ai-gateway"`,或多实例部署下某个网关实例的标识,不再限定于
   * `"ai-gateway" | "self"` 两值联合。仅在装配端启用 ai-gateway 套件并聚合目录后才会
   * 出现;未启用时该字段不存在,不渲染徽章(与启用前逐字节一致)。
   */
  readonly source?: string;
  /**
   * 可用性标记(model-catalog spec,Req 2.3/3.2):`"catalog"` = 仅目录展示、未接入
   * 会话(渲染为不可选中);`"session"` 或缺省 = 会话可用,可正常选中。
   * disabled 判据只看 availability,不看 source(为 P2 网关接入会话翻转留接缝)。
   */
  readonly availability?: "session" | "catalog";
  /**
   * 网关上游渠道名(仅目录条目携带,供界面二级分组展示;本组件当前不渲染)。
   */
  readonly channel?: string;
}
interface ModelOptionsResponse {
  readonly providers: readonly string[];
  readonly models: readonly ModelOption[];
}

/**
 * `loadModelOptions` 的类型筛选参数(multi-gateway-providers 任务 6.1,Req 11.6):
 * 透传给统一端点的 `?input=`/`?output=` 查询参数,由消费面自行声明所需类型。
 */
interface ModelOptionsFilter {
  readonly input?: string;
  readonly output?: string;
}

// ── 取数(按筛选参数分桶的缓存 + 测试注入)──
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setModelOptionsFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
// ★ 按筛选参数分桶(multi-gateway-providers 任务 6.1,Req 11.5/11.6):此前是模块级
// **单个** Promise,不同筛选参数的取数会共用同一缓存槽——先到的参数决定结果,后到的
// 参数被吃掉(串扰)。改为以查询串为 key 的 Map,不同参数各自独立缓存、互不串扰。
const cacheByFilter = new Map<string, Promise<ModelOptionsResponse>>();
export function __resetModelOptionsCache(): void {
  cacheByFilter.clear();
}

function filterQueryString(filter: ModelOptionsFilter): string {
  const params = new URLSearchParams();
  if (filter.input !== undefined) params.set("input", filter.input);
  if (filter.output !== undefined) params.set("output", filter.output);
  return params.toString();
}

async function loadModelOptions(filter: ModelOptionsFilter = {}): Promise<ModelOptionsResponse> {
  const key = filterQueryString(filter);
  let cached = cacheByFilter.get(key);
  if (cached === undefined) {
    cached = (async (): Promise<ModelOptionsResponse> => {
      try {
        const url = key.length > 0 ? `/api/config/models?${key}` : "/api/config/models";
        const res = await fetchImpl(url, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Partial<ModelOptionsResponse>;
        return { providers: json.providers ?? [], models: json.models ?? [] };
      } catch {
        return { providers: [], models: [] };
      }
    })();
    cacheByFilter.set(key, cached);
  }
  return cached;
}

/**
 * 测试专用直接入口(不经组件):验证不同筛选参数的取数各自缓存、互不串扰。
 * 组件自身恒以 `{ output: "text" }` 取数(见 `ModelSelectField` 的 effect)。
 */
export function __loadModelOptionsForTest(
  filter?: ModelOptionsFilter,
): Promise<ModelOptionsResponse> {
  return loadModelOptions(filter);
}

interface Opt {
  readonly value: string;
  readonly label: string;
  /** 来源徽章(仅 modelSelect 组透传;providerSelect 恒为 undefined)。 */
  readonly source?: string;
  /** 可用性标记(仅 modelSelect 组透传;"catalog" 渲染为不可选中)。 */
  readonly availability?: "session" | "catalog";
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
      bucket.push({ value: m.id, label: m.id, source: m.source, availability: m.availability });
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
    // 两个 widget(providerSelect/modelSelect)呈现的都是 defaultProvider/defaultModel,
    // 即会话可对话的模型——按 output=text 筛选(Req 11.2/11.6),取代此前的零筛选整份
    // 目录(会混入图像专用 provider)。
    void loadModelOptions({ output: "text" }).then((d) => {
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
                    // 目录态(仅目录展示、未接入会话)→ 不可选中 + 行尾提示。
                    // 判据只看 availability(非 source):P2 网关接入会话后翻转标记即可。
                    const isCatalogOnly = o.availability === "catalog";
                    return (
                      <CommandItem
                        key={`${g.provider}:${o.value}`}
                        value={`${o.value} ${g.provider}`}
                        disabled={isCatalogOnly}
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
                        {isCatalogOnly && (
                          <span
                            data-pi-model-availability="catalog"
                            className="ml-auto shrink-0 text-[10px] leading-none text-[hsl(var(--muted-foreground))]"
                          >
                            {t("config.modelSelect.notSessionReady")}
                          </span>
                        )}
                        {o.source !== undefined && (
                          <span
                            data-pi-model-source={o.source}
                            className={cn(
                              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
                              isCatalogOnly ? "ml-1.5" : "ml-auto",
                              o.source === "self"
                                ? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                                : "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]",
                            )}
                          >
                            {/* 按来源实例标识展示(design.md「徽章按实例名」):文案取
                                sourceId 原始值,不折叠为固定的"网关"/"自配"两档译文——
                                多实例部署下不同网关实例的 sourceId 不同,须各自可辨认。 */}
                            {o.source}
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
