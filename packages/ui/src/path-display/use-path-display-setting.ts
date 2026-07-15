/**
 * usePathDisplaySetting — 从 GET /api/config/settings 读取 pathDisplay。
 *
 * 失败/未加载时回退默认 basename。供 app shell 注入 PathDisplayProvider。
 */
import * as React from "react";
import {
  DEFAULT_PATH_DISPLAY_MODE,
  parsePathDisplayMode,
  type PathDisplayMode,
} from "@blksails/pi-web-protocol";

/**
 * @param baseUrl 配置 API 前缀,默认 `/api`。
 */
export function usePathDisplaySetting(baseUrl = "/api"): PathDisplayMode {
  const [mode, setMode] = React.useState<PathDisplayMode>(
    DEFAULT_PATH_DISPLAY_MODE,
  );

  React.useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${baseUrl}/config/settings`, { method: "GET" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          values?: { pathDisplay?: unknown };
        };
        if (cancelled) return;
        if (json.values?.pathDisplay !== undefined) {
          setMode(parsePathDisplayMode(json.values.pathDisplay));
        }
      } catch {
        /* 静默:断网/配置不可达时保留默认 */
      }
    };
    void load();
    // 从设置页保存后回到主界面时 focus 触发重读,无需整页刷新。
    const onFocus = (): void => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [baseUrl]);

  return mode;
}
