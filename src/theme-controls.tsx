"use client";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  ThemeProvider,
  type ThemeMode,
  useI18n,
  useLocale,
} from "@blksails/pi-web-ui";

/**
 * 应用级主题接入:`ThemeControls` 用 @blksails/pi-web-ui 的 ThemeProvider 包裹全局并经 context
 * 暴露亮/暗切换;`ThemeToggleButton` 是放置在头部(与"设置"并排)的图标控件,
 * 带 data-pi-theme-toggle 供浏览器 e2e 使用。
 */
interface ThemeToggleContextValue {
  readonly isDark: boolean;
  readonly toggle: () => void;
}

const ThemeToggleContext = createContext<ThemeToggleContextValue | null>(null);

/** 内联 Moon / Sun 图标(避免在 app 层引入 lucide-react 依赖)。 */
function MoonIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

export function ThemeControls({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const [mode, setMode] = useState<ThemeMode>("light");
  const value: ThemeToggleContextValue = {
    isDark: mode === "dark",
    toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")),
  };
  return (
    <ThemeProvider mode={mode}>
      <ThemeToggleContext.Provider value={value}>
        {children}
      </ThemeToggleContext.Provider>
    </ThemeProvider>
  );
}

/** 主题切换图标按钮(放在头部与"设置"并排);无 Provider 时不渲染。 */
export function ThemeToggleButton({
  className,
}: {
  readonly className?: string;
}): React.JSX.Element | null {
  const t = useI18n();
  const ctx = useContext(ThemeToggleContext);
  if (ctx === null) return null;
  const { isDark, toggle } = ctx;
  return (
    <button
      type="button"
      data-pi-theme-toggle
      aria-label={isDark ? t("themeControls.toLight") : t("themeControls.toDark")}
      title={isDark ? t("themeControls.light") : t("themeControls.dark")}
      onClick={toggle}
      className={
        className ??
        "inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] px-2 py-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      }
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** 语言切换按钮(zh ↔ en,放在头部与主题切换并排);经 useLocale 持久化到 localStorage。 */
export function LocaleToggleButton({
  className,
}: {
  readonly className?: string;
}): React.JSX.Element {
  const t = useI18n();
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      data-pi-locale-toggle
      aria-label={t("localeToggle.aria")}
      onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
      className={
        className ??
        "inline-flex items-center justify-center rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      }
    >
      {locale === "zh" ? "EN" : "中"}
    </button>
  );
}
