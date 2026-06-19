"use client";
/**
 * 运行时主题 Provider(pi-chat-customization 任务 1.5)。
 *
 * 接受 light/dark/system 三模式(与 settings.theme 语义一致,Req 2.5),切换文档根的
 * `dark` 类。`system` 读取并监听操作系统明暗偏好,变化时运行时更新(Req 2.3)。
 * 缺省 `system`(Req 2.4);`matchMedia` 不可用时回退 light 且不报错(graceful degradation)。
 */
import * as React from "react";
import type { ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeProviderProps {
  /** 主题模式,默认 "system"。 */
  readonly mode?: ThemeMode;
  /** 应用 dark 类的目标元素,默认 document.documentElement。 */
  readonly element?: HTMLElement;
  readonly children?: ReactNode;
}

export interface UseThemeResult {
  /** 集成方设定的模式。 */
  readonly mode: ThemeMode;
  /** system 解析后的实际明暗。 */
  readonly resolved: "light" | "dark";
}

const ThemeContext = React.createContext<UseThemeResult>({
  mode: "system",
  resolved: "light",
});

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MEDIA_QUERY).matches;
}

export function ThemeProvider({
  mode = "system",
  element,
  children,
}: ThemeProviderProps): React.JSX.Element {
  const [systemDark, setSystemDark] = React.useState<boolean>(() =>
    systemPrefersDark(),
  );

  // system 模式下监听操作系统偏好变化(Req 2.3);其他模式无需监听。
  React.useEffect(() => {
    if (mode !== "system") return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = (): void => setSystemDark(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  const resolved: "light" | "dark" =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // 应用/移除 dark 类。
  React.useEffect(() => {
    const el =
      element ??
      (typeof document !== "undefined" ? document.documentElement : undefined);
    if (el === undefined) return;
    if (resolved === "dark") el.classList.add("dark");
    else el.classList.remove("dark");
  }, [resolved, element]);

  const value = React.useMemo<UseThemeResult>(
    () => ({ mode, resolved }),
    [mode, resolved],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): UseThemeResult {
  return React.useContext(ThemeContext);
}
