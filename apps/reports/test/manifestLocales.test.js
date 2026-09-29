import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const KEYS = [
  'module.globalPage.title',
  'module.issueNavigatorAction.title',
  'module.boardAction.title',
  'module.backlogAction.title',
  'module.sprintAction.title',
  'module.issueAction.title',
];

const localesDir = new URL('../locales/', import.meta.url);
const manifestText = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf-8');

function readLocale(fileName) {
  return JSON.parse(readFileSync(new URL(fileName, localesDir), 'utf-8'));
}

const localeFiles = readdirSync(localesDir).sort();

describe('locale files', () => {
  it('has exactly 26 locale files', () => {
    expect(localeFiles).toHaveLength(26);
  });

  it.each(localeFiles)('%s has exactly the module title keys with non-empty strings', (fileName) => {
    const data = readLocale(fileName);
    expect(Object.keys(data).sort()).toEqual([...KEYS].sort());
    for (const value of Object.values(data)) {
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps 'ArtUp Reports' untranslated in every locale", () => {
    for (const fileName of localeFiles) {
      expect(readLocale(fileName)['module.globalPage.title']).toBe('ArtUp Reports');
    }
  });
});

describe('manifest translations', () => {
  it('lists all 26 locales under translations', () => {
    const afterTranslations = manifestText.split(/^translations:/m)[1];
    const translationsSection = afterTranslations.split(/^permissions:/m)[0];
    const keyLines = [...translationsSection.matchAll(/^\s{4}- key:\s*(\S+)/gm)];
    const listedLocales = keyLines.map((match) => match[1]).sort();
    const fileLocales = localeFiles.map((fileName) => fileName.replace('.json', '')).sort();
    expect(listedLocales).toEqual(fileLocales);
  });
});
