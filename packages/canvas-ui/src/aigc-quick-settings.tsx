/**
 * AigcQuickSettings — 输入区工具排的 AIGC 快捷设置(aigc-prompt-toolbar Req 2/3/5.2/6/7.2)。
 *
 * 由 aigc-canvas-agent 的 `.pi/web` 挂载到 `promptToolbar` 槽(内核控件后、发送键前):
 * 图像模型 + 输出尺寸两个紧凑选择器。
 *
 *  - **偏好通道**:经 props 注入的 `state`(WebExtStateAccess)读写会话偏好键
 *    `aigc.model` / `aigc.size`(权威 KV 在 agent 子进程;图像工具执行时直接读同键,
 *    见 tool-kit run-image-tool 偏好级)。工具交互追问写回 → 下行帧 → 本组件订阅回显(5.2)。
 *  - **清单**:读 `aigc.models` / `aigc.sizes`(aigcExtension 装配期下发;单一事实源 = 工具
 *    routes),未就绪回退内置常量。
 *  - **跨会话**:变更双写 localStorage(`pi-web.aigc.*`);挂载时会话偏好为空而本地记忆存在
 *    则回填(seed)——新会话初始即生效(6.1/6.3)。
 *  - **退化**:`state === undefined`(宿主未接状态桥)→ 返回 null,不呈现不报错(7.2)。
 *
 * slot 组件是独立 bundle:一切依赖经 props 注入(不依赖 React context)。
 */
import * as React from "react";
import type { WebExtStateAccess } from "@blksails/pi-web-kit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@blksails/pi-web-primitives";
import { ProviderBadge, displayNameOf } from "./aigc-model-meta.js";

/** 清单未就绪时的回退常量(与 aigcExtension 下发值同源语义;KV 到达后即被覆盖)。 */
const FALLBACK_MODELS: readonly string[] = [
  "gpt-image-2",
  "wan2.7-image-pro",
  "qwen-image-edit-max",
  "qwen-image-2.0",
  "wan2.6-t2i",
  "wanx2.1-t2i-turbo",
];
const FALLBACK_SIZES: readonly string[] = ["1024x1024", "1536x1024", "1024x1536", "auto"];

/** Radix Select 不接受空字符串 item value;以哨兵表示「默认」(= 不设偏好)。 */
const DEFAULT_SENTINEL = "__default__";

/** localStorage 键(同一浏览器跨会话记忆;读写包 try/catch 兼容隐私模式)。 */
const LS_PREFIX = "pi-web.aigc.";

function lsGet(key: string): string | undefined {
  try {
    const v = window.localStorage.getItem(LS_PREFIX + key);
    return v === null || v === "" ? undefined : v;
  } catch {
    return undefined;
  }
}

function lsSet(key: string, value: string | undefined): void {
  try {
    if (value === undefined) window.localStorage.removeItem(LS_PREFIX + key);
    else window.localStorage.setItem(LS_PREFIX + key, value);
  } catch {
    /* 隐私模式等:跨会话记忆静默不可用,会话内偏好不受影响 */
  }
}

/** 订阅一个偏好键:当前值回显 + 外部写回(如工具追问)推送更新。 */
function useStateKey(
  state: WebExtStateAccess,
  key: string,
): string | undefined {
  const subscribe = React.useCallback(
    (onChange: () => void) => state.subscribe(key, onChange),
    [state, key],
  );
  const getSnapshot = React.useCallback(() => {
    const v = state.get<string>(key);
    return typeof v === "string" && v !== "" ? v : undefined;
  }, [state, key]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 订阅清单键(string[]);无效或未就绪返回 fallback。 */
function useCatalogKey(
  state: WebExtStateAccess,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const subscribe = React.useCallback(
    (onChange: () => void) => state.subscribe(key, onChange),
    [state, key],
  );
  const getSnapshot = React.useCallback(() => state.get<unknown>(key), [state, key]);
  const raw = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    if (Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === "string")) {
      return raw as readonly string[];
    }
    return fallback;
  }, [raw, fallback]);
}

