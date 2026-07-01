"use client";

import * as React from "react";
import { en, zh, type Locale } from "./messages.js";

const dictionaries: Record<Locale, Record<string, string>> = { zh, en };

/**
 * Translate function: never throws; falls back to zh, then the key itself.
 * Optional `params` interpolate `{name}` placeholders in the message.
 */
export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? String(params[k]) : m,
  );
}

function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  return interpolate(dictionaries[locale][key] ?? zh[key] ?? key, params);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TranslateFn;
}

const defaultContext: I18nContextValue = {
  locale: "zh",
  setLocale: () => {},
  t: (key, params) => translate("zh", key, params),
};

const I18nContext = React.createContext<I18nContextValue>(defaultContext);

const STORAGE_KEY = "pi-web.locale";

function isLocale(v: unknown): v is Locale {
  return v === "zh" || v === "en";
}

export interface I18nProviderProps {
  locale?: Locale;
  children: React.ReactNode;
}

export function I18nProvider({
  locale: initialLocale = "zh",
  children,
}: I18nProviderProps): React.ReactElement {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  // 客户端挂载后读持久化偏好(避免 SSR 水合不匹配:首帧用 initialLocale)。
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(saved) && saved !== locale) setLocaleState(saved);
    } catch {
      /* localStorage 不可用时忽略 */
    }
    // 仅挂载时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = React.useCallback((l: Locale): void => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* 忽略持久化失败 */
    }
  }, []);

  const value = React.useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Returns the translate function `t`. Works without a Provider (defaults to zh). */
export function useI18n(): TranslateFn {
  return React.useContext(I18nContext).t;
}

/** Returns the current locale and a setter. */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = React.useContext(I18nContext);
  return { locale, setLocale };
}
