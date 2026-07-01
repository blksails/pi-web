"use client";

import * as React from "react";
import { en, zh, type Locale } from "./messages.js";

const dictionaries: Record<Locale, Record<string, string>> = { zh, en };

/** Translate function: never throws; falls back to zh, then the key itself. */
export type TranslateFn = (key: string) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TranslateFn;
}

function translate(locale: Locale, key: string): string {
  return dictionaries[locale][key] ?? zh[key] ?? key;
}

const defaultContext: I18nContextValue = {
  locale: "zh",
  setLocale: () => {},
  t: (key: string) => translate("zh", key),
};

const I18nContext = React.createContext<I18nContextValue>(defaultContext);

export interface I18nProviderProps {
  locale?: Locale;
  children: React.ReactNode;
}

export function I18nProvider({
  locale: initialLocale = "zh",
  children,
}: I18nProviderProps): React.ReactElement {
  const [locale, setLocale] = React.useState<Locale>(initialLocale);

  const value = React.useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: string) => translate(locale, key),
    }),
    [locale],
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
