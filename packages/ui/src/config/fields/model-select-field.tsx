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
 * 取数缓存按筛选参数分桶(任务 6.1,Req 11.5:变更后各消费面无需重启即反映;不同参数的
 * 取数互不串扰,取代此前"整页一次"的模块级单 Promise——不同筛选参数的请求会共用同一个
 * 缓存槽,导致后到的参数吃到先到的结果)。
 *
 * ★ 分桶只解决了"互不串扰",没解决"清得掉"(任务 6.6,Req 11.3/11.4/11.5):按参数分桶后
 * 每个桶若只按墙钟 TTL 过期,provider 新增/停用/删除后仍要等到 TTL 到期才反映——"看起来
 * 没生效"的窗口只是从"永久"缩到"TTL 时长"。真正消除该窗口的是**变更事件驱动失效**(主
 * 机制):`useConfigDomain` 的 `save()` 成功后广播 `"pi-web:config-saved"`,本文件监听该
 * 事件即清空全部筛选桶,使用者保存后下一次挂载立即重新取数,不必等待。TTL
 * (`MODEL_OPTIONS_CACHE_TTL_MS`)仍保留,作为带外变更(磁盘被直接改、另一标签页改)的
 * 兜底。测试经 __setModelOptionsFetchImpl / __resetModelOptionsCache /
 * __setModelOptionsNowFn 注入与复位。
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

// ── 取数(按筛选参数分桶 + TTL 失效的缓存 + 测试注入)──
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setModelOptionsFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}

/**
 * 缓存条目的存活时长(任务 6.6,Req 11.5)。够短:provider 变更后不必等整页刷新,下一次
 * 挂载(切到其它设置面板再切回)大概率已过期;够长:同一面板停留期间的重复挂载(如
 * React 严格模式的二次渲染)仍命中缓存,不放大请求频率。与 e2e(provider-management 相关
 * 用例)约定的等待时长须同步——改动本值须同时检查那侧的等待时间。
 */
export const MODEL_OPTIONS_CACHE_TTL_MS = 5_000;

// ★ 按筛选参数分桶(multi-gateway-providers 任务 6.1,Req 11.5/11.6):此前是模块级
// **单个** Promise,不同筛选参数的取数会共用同一缓存槽——先到的参数决定结果,后到的
// 参数被吃掉(串扰)。改为以查询串为 key 的 Map,不同参数各自独立缓存、互不串扰。
interface CacheEntry {
  readonly promise: Promise<ModelOptionsResponse>;
  /** 过期时刻(`nowFn()` 同刻度);到达后视为不存在,下一次取数会发起新请求。 */
  readonly expiresAt: number;
}
const cacheByFilter = new Map<string, CacheEntry>();
export function __resetModelOptionsCache(): void {
  cacheByFilter.clear();
}

// ★ 变更事件驱动失效(任务 6.6,Req 11.3/11.4/11.5 的**主机制**,TTL 只是兜底):使用者
// 保存 provider 配置成功后,`useConfigDomain` 广播 `"pi-web:config-saved"`(事件名字面量
// 硬编码——本包不 import `@blksails/pi-web-react`,避免反向依赖)。监听后立即清空本模块
// 全部筛选桶,使下一次挂载不必等 TTL 过期即重新取数。TTL(`MODEL_OPTIONS_CACHE_TTL_MS`)
// 仍保留,兜底带外变更(磁盘被直接改、另一标签页改)。
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("pi-web:config-saved", () => {
    __resetModelOptionsCache();
  });
}

/** 测试注入「当前时刻」(任务 6.6):驱动 TTL 过期而不必真实等待。默认 `Date.now`。 */
let nowFn: () => number = () => Date.now();
export function __setModelOptionsNowFn(f: () => number): void {
  nowFn = f;
}

function filterQueryString(filter: ModelOptionsFilter): string {
  const params = new URLSearchParams();
  if (filter.input !== undefined) params.set("input", filter.input);
  if (filter.output !== undefined) params.set("output", filter.output);
  return params.toString();
}

async function loadModelOptions(filter: ModelOptionsFilter = {}): Promise<ModelOptionsResponse> {
  const key = filterQueryString(filter);
  const now = nowFn();
  const cached = cacheByFilter.get(key);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.promise;
  }
  const promise = (async (): Promise<ModelOptionsResponse> => {
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
  cacheByFilter.set(key, { promise, expiresAt: now + MODEL_OPTIONS_CACHE_TTL_MS });
  return promise;
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
  // 是否已完成至少一次取数(任务 7.2):orphan 判定须等选项集就位后才可靠——挂载瞬间
  // groups 恒为空,若不设此闸门,任何已有值的字段都会在首帧被误判为"指向不存在的
  // provider"而闪现 orphan 标记。
  const [loaded, setLoaded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const isDisabled = disabled ?? descriptor.readOnly ?? false;

  React.useEffect(() => {
    let alive = true;
    // 两个 widget(providerSelect/modelSelect)呈现的都是 defaultProvider/defaultModel,
    // 即会话可对话的模型——按 output=text 筛选(Req 11.2/11.6),取代此前的零筛选整份
    // 目录(会混入图像专用 provider)。
    void loadModelOptions({ output: "text" }).then((d) => {
      if (alive) {
        setGroups(buildGroups(descriptor.widget, d));
        setLoaded(true);
      }
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

  /**
   * orphan(任务 7.2,Req 6.5/9.4):存量设置(defaultProvider/defaultModel)指向的
   * provider/模型在统一目录中已不存在。此时**保留该值、给出可辨识提示**,而不是静默
   * 清除或让选择器假装它未设置。
   *
   * 语义与标记(`data-pi-model-orphan`)与会话模型选择器(任务 6.4,
   * `elements/model-selector.tsx`)共用同一套——同一失效状态在设置页与会话内的
   * 呈现方式不各造一套。
   */
  const isCurrentListed =
    current.length > 0 && groups.some((g) => g.options.some((o) => o.value === current));
  const isOrphan = loaded && current.length > 0 && !isCurrentListed;
  const orphanGroupLabel = t("modelSelector.orphanGroup");
  const orphanHint = t("modelSelector.orphanHint");

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
              title={isOrphan ? orphanHint : undefined}
              data-pi-model-orphan={isOrphan ? "true" : undefined}
              className={cn(
                "w-full justify-between font-normal",
                current.length === 0 && "text-[hsl(var(--muted-foreground))]",
                isOrphan && "text-[hsl(var(--destructive))]",
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
                {/*
                  orphan 组(任务 7.2,Req 6.5/9.4):当前值不在任何组内时单列一个不可选的
                  条目,与会话模型选择器(model-selector.tsx)同款——保留该值可见 + 附
                  提示,而不是让它悄悄消失或与"未设置"混同。
                */}
                {isOrphan && (
                  <CommandGroup heading={orphanGroupLabel} data-pi-model-group>
                    <CommandItem
                      value={`__orphan__ ${current}`}
                      disabled
                      title={orphanHint}
                      data-pi-model-option
                      data-pi-model-orphan="true"
                      data-pi-model-current="true"
                    >
                      <Check className="h-4 w-4 shrink-0 opacity-100" aria-hidden="true" />
                      <span className="truncate">{current}</span>
                    </CommandItem>
                  </CommandGroup>
                )}
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
