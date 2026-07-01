"use client";

/**
 * Providers — 客户端 provider 包装(session-list-item-actions 合并后修复)。
 *
 * 根 `app/layout.tsx` 是**服务端组件**(导出 `metadata`),不能标 "use client"。而
 * `I18nProvider` 来自 `@blksails/pi-web-ui` 的**整包 barrel**(package `exports` 仅暴露 `.`),
 * 服务端组件直接从 barrel 引入会迫使 Next 评估 barrel 内**全部客户端组件**,触发 RSC 边界错误
 * (createContext/useState 等 needs "use client")。故把 provider 树抽到此「use client」组件,
 * 由服务端 layout 以直接相对路径引入——客户端边界在此建立,layout 保持服务端(保留 metadata)。
 */
import type { ReactNode } from "react";
import { I18nProvider } from "@blksails/pi-web-ui";
import { ThemeControls } from "./theme-controls";

export function Providers({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <I18nProvider>
      <ThemeControls>
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
          {children}
        </div>
      </ThemeControls>
    </I18nProvider>
  );
}
