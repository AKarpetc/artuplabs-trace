import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createT, I18nProvider, resolveLocale, SUPPORTED_LOCALES, localeDictionaries, formatBytes } from '../src/i18n/index.js';

const en = localeDictionaries['en-US'];
const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

describe('resolveLocale', () => {
  it.each([
    ['ru_RU', 'ru-RU'], ['ru', 'ru-RU'], ['pt', 'pt-BR'], ['en_GB', 'en-GB'], ['nb-NO', 'no-NO'],
    ['zh', 'zh-CN'], ['zh_TW', 'zh-TW'], ['xx_YY', 'en-US'], ['', 'en-US'], [undefined, 'en-US'],
  ])('%s → %s', (raw, expected) => expect(resolveLocale(raw)).toBe(expected));
});

describe('locale files', () => {
  it('ship all 26 locales', () => {
    expect(Object.keys(localeDictionaries).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });
  it.each(SUPPORTED_LOCALES)('%s has exactly the en-US keys and entry shapes', (locale) => {
    const dict = localeDictionaries[locale];
    expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(typeof dict[key]).toBe(typeof en[key]);
    }
  });
  it.each(SUPPORTED_LOCALES)('%s keeps placeholders and plural categories', (locale) => {
    const dict = localeDictionaries[locale];
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, value] of Object.entries(en)) {
      if (typeof value === 'string') {
        expect([...placeholders(dict[key])].sort(), `${locale} ${key}`).toEqual([...placeholders(value)].sort());
        continue;
      }
      for (const category of categories) {
        expect(dict[key][category], `${locale} ${key}.${category}`).toBeTypeOf('string');
        expect([...placeholders(dict[key][category])].every((p) => placeholders(value.other).has(p))).toBe(true);
      }
    }
  });
  it.each(SUPPORTED_LOCALES)('%s has no empty strings', (locale) => {
    const flat = Object.values(localeDictionaries[locale]).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)));
    expect(flat.every((s) => s.trim().length > 0)).toBe(true);
  });
});

describe('createT', () => {
  const dicts = {
    'en-US': { hello: 'Hello {name}', pages: { one: '{count} page', other: '{count} pages' } },
    'ru-RU': { hello: 'Привет {name}', pages: { one: '{count} страница', few: '{count} страницы', many: '{count} страниц', other: '{count} страницы' } },
  };
  it('fills placeholders and formats numbers per locale', () => {
    const t = createT('ru-RU', dicts);
    expect(t('hello', { name: 'Аня' })).toBe('Привет Аня');
    expect(t('pages', { count: 1 })).toBe('1 страница');
    expect(t('pages', { count: 3 })).toBe('3 страницы');
    expect(t('pages', { count: 1024 })).toBe(`${new Intl.NumberFormat('ru-RU').format(1024)} страницы`);
    expect(t('pages', { count: 5 })).toBe('5 страниц');
  });
  it('falls back to en-US, then to the key', () => {
    const t = createT('ja-JP', dicts);
    expect(t('pages', { count: 2 })).toBe('2 pages');
    expect(t('missing.key')).toBe('missing.key');
  });
});

describe('formatBytes', () => {
  it('uses locale units', () => {
    expect(formatBytes('en-US', 1536)).toBe('1.5 kB');
    expect(formatBytes('en-US', 5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('I18nProvider', () => {
  it('marks the document language with the resolved locale', () => {
    render(createElement(I18nProvider, { locale: 'ja_JP' }, createElement('span', null, 'x')));
    expect(document.documentElement.lang).toBe('ja-JP');
  });
});