/** 最大公约数(约分屏幕比例用)。 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 尺寸 "W×H" → **方向文本 + 屏幕比例**副标(比裸比例数字更直观):
 *   方形("1024x1024"→"方形 1:1")、横向("1280x720"→"宽屏 16:9")、纵向("720x1280"→"竖屏 9:16");
 *   "auto" → "自适应";非法/无法解析 → undefined(不显示副标)。
 */
export function sizeHint(size: string): string | undefined {
  if (size === "auto") return "自适应";
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
  if (m === null) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  const g = gcd(w, h);
  const ratio = `${w / g}:${h / g}`;
  const orientation = w === h ? "方形" : w > h ? "宽屏" : "竖屏";
  return `${orientation} ${ratio}`;
}

/**
 * 尺寸 "W×H" → **像素尺寸**弱化副标(方向/比例作主项突出时,像素退居右侧灰字)。
 *   "1024x1024"→"1024×1024";"auto"/非法/无法解析 → undefined(不显示副标)。
 */
export function sizePixels(size: string): string | undefined {
  if (size === "auto") return undefined;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
  if (m === null) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined;
  return `${w}×${h}`;
}

interface PrefSelectProps {
  readonly state: WebExtStateAccess;
  readonly prefKey: "model" | "size";
  readonly options: readonly string[];
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly dataAttr: string;
  readonly widthClass: string;
  /** value(id)→ 显示 label 映射;缺失键回退显示 id。hover title 恒为 id。 */
  readonly labels?: Readonly<Record<string, string>>;
  /** value(id)→ provider 标识;有则渲染字母徽章并去掉冗余 provider 名后缀。 */
  readonly providers?: Readonly<Record<string, string>>;
  /** value → 右侧副标文本(如尺寸的像素);返回 undefined 则不显示。 */
  readonly hint?: (value: string) => string | undefined;
  /**
   * value → **主项突出文本**(如尺寸的方向+比例);返回 undefined 则回退 label/id。
   * 与 hint 配合可对调突出关系:主项显方向描述、副标弱化像素尺寸。
   */
  readonly primary?: (value: string) => string | undefined;
}

