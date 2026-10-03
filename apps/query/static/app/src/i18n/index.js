import { createContext, createElement, useContext, useEffect, useMemo } from 'react';

/** Jira locale codes ArtUp Query ships translations for. */
export const SUPPORTED_LOCALES = [
  'zh-CN', 'zh-TW', 'cs-CZ', 'da-DK', 'nl-NL', 'en-US', 'en-GB', 'et-EE',
  'fi-FI', 'fr-FR', 'de-DE', 'hu-HU', 'is-IS', 'it-IT', 'ja-JP', 'ko-KR',
  'no-NO', 'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'tr-TR',
  'es-ES', 'sv-SE',
];

const DEFAULT_LOCALE = 'en-US';

const LANGUAGE_PREFERENCE = {
  pt: 'pt-BR',
  zh: 'zh-CN',
  en: 'en-US',
  no: 'no-NO',
  nb: 'no-NO',
  nn: 'no-NO',
};

const localeModules = import.meta.glob('./locales/*.json', { eager: true });

function buildLocaleDictionaries(modules) {
  const result = {};
  for (const filePath in modules) {
    const match = filePath.match(/([^/]+)\.json$/);
    if (!match) continue;
    const mod = modules[filePath];
    result[match[1]] = mod && mod.default ? mod.default : mod;
  }
  return result;
}

/** Bundled translation dictionaries keyed by locale code. */
export const localeDictionaries = buildLocaleDictionaries(localeModules);

/**
 * Normalises a Jira locale (e.g. `ru_RU`) to one of SUPPORTED_LOCALES:
 * exact match wins, then a preferred language match, else en-US.
 */
export function resolveLocale(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_LOCALE;
  const normalized = raw.replace(/_/g, '-');
  const exact = SUPPORTED_LOCALES.find(
    (locale) => locale.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact) return exact;
  const language = normalized.split('-')[0].toLowerCase();
  if (LANGUAGE_PREFERENCE[language]) return LANGUAGE_PREFERENCE[language];
  const languageMatch = SUPPORTED_LOCALES.find(
    (locale) => locale.split('-')[0].toLowerCase() === language,
  );
  return languageMatch || DEFAULT_LOCALE;
}

function applyPlaceholders(locale, template, values) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values?.[name];
    if (value === undefined || value === null) return '';
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : String(value);
  });
}

function pick(entry, locale, values) {
  if (entry === undefined || entry === null || typeof entry === 'string') return entry;
  const category = new Intl.PluralRules(locale).select(Number(values?.count ?? 0));
  return entry[category] ?? entry.other;
}

/** Builds t(key, values): locale entry, then en-US, then the key; plural entries pick by values.count. */
export function createT(locale, dictionaries) {
  const dict = dictionaries[locale] || {};
  const fallback = dictionaries[DEFAULT_LOCALE] || {};
  return function t(key, values) {
    const own = pick(dict[key], locale, values);
    if (own !== undefined && own !== null) return applyPlaceholders(locale, own, values);
    const base = pick(fallback[key], DEFAULT_LOCALE, values);
    return base !== undefined && base !== null ? applyPlaceholders(DEFAULT_LOCALE, base, values) : key;
  };
}

const I18nContext = createContext(null);

/** Provides a translate function for the resolved Jira locale to descendants and marks the document language. */
export function I18nProvider({ locale, children }) {
  const value = useMemo(() => {
    const resolved = resolveLocale(locale);
    return { locale: resolved, t: createT(resolved, localeDictionaries) };
  }, [locale]);
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = value.locale;
  }, [value.locale]);
  return createElement(I18nContext.Provider, { value }, children);
}

/** Returns the translate function from the nearest I18nProvider. */
export function useT() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useT must be used within an I18nProvider');
  }
  return context.t;
}

/** Returns the resolved locale code from the nearest I18nProvider. */
export function useLocale() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useLocale must be used within an I18nProvider');
  }
  return context.locale;
}

/** Formats a number for display using the resolved locale. */
export function formatNumber(locale, n) {
  return new Intl.NumberFormat(resolveLocale(locale)).format(n);
}

/** Formats an ISO date-time string for display; invalid or empty input returns ''. */
export function formatDate(locale, iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Formats a byte count as kB/MB/GB with locale digits. */
export function formatBytes(locale, bytes) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let value = Math.max(0, Number(bytes) || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: 'unit', unit: units[index], unitDisplay: 'short', maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
  }).format(value);
}

/** Formats milliseconds as "1 min 5 s" through translated units. */
export function formatDuration(t, ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? t('time.minutesSeconds', { minutes, seconds: seconds % 60 })
    : t('time.seconds', { seconds });
}

/** Returns `{ t, locale, formatNumber, formatDate, formatDuration }` bound to the nearest I18nProvider. */
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  const { t, locale } = context;
  return {
    t,
    locale,
    formatNumber: (n) => formatNumber(locale, n),
    formatDate: (iso) => formatDate(locale, iso),
    formatDuration: (ms) => formatDuration(t, ms),
  };
}
