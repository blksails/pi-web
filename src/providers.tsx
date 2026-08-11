/**
 * Providers — 全局 provider 树(i18n + 主题 + 路径显示 + 应用外壳布局)。
 *
 * 迁移自 `app/providers.tsx`。原文件那段关于「RSC barrel 边界」的长注释在此不再适用:
 * SPA 下不存在服务端/客户端组件边界,从 `@blksails/pi-web-ui` 的 barrel 引入 `I18nProvider`
 * 不会迫使打包器评估整包客户端组件。
 *
 * 另：安装 document 级 PanesHost presence（唯一闸门）。`/settings` 等无 host 路由
 * 卸掉 `[data-panes-host]` 只 hide 侧栏 webview，保活当前会话；显式退出时再 destroy。
 */
import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import {
  I18nProvider,
  PathDisplayProvider,
  usePathDisplaySetting,
} from "@blksails/pi-web-ui";
import {
  installDocumentPanesHostPresence,
  notifyPanesHostPresenceSweep,
} from "@blksails/pi-web-panes-kit/react";
import { ThemeControls } from "./theme-controls.js";

function PathDisplayFromSettings({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const mode = usePathDisplaySetting("/api");
  return <PathDisplayProvider mode={mode}>{children}</PathDisplayProvider>;
}

/**
 * 根级 presence：document 观察 host 增删。
 * 任意路由变更后再 sweep 一次——设置页无 host 时 hide，业务页零代码。
 */
function PanesHostPresenceRoot({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const location = useLocation();
  useEffect(() => installDocumentPanesHostPresence(), []);
  useEffect(() => {
    // 等 React 卸完会话树再扫，避免读到将卸载的 host。
    const id = requestAnimationFrame(() => {
      notifyPanesHostPresenceSweep();
    });
    return () => cancelAnimationFrame(id);
  }, [location.pathname]);
  return <>{children}</>;
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
          <PanesHostPresenceRoot>
            <div className="flex h-dvh w-full flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
              {children}
            </div>
          </PanesHostPresenceRoot>
        </ThemeControls>
      </PathDisplayFromSettings>
    </I18nProvider>
  );
}
