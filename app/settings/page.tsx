"use client";

/**
 * 设置页 — 装配 <SettingsShell>(由 schema 生成的配置表单)。
 *
 * 先注册 P0 配置面板(auth/settings),再渲染外壳;面板经 /api/config/:domain 读写。
 */
import * as React from "react";
import { SettingsShell } from "@blksails/pi-web-ui";
import {
  registerConfigPanels,
  registerMcpPanelIfInstalled,
} from "@/lib/settings/register-panels";

registerConfigPanels();

export default function SettingsPage(): React.JSX.Element {
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
        <h1 className="text-xl font-semibold">设置</h1>
        <a
          href="/"
          className="ml-auto rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs"
        >
          返回
        </a>
      </header>
      <SettingsShell />
    </main>
  );
}
