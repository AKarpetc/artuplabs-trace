import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SUPPORTED_LOCALES,
  createT,
  formatDate,
  formatNumber,
  I18nProvider,
  resolveLocale,
  useT,
} from '../src/i18n/index.js';

const localesDir = resolve(process.cwd(), 'src/i18n/locales/');

function extractPlaceholders(value) {
  if (typeof value !== 'string') return [];
  const matches = value.match(/\{(\w+)\}/g) || [];
  return matches.map((match) => match.slice(1, -1));
}

describe('resolveLocale', () => {
  it.each([
    ['ru_RU', 'ru-RU'],
    ['ru', 'ru-RU'],
    ['pt', 'pt-BR'],
    ['pt_PT', 'pt-PT'],
    ['zh', 'zh-CN'],
    ['en_GB', 'en-GB'],
    ['nb_NO', 'no-NO'],
    ['xx_YY', 'en-US'],
    [undefined, 'en-US'],
  ])('resolves %s to %s', (raw, expected) => {
    expect(resolveLocale(raw)).toBe(expected);
  });

  it('lists exactly the 26 supported Jira locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(26);
    expect(new Set(SUPPORTED_LOCALES).size).toBe(26);
  });
});

describe('createT', () => {
  it('falls back to en-US when the requested locale has no dictionary', () => {
    const dictionaries = { 'en-US': { greeting: 'Hi {name}' } };
    const t = createT('fr-FR', dictionaries);
    expect(t('greeting', { name: 'Sam' })).toBe('Hi Sam');
  });

  it('never crashes on an unresolved or unknown locale, falling back to en-US', () => {
    const dictionaries = { 'en-US': { greeting: 'Hi' } };
    const t = createT('xx-YY', dictionaries);
    expect(t('greeting')).toBe('Hi');
  });

  it('returns the raw key when it is missing from every dictionary', () => {
    const dictionaries = { 'en-US': {} };
    const t = createT('en-US', dictionaries);
    expect(t('missing.key')).toBe('missing.key');
  });

  it('fills repeated placeholders from values', () => {
    const dictionaries = { 'en-US': { greet: 'Hi {name}, {name}!' } };
    const t = createT('en-US', dictionaries);
    expect(t('greet', { name: 'Sam' })).toBe('Hi Sam, Sam!');
  });

  it('renders a missing placeholder value as an empty string, never the raw {name}', () => {
    const dictionaries = { 'en-US': { greet: 'Hi {name}, {name}!' } };
    const t = createT('en-US', dictionaries);
    expect(t('greet', {})).toBe('Hi , !');
  });

  it('renders a numeric 0 placeholder value as "0", not empty', () => {
    const dictionaries = { 'en-US': { count: 'Count: {n}' } };
    const t = createT('en-US', dictionaries);
    expect(t('count', { n: 0 })).toBe('Count: 0');
  });
});

describe('locale key parity', () => {
  const files = readdirSync(localesDir).filter((name) => name.endsWith('.json'));
  const baseline = JSON.parse(readFileSync(join(localesDir, 'en-US.json'), 'utf-8'));
  const baselineKeys = Object.keys(baseline).sort();

  it.each(files)('%s has the same key set as en-US', (file) => {
    const dict = JSON.parse(readFileSync(join(localesDir, file), 'utf-8'));
    expect(Object.keys(dict).sort()).toEqual(baselineKeys);
  });

  it.each(files)('%s preserves every {placeholder} used in en-US', (file) => {
    const dict = JSON.parse(readFileSync(join(localesDir, file), 'utf-8'));
    for (const key of baselineKeys) {
      const expectedPlaceholders = extractPlaceholders(baseline[key]);
      const actualPlaceholders = extractPlaceholders(dict[key]);
      for (const placeholder of expectedPlaceholders) {
        expect(actualPlaceholders).toContain(placeholder);
      }
    }
  });
});

describe('formatNumber', () => {
  it('formats using the resolved locale', () => {
    expect(formatNumber('en-US', 1234)).toBe('1,234');
  });

  it('resolves an unsupported locale before formatting', () => {
    expect(formatNumber('xx-YY', 1234)).toBe('1,234');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO date-time using the resolved locale', () => {
    const formatted = formatDate('en-US', '2026-01-15T10:30:00Z');
    expect(formatted).not.toBe('');
    expect(formatted).not.toContain('Invalid Date');
  });

  it('returns an empty string for an invalid ISO value, never "Invalid Date"', () => {
    expect(formatDate('en-US', 'not-a-date')).toBe('');
  });

  it('returns an empty string for an empty ISO value, never throwing', () => {
    expect(() => formatDate('en-US', '')).not.toThrow();
    expect(formatDate('en-US', '')).toBe('');
  });
});

describe('I18nProvider / useT', () => {
  afterEach(() => {
    cleanup();
  });

  function Consumer() {
    const t = useT();
    return createElement('span', null, t('app.title'));
  }

  it('provides the translate function to descendants', () => {
    render(createElement(I18nProvider, { locale: 'en-US' }, createElement(Consumer)));
    expect(screen.getByText('ArtUp Trace')).toBeInTheDocument();
  });

  it('resolves an unrecognised Jira locale to en-US content', () => {
    render(createElement(I18nProvider, { locale: 'xx_YY' }, createElement(Consumer)));
    expect(screen.getByText('ArtUp Trace')).toBeInTheDocument();
  });

  it('throws when useT is called outside an I18nProvider', () => {
    const Broken = () => {
      useT();
      return null;
    };
    expect(() => render(createElement(Broken))).toThrow();
  });
});
