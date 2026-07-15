/**
 * Providers — 全局 provider 树(i18n + 主题 + 路径显示 + 应用外壳布局)。
 *
 * 迁移自 `app/providers.tsx`。原文件那段关于「RSC barrel 边界」的长注释在此不再适用:
 * SPA 下不存在服务端/客户端组件边界,从 `@blksails/pi-web-ui` 的 barrel 引入 `I18nProvider`
 * 不会迫使打包器评估整包客户端组件。
 */
import type { ReactNode } from "react";
import {
  I18nProvider,
  PathDisplayProvider,
  usePathDisplaySetting,
} from "@blksails/pi-web-ui";
import { ThemeControls } from "./theme-controls.js";

function PathDisplayFromSettings({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const mode = usePathDisplaySetting("/api");
  return <PathDisplayProvider mode={mode}>{children}</PathDisplayProvider>;
}

export function Providers({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <I18nProvider>
      <PathDisplayFromSettings>
        <ThemeControls>
          <div className="flex h-dvh w-full flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
            {children}
          </div>
        </ThemeControls>
      </PathDisplayFromSettings>
    </I18nProvider>
  );
}
