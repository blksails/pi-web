/**
 * VisionModelSelectField — 视觉模型选择(widget: `"visionModelSelect"`,config 域 `aigc.visionModel`)。
 *
 * ## 为什么不是普通下拉
 *
 * 清单来自 `GET /api/vision/models`,判据是「凭据可用 ∩ `input` 含 `image`」——**每一个能吃图的
 * 聊天模型**都在里面。实测本机 154 项(openrouter 一家 141),配了多个 provider 的机器只会更多。
 * 平铺的 `<select>` 在这个量级上不可用,故用「搜索框 + 过滤列表」。
 *
 * ## 空值是有意义的值
 *
 * 空 = 「每次弹层询问」,不是「未配置的坏状态」。所以清空按钮是一等交互,不是重置逃生口 ——
 * 用户可能就是想回到每次都问。
 *
 * ## 该字段是双向的
 *
 * 用户在这里设,工具也会在用户于弹层里选过之后写回同一字段(tool-kit `vision/model-preference.ts`)。
 * 因此打开设置页时看到一个「自己没设过的值」是正常的,文案里要说明它从哪来。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { FieldShell, errorAt } from "./field-shell.js";
/* ses-h1-exempt-next-line: config 域对 canvas-ui 的合法跨包消费(设置面板字段;沿用 aigcModelToggles 先例) */
import { ProviderBadge, displayNameOf } from "../../canvas/aigc-model-meta.js";

interface VisionModel {
  readonly value: string;
  readonly label: string;
  readonly provider: string;
}
interface VisionModelsResponse {
  readonly models: readonly VisionModel[];
}

// ── 取数(模块级缓存 + 测试注入;与 aigcModelToggles 同规格)──
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);
export function __setVisionModelsFetchImpl(f: typeof fetch): void {
  fetchImpl = f;
}
let cache: Promise<VisionModelsResponse> | undefined;
export function __resetVisionModelsCache(): void {
  cache = undefined;
}

async function loadModels(): Promise<VisionModelsResponse> {
  if (cache === undefined) {
    cache = (async () => {
      try {
        const res = await fetchImpl("/api/vision/models", { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Partial<VisionModelsResponse>;
        return { models: json.models ?? [] };
      } catch {
        return { models: [] }; // 取数失败回退空集(不阻断面板)
      }
    })();
  }
  return cache;
}

/** 上限:再多也没人往下翻,但**必须**告诉用户被截断了,否则「搜不到」会被当成没这个模型。 */
const MAX_VISIBLE = 50;

export function VisionModelSelectField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const [models, setModels] = React.useState<readonly VisionModel[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    void loadModels().then((d) => {
      if (alive) {
        setModels(d.models);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const current = typeof value === "string" ? value : "";
  const err = errorAt(errors, path);

  const matched = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return models;
    return models.filter(
      (m) =>
        m.value.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, query]);
  const visible = matched.slice(0, MAX_VISIBLE);

  // 已选模型可能不在当前筛选结果里(甚至已从清单消失,如 provider 凭据被撤)。
  // 单独回显它 —— 否则用户会以为设置丢了。
  const currentInList = models.some((m) => m.value === current);

  return (
    <FieldShell descriptor={descriptor} error={err}>
      <div data-vision-model-select className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            data-vision-model-current={current === "" ? "none" : current}
            className="truncate text-sm"
          >
            {current === "" ? (
              <span className="text-[hsl(var(--muted-foreground))]">
                未设定 —— 每次解读时弹层询问
              </span>
            ) : (
              <>
                {current}
                {loaded && !currentInList && (
                  // 已配置但不在可用清单里:凭据被撤 / 模型下架 / models.json 改过。
                  // 此时工具会**忽略**它并回落弹层(select-model 的 findByKey 不命中即跳过),
                  // 所以这不是坏数据,但用户该知道它当前不生效。
                  <span
                    data-vision-model-stale
                    className="ml-2 rounded bg-[hsl(var(--destructive)/0.12)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--destructive))]"
                  >
                    当前不可用,解读时仍会询问
                  </span>
                )}
              </>
            )}
          </span>
          {current !== "" && (
            <button
              type="button"
              data-vision-model-clear
              disabled={disabled}
              onClick={() => onChange("")}
              className="ml-auto shrink-0 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-xs hover:bg-[hsl(var(--accent))]"
            >
              清空(每次询问)
            </button>
          )}
        </div>

        <input
          type="search"
          data-vision-model-search
          value={query}
          disabled={disabled}
          placeholder="搜索模型 / provider…"
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm"
        />

        {!loaded ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">模型清单加载中…</p>
        ) : models.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            没有凭据可用且支持图像输入的模型。在 <code>~/.pi/agent/models.json</code> 配置后重试。
          </p>
        ) : (
          <>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {visible.map((m) => (
                <li key={m.value}>
                  <button
                    type="button"
                    data-vision-model-option={m.value}
                    aria-pressed={m.value === current}
                    disabled={disabled}
                    onClick={() => onChange(m.value)}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-[hsl(var(--accent))] ${
                      m.value === current ? "bg-[hsl(var(--accent))] font-medium" : ""
                    }`}
                  >
                    <ProviderBadge providerId={m.provider} />
                    <span className="truncate" title={m.value}>
                      {displayNameOf(m.label, m.provider)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p
              data-vision-model-count
              className="text-xs text-[hsl(var(--muted-foreground))]"
            >
              {matched.length > MAX_VISIBLE
                ? `显示前 ${MAX_VISIBLE} / ${matched.length} 项,继续输入以缩小范围`
                : `${matched.length} 项`}
              {query.trim() !== "" && ` · 共 ${models.length} 个可用`}
            </p>
          </>
        )}
      </div>
    </FieldShell>
  );
}
