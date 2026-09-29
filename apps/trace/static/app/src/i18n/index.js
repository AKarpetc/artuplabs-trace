import { createContext, createElement, useContext, useMemo } from 'react';

/** Jira locale codes ArtUp Trace ships translations for. */
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
 * Normalises a Jira locale (e.g. `ru_RU`) to one of SUPPORTED_LOCALES: exact
 * match wins, then a preferred language match, else en-US.
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

function applyPlaceholders(template, values) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const hasValue = values && Object.prototype.hasOwnProperty.call(values, name)
      && values[name] !== undefined && values[name] !== null;
    return hasValue ? String(values[name]) : '';
  });
}

/**
 * Builds a translate function for a resolved locale: locale dictionary,
 * then en-US, then the raw key; fills `{name}` placeholders from values.
 */
export function createT(locale, dictionaries) {
  const dict = dictionaries[locale] || dictionaries[DEFAULT_LOCALE] || {};
  const fallbackDict = dictionaries[DEFAULT_LOCALE] || {};
  return function t(key, values) {
    const template = dict[key] ?? fallbackDict[key] ?? key;
    return applyPlaceholders(template, values);
  };
}

const I18nContext = createContext(null);

/** Provides a translate function for the resolved Jira locale to descendants. */
export function I18nProvider({ locale, children }) {
  const value = useMemo(() => {
    const resolved = resolveLocale(locale);
    return { locale: resolved, t: createT(resolved, localeDictionaries) };
  }, [locale]);
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
