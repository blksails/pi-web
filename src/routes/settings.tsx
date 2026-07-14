/**
 * `/settings` — 配置面板(spec vite-spa-migration 任务 4.4,Req 3.7)。
 *
 * 迁移自 `app/settings/page.tsx`(本就是 client component)。行为逐字保留:先注册 P0 面板
 * (auth/settings),再渲染外壳;「MCP」面板仅在探测到 pi-mcp-adapter 已安装时条件登记。
 */
import * as React from "react";
import { SettingsShell, useI18n } from "@blksails/pi-web-ui";
import {
  registerConfigPanels,
  registerMcpPanelIfInstalled,
} from "@/lib/settings/register-panels";

registerConfigPanels();

export function SettingsRoute(): React.JSX.Element {
  const t = useI18n();
  // 「MCP」面板装了 pi-mcp-adapter 才出现:挂载后异步探测并条件登记,完成后 bump 触发重渲染,
  // 使 <SettingsShell>(每次渲染重读 listPanels)纳入该面板。
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    void registerMcpPanelIfInstalled().then((added) => {
      if (added) bump();
    });
  }, []);

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
