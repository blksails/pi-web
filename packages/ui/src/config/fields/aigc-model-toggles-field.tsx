/**
 * AigcModelTogglesField — AIGC 图像「模型开关」字段(widget: "aigcModelToggles",aigc-tool-settings)。
 *
 * config 域 `aigc` 的 `disabledModels` 字段(值 = 被禁 model id 数组,裸 id、非 `provider/id`
 * 复合键——存量语义不变)。渲染为图像模型勾选清单:勾选 = 启用,取消 = 禁用(加入
 * disabledModels)。清单来自 `GET /api/config/models?output=image`(multi-gateway-providers
 * 任务 4.3/6.2:唯一部署级模型目录端点按输出类型筛选,取代已删除的独立 `GET /api/aigc/models`;
 * 响应字段为 `id`/`name`/`provider`/`source?`,与 ModelSelectField 同形态),复用选择器同款
 * provider 字母徽章与显示名。
 *
 * 取数按模块级 Promise 缓存(任务 6.6,Req 11.5):此前"整页一次"的缓存永不过期 ——
 * provider 新增/停用/删除后,只要页面不整体刷新,清单会一直停在旧结果,变化"看起来没
 * 生效"。改为两层失效:①**变更事件驱动**(主机制)—— `useConfigDomain` 保存成功后广播
 * `"pi-web:config-saved"`,监听后立即清空缓存,下一次挂载即取新数据,不必等待;
 * ②墙钟 TTL(兜底)—— 覆盖带外变更(磁盘被直接改、另一标签页改)。
 * 测试经 __setAigcModelsFetchImpl / __resetAigcModelsCache / __setAigcModelsNowFn
 * 注入与复位(仿 ModelSelectField)。
 *
 * ★ 本清单只控制「此处开关」与「部署级目录」两处的即时呈现;它驱动的 AIGC 图像工具
 * (`tool-kit/aigc/extension.ts` 的 `disabledModels`)在**会话装配期**读取一次,固定于该
 * 会话生命周期内 —— 已打开的会话不会热更新,须等下一次新建会话才应用新的开关状态
 * (Req 11.3 之外的例外,须在界面明示,而不是让使用者以为设置没生效)。见下方
 * `sessionScopeNote` 渲染。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { useI18n } from "../../i18n/index.js";
import { FieldShell, errorAt } from "./field-shell.js";
/* ses-h1-exempt-next-line: config 域对 canvas-ui 的合法跨包消费(设置面板字段;sanity F3) */
import { ProviderBadge, displayNameOf } from "../../canvas/aigc-model-meta.js";

interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  /**
   * 来源标记(model-catalog spec,Req 4.5):`"ai-gateway"` = 网关托管目录条目,
   * `"self"` = 自配静态目录条目。仅装配端启用 ai-gateway 套件聚合后才出现;
   * 未启用时该字段不存在,不渲染徽章(与启用前逐字节一致)。放宽为 `string`
   * (与 `/config/models` 统一投影一致——multi-gateway-providers 任务 4.1):
   * 徽章渲染仍只认 `"ai-gateway"` 字面值,其余来源标记不渲染徽章。
   */
  readonly source?: string;
}
interface CatalogResponse {
  readonly models: readonly CatalogEntry[];
}

// ── 取数(模块级缓存,带 TTL 失效 + 测试注入)──
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setAigcModelsFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}

/** 缓存条目存活时长(任务 6.6,Req 11.5);与 model-select-field 的同名常量同规格同值。 */
export const AIGC_MODELS_CACHE_TTL_MS = 5_000;

interface CacheEntry {
  readonly promise: Promise<CatalogResponse>;
  readonly expiresAt: number;
}
let cache: CacheEntry | undefined;
export function __resetAigcModelsCache(): void {
  cache = undefined;
}

// ★ 变更事件驱动失效(任务 6.6,Req 11.3/11.4/11.5 的**主机制**,TTL 只是兜底,见
// model-select-field.tsx 同名处理的注释)。事件名字面量硬编码——本包不 import
// `@blksails/pi-web-react`。
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("pi-web:config-saved", () => {
    __resetAigcModelsCache();
  });
}

/** 测试注入「当前时刻」(任务 6.6):驱动 TTL 过期而不必真实等待。默认 `Date.now`。 */
let nowFn: () => number = () => Date.now();
export function __setAigcModelsNowFn(f: () => number): void {
  nowFn = f;
}

async function loadCatalog(): Promise<CatalogResponse> {
  const now = nowFn();
  if (cache !== undefined && cache.expiresAt > now) {
    return cache.promise;
  }
  const promise = (async (): Promise<CatalogResponse> => {
    try {
      const res = await fetchImpl("/api/config/models?output=image", { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Partial<CatalogResponse>;
      return { models: json.models ?? [] };
    } catch (err) {
      // 取数失败回退空集(不阻断面板),但不再静默——留一行可辨识的控制台错误
      // (本任务 6.2 的验收点:此前的静默 catch 让「目录端点被删除」这类真实
      // 破坏在界面上只表现为「清单为空」,与「本来就没配模型」无法区分)。
      console.error("[AigcModelTogglesField] GET /api/config/models?output=image failed:", err);
      return { models: [] };
    }
  })();
  cache = { promise, expiresAt: now + AIGC_MODELS_CACHE_TTL_MS };
  return promise;
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
  const t = useI18n();
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
      {/* 任务 6.6(Req 11.3/11.4/11.5 的例外说明):此开关驱动的 AIGC 工具在会话装配期读取
          一次,已打开的会话不会热更新 —— 明示生效时机,而不是让使用者以为设置没生效。 */}
      <p
        data-aigc-model-toggles-scope-note
        className="mb-2 text-xs text-[hsl(var(--muted-foreground))]"
      >
        {t("config.aigcModelToggles.sessionScopeNote")}
      </p>
      {models.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">模型清单加载中…</p>
      ) : (
        <ul data-aigc-model-toggles className="space-y-1">
          {models.map((m) => {
            const enabled = !disabledSet.has(m.id);
            return (
              <li key={m.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-aigc-model-toggle={m.id}
                  aria-label={m.id}
                  checked={enabled}
                  disabled={disabled}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                />
                <ProviderBadge providerId={m.provider} />
                <span className="truncate text-sm" title={m.id}>
                  {displayNameOf(m.name, m.provider)}
                </span>
                {/* 网关来源徽章(Req 4.5,与 modelSelect 同视觉语言);self/无 source 不渲染 */}
                {m.source === "ai-gateway" && (
                  <span
                    data-pi-model-source="ai-gateway"
                    className="shrink-0 rounded bg-[hsl(var(--primary)/0.15)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[hsl(var(--primary))]"
                  >
                    {t("config.modelSelect.sourceAiGateway")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </FieldShell>
  );
}
