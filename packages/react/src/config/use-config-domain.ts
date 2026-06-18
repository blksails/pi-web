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
import type { ConfigDomainIO, SettingsPanelDescriptor } from "./settings-registry.js";

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
}

export function useConfigDomain(
  panel: Pick<SettingsPanelDescriptor, "load" | "save" | "validate">,
): UseConfigDomainResult {
  const form = useSchemaForm({ validate: panel.validate as Validator | undefined });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const resetRef = useRef(form.reset);
  resetRef.current = form.reset;

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    setSaved(false);
    try {
      const values = await panel.load();
      resetRef.current(values);
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
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, panel]);

  return { form, loading, loadError, saving, saveError, saved, save, reload };
}
