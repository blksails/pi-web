/**
 * `/settings` — 配置面板(spec vite-spa-migration 任务 4.4,Req 3.7)。
 *
 * 迁移自 `app/settings/page.tsx`(本就是 client component)。先注册全部配置面板,再渲染外壳。
 * 「MCP」面板自 spec builtin-mcp-client 起**常驻登记** —— MCP 已是内置能力,不再以
 * 「是否装了 pi-mcp-adapter」为可见条件(Req 5.2),故无需异步探测与重渲染。
 */
import * as React from "react";
import { SettingsShell, useI18n } from "@blksails/pi-web-ui";
import { registerConfigPanels } from "@/lib/settings/register-panels";

registerConfigPanels();

export function SettingsRoute(): React.JSX.Element {
  const t = useI18n();
  return (
    <main className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <a
          href="/"
          className="ml-auto rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs"
        >
          {t("settings.back")}
        </a>
      </header>
      <SettingsShell />
    </main>
  );
}