/** 单个偏好选择器:回显 KV 当前值,变更写 KV + localStorage。 */
function PrefSelect({
  state,
  prefKey,
  options,
  placeholder,
  ariaLabel,
  dataAttr,
  widthClass,
  labels,
  providers,
  hint,
  primary,
}: PrefSelectProps): React.JSX.Element {
  const current = useStateKey(state, `aigc.${prefKey}`);
  // 当前值不在清单里(如追问写回了清单外模型)仍需可回显:并入 items。
  const items = React.useMemo(
    () => (current !== undefined && !options.includes(current) ? [current, ...options] : options),
    [current, options],
  );
  const onChange = (v: string): void => {
    const next = v === DEFAULT_SENTINEL ? undefined : v;
    if (next === undefined) void state.delete(`aigc.${prefKey}`);
    else void state.set(`aigc.${prefKey}`, next);
    lsSet(prefKey, next);
  };
  return (
    <Select value={current ?? DEFAULT_SENTINEL} onValueChange={onChange}>
      <SelectTrigger
        {...{ [dataAttr]: "" }}
        aria-label={ariaLabel}
        // 收起态也让 hover 可见模型 id(仅 label≠id 的模型选择器需要)。
        {...(labels !== undefined && current !== undefined ? { title: current } : {})}
        className={`h-8 rounded-full border-[hsl(var(--border))] bg-transparent text-xs ${widthClass}`}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_SENTINEL}>{placeholder}</SelectItem>
        {items.map((m) => {
          const providerId = providers?.[m];
          const label = labels?.[m] ?? m;
          const h = hint?.(m);
          const primaryLabel = primary?.(m) ?? displayNameOf(label, providerId);
          return (
            // 可见=provider 字母徽章 + 主项(方向描述/去后缀 label,缺失回退 id)+ 可选右侧弱化副标
            //(如像素尺寸);hover title 恒为模型 id / 原始 value。
            <SelectItem key={m} value={m} title={m}>
              <span className="flex items-center gap-1.5">
                <ProviderBadge providerId={providerId} />
                <span className="truncate">{primaryLabel}</span>
                {h !== undefined ? (
                  <span className="ml-auto shrink-0 pl-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                    {h}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export interface AigcQuickSettingsProps {
  /** 会话共享状态接入(宿主经 SlotHost 注入);缺失 → 不呈现(Req 7.2)。 */
  readonly state?: WebExtStateAccess;
  /** seed 前的判空延迟(毫秒;测试可传 0)。见组件内竞态注释。 */
  readonly seedDelayMs?: number;
}

export function AigcQuickSettings({
  state,
  seedDelayMs = 800,
}: AigcQuickSettingsProps): React.JSX.Element | null {
  // seed(Req 6.1/6.3):会话偏好为空且本地记忆存在 → 回填会话 KV,使新会话的图像工具
  // 直接采用历史选择。
  // ⚠ 竞态防护:KV 镜像经 SSE 粘性帧**异步**回放——mount 瞬间判空会在「重开既有会话」时
  // 误用本地旧值覆盖会话内真值。故延迟 seedDelayMs 后再判空(粘性回放在连接后毫秒级完成,
  // 延迟后窗口实际归零);期间键已回放出值则自然跳过。
  React.useEffect(() => {
    if (state === undefined) return;
    const t = setTimeout(() => {
      for (const key of ["model", "size"] as const) {
        const inSession = state.get<string>(`aigc.${key}`);
        const remembered = lsGet(key);
        if ((inSession === undefined || inSession === "") && remembered !== undefined) {
          void state.set(`aigc.${key}`, remembered);
        }
      }
    }, seedDelayMs);
    return () => clearTimeout(t);
  }, [state, seedDelayMs]);

  // 所有 hooks 之后再早退(Rules of Hooks):退化态不呈现。
  const models = useCatalogKeySafe(state, "aigc.models", FALLBACK_MODELS);
  const sizes = useCatalogKeySafe(state, "aigc.sizes", FALLBACK_SIZES);
  const modelLabels = useLabelMapSafe(state, "aigc.modelLabels");
  const modelProviders = useLabelMapSafe(state, "aigc.modelProviders");
  if (state === undefined) return null;

  return (
    <span data-aigc-quick-settings className="flex items-center gap-1">
      <PrefSelect
        state={state}
        prefKey="model"
        options={models}
        labels={modelLabels}
        providers={modelProviders}
        placeholder="图像模型"
        ariaLabel="图像生成模型"
        dataAttr="data-aigc-model-select"
        widthClass="w-32"
      />
      <PrefSelect
        state={state}
        prefKey="size"
        options={sizes}
        placeholder="尺寸"
        ariaLabel="输出尺寸"
        dataAttr="data-aigc-size-select"
        widthClass="w-36"
        primary={sizeHint}
        hint={sizePixels}
      />
    </span>
  );
}

/** 订阅一个 label 映射键(Record<string,string>);无效或未就绪返回空对象。 */
function useLabelMap(
  state: WebExtStateAccess,
  key: string,
): Readonly<Record<string, string>> {
  const subscribe = React.useCallback(
    (onChange: () => void) => state.subscribe(key, onChange),
    [state, key],
  );
  const getSnapshot = React.useCallback(() => state.get<unknown>(key), [state, key]);
  const raw = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return React.useMemo(() => {
    if (
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.values(raw as Record<string, unknown>).every((v) => typeof v === "string")
    ) {
      return raw as Record<string, string>;
    }
    return {};
  }, [raw]);
}

/** useLabelMap 的 state 可缺失版(缺失时恒空对象,保持 hooks 顺序稳定)。 */
function useLabelMapSafe(
  state: WebExtStateAccess | undefined,
  key: string,
): Readonly<Record<string, string>> {
  const noopState = React.useMemo<WebExtStateAccess>(
    () => ({
      get: () => undefined,
      subscribe: () => () => {},
      set: async () => {},
      delete: async () => {},
    }),
    [],
  );
  return useLabelMap(state ?? noopState, key);
}

/** useCatalogKey 的 state 可缺失版(缺失时恒 fallback,保持 hooks 顺序稳定)。 */
function useCatalogKeySafe(
  state: WebExtStateAccess | undefined,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const noopState = React.useMemo<WebExtStateAccess>(
    () => ({
      get: () => undefined,
      subscribe: () => () => {},
      set: async () => {},
      delete: async () => {},
    }),
    [],
  );
  return useCatalogKey(state ?? noopState, key, fallback);
}
