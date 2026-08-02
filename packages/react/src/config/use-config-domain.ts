/**
 * useConfigDomain — 组合 panel.load() 初值 + useSchemaForm 受控校验 + panel.save(),
 * 统一 loading / error / dirty / saving / saved 状态机。
 *
 * makeConfigDomainIO(domain) — 基于 `/api/config/:domain` 的 load/save 实现。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSchemaForm,
  type FormValues,
  type UseSchemaFormResult,
  type Validator,
} from "./use-schema-form.js";
import {
  normalizeConfigDomainData,
  type ConfigDomainIO,
  type SettingsPanelDescriptor,
} from "./settings-registry.js";

/**
 * 「配置域已保存」事件名(任务 6.6,Req 11.3/11.4/11.5)。`save()` 成功后广播,供
 * `packages/ui`(`model-select-field.tsx`/`aigc-model-toggles-field.tsx`)与
 * `packages/canvas-ui`(`vision-op.ts`)两侧的取数缓存主动失效——不等墙钟 TTL。
 *
 * ★ 用浏览器原生 `CustomEvent` 而非某个共享模块导出的回调总线:`canvas-ui` 不能反向依赖
 * `react`/`ui`(架构分层单向),事件名字符串字面量是唯一零耦合的广播通道。三处消费面各自
 * 硬编码同一字面量字符串(而非 import 这个常量)——它们本就不能 import 到 `react` 包;此处
 * 导出仅供本包内 `save()` 与该包自身测试使用。
 */
export const CONFIG_SAVED_EVENT = "pi-web:config-saved";

export interface ConfigSavedEventDetail {
  /** 保存成功的面板 id(未提供时为 `undefined`,见 {@link useConfigDomain} 的 `panel.id`)。 */
  readonly domain: string | undefined;
}

export interface MakeConfigDomainIOOptions {
  /** REST 基址,默认 "/api"。 */
  readonly baseUrl?: string;
  /** 注入 fetch(测试用),默认全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
}

/** 基于 `/api/config/:domain` 的 load/save。 */
export function makeConfigDomainIO(
  domain: string,
  opts: MakeConfigDomainIOOptions = {},
): ConfigDomainIO {
  const baseUrl = opts.baseUrl ?? "/api";
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${baseUrl}/config/${domain}`;
  return {
    load: async () => {
      const res = await doFetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`加载配置失败(${res.status})`);
      const json = (await res.json()) as { values?: FormValues };
      return json.values ?? {};
    },
    save: async (values) => {
      const res = await doFetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        let msg = `保存配置失败(${res.status})`;
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          if (j.error?.message !== undefined) msg = j.error.message;
        } catch {
          /* 忽略解析失败 */
        }
        throw new Error(msg);
      }
    },
  };
}

export interface UseConfigDomainResult {
  readonly form: UseSchemaFormResult;
  readonly loading: boolean;
  readonly loadError: string | undefined;
  readonly saving: boolean;
  readonly saveError: string | undefined;
  readonly saved: boolean;
  readonly save: () => Promise<void>;
  readonly reload: () => Promise<void>;
  /** 服务端随加载回传的「文件名 → 原始 JSON Schema」(仅扩展配置域);供 configFiles 控件优先采用。 */
  readonly fileSchemas: Record<string, unknown> | undefined;
}

export function useConfigDomain(
  panel: Pick<SettingsPanelDescriptor, "load" | "save" | "validate"> & {
    /**
     * 面板 id(任务 6.6,Req 11.3/11.4/11.5:保存成功后随「配置已保存」事件一并广播,
     * 供消费面的取数缓存判定是否与自己相关)。可选——仅为兼容既有测试直接构造的裸
     * panel 对象(未提供 id 时事件仍广播,`detail.domain` 为 `undefined`)。
     */
    readonly id?: string;
  },
): UseConfigDomainResult {
  const form = useSchemaForm({ validate: panel.validate as Validator | undefined });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [fileSchemas, setFileSchemas] = useState<Record<string, unknown> | undefined>(undefined);
  const resetRef = useRef(form.reset);
  resetRef.current = form.reset;

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    setSaved(false);
    try {
      const data = normalizeConfigDomainData(await panel.load());
      resetRef.current(data.values);
      setFileSchemas(data.fileSchemas);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [panel]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async () => {
    setSaved(false);
    setSaveError(undefined);
    const result = form.submit();
    if (!result.ok) return; // 字段错误已置入 form.errors
    setSaving(true);
    try {
      await panel.save(result.values);
      setSaved(true);
      // 任务 6.6(Req 11.3/11.4/11.5):保存成功即主动失效,不等墙钟 TTL——这是
      // 「使用者自己刚点完保存」这条最正面场景下消除「看起来没生效」的主机制;
      // TTL 仍保留作带外变更(磁盘被直接改、另一标签页改)的兜底,不删除。
      if (typeof globalThis.dispatchEvent === "function") {
        globalThis.dispatchEvent(
          new CustomEvent<ConfigSavedEventDetail>(CONFIG_SAVED_EVENT, {
            detail: { domain: panel.id },
          }),
        );
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, panel]);

  return { form, loading, loadError, saving, saveError, saved, save, reload, fileSchemas };
}
