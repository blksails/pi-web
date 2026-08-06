/**
 * useShowReasoningSetting — 从 GET /api/config/settings 读取 showReasoning。
 *
 * 失败/未加载时回退默认 false（不展示思考内容）。
 * 供 ChatReasoning / app shell 在设置变更后经 focus 重读。
 */
import * as React from "react";
import {
  DEFAULT_SHOW_REASONING,
  parseShowReasoning,
} from "@blksails/pi-web-protocol";

/**
 * @param baseUrl 配置 API 前缀，默认 `/api`。
 */
export function useShowReasoningSetting(baseUrl = "/api"): boolean {
  const [show, setShow] = React.useState<boolean>(DEFAULT_SHOW_REASONING);

  React.useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch(`${baseUrl}/config/settings`, { method: "GET" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          values?: { showReasoning?: unknown };
        };
        if (cancelled) return;
        if (json.values?.showReasoning !== undefined) {
          setShow(parseShowReasoning(json.values.showReasoning));
        }
      } catch {
        /* 静默：断网/配置不可达时保留默认（不展示） */
      }
    };
    void load();
    const onFocus = (): void => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [baseUrl]);

  return show;
}
