/**
 * `/settings` — 配置面板(spec vite-spa-migration 任务 4.4,Req 3.7)。
 *
 * 迁移自 `app/settings/page.tsx`(本就是 client component)。先注册全部配置面板,再渲染外壳。
 * 「MCP」面板自 spec builtin-mcp-client 起**常驻登记** —— MCP 已是内置能力,不再以
 * 「是否装了 pi-mcp-adapter」为可见条件(Req 5.2),故无需异步探测与重渲染。
 *
 * 返回：优先回进入设置前的会话路径（`/session/:id`），勿一律回 agent 选择页。
 * pane webview 生命周期仍由 `[data-panes-host]` presence 单闸处理，本页不主动 hide。
 */
import * as React from "react";
import { Link } from "react-router";
import { SettingsShell, useI18n } from "@blksails/pi-web-ui";
import { registerConfigPanels } from "@/lib/settings/register-panels";
import { ResourceManager } from "@/components/resource-manager";

registerConfigPanels();

const SETTINGS_RETURN_KEY = "pi-web:settings-return";
const LAST_SESSION_PATH_KEY = "pi-web:last-session-path";

/** 仅允许站内绝对路径，防 open redirect。 */
function safeReturnPath(raw: string | null): string | undefined {
  if (raw === null || raw.length === 0) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  if (raw.startsWith("/settings")) return undefined;
  return raw;
}

export function SettingsRoute(): React.JSX.Element {
  const t = useI18n();
  const backHref = React.useMemo(() => {
    if (typeof window === "undefined") return "/";
    return (
      safeReturnPath(sessionStorage.getItem(SETTINGS_RETURN_KEY))
      ?? safeReturnPath(sessionStorage.getItem(LAST_SESSION_PATH_KEY))
      ?? "/"
    );
  }, []);
  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <Link
          to={backHref}
          className="ml-auto rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs"
        >
          {t("settings.back")}
        </Link>
      </header>
      <SettingsShell />
      <ResourceManager />
    </main>
  );
}

export { SETTINGS_RETURN_KEY, LAST_SESSION_PATH_KEY };
