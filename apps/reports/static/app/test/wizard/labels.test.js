// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PSEUDO_COLUMNS } from '../../src/core/columns.js';
import { createT, localeDictionaries } from '../../src/i18n/index.js';
import { FILE_LABEL_KEYS, formatsFor, labelsFor } from '../../src/wizard/labels.js';

const FILES = ['core/rows.js', 'core/layouts.js', 'render/xlsx.js', 'render/docx.js', 'render/pdf.js', 'render/ooxml.js', 'render/docxTemplate.js'];
const source = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

function referencedKeys(text) {
  const keys = new Set();
  for (const [, key] of text.matchAll(/labels\[['"]([^'"]+)['"]\]/g)) keys.add(key);
  for (const [, key] of text.matchAll(/labels\??\.([A-Za-z_]\w*)/g)) keys.add(key);
  for (const [, key] of text.matchAll(/['"]((?:layout|meta|sheet|summary)\.[A-Za-z]+)['"]/g)) keys.add(key);
  if (text.includes('`column.${')) for (const id of PSEUDO_COLUMNS) keys.add(`column.${id}`);
  return keys;
}

const en = createT('en-US', localeDictionaries);

describe('labelsFor', () => {
  it.each(FILES)('provides every label %s reads', (file) => {
    const labels = labelsFor(en);
    const missing = [...referencedKeys(source(file))].filter((key) => labels[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('finds the label references it checks, including arrays and dynamic column keys', () => {
    const found = new Set(FILES.flatMap((file) => [...referencedKeys(source(file))]));
    expect(['layout.fixVersions', 'summary.byPriority', 'sheet.issues', 'column.worklog.hours', 'partialBanner', 'imageUnavailable', 'unassigned']
      .filter((key) => !found.has(key))).toEqual([]);
  });

  it('translates every text label instead of echoing its key', () => {
    const labels = labelsFor(en);
    expect(FILE_LABEL_KEYS.filter((key) => labels[key] === `file.${key}`)).toEqual([]);
  });

  it('builds the partial banner with locale numbers', () => {
    expect(labelsFor(createT('de-DE', localeDictionaries)).partialBanner(1200, 3400)).toBe('Unvollständiger Export: 1.200 von 3.400 Vorgängen');
  });

  it('writes pseudo-column headers in the UI language', () => {
    expect(labelsFor(createT('de-DE', localeDictionaries))['column.worklog.hours']).toBe('Stunden');
  });
});

describe('formatsFor', () => {
  it('formats a calendar date in UTC with the medium style', () => {
    const utcMidnight = new Date(Date.UTC(2026, 8, 29));
    expect(formatsFor('en-US').date(utcMidnight)).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(utcMidnight));
    expect(formatsFor('de-DE').date(utcMidnight)).toBe('29.09.2026');
  });

  it('formats a date-time in local time with the medium style', () => {
    const moment = new Date(2026, 8, 29, 14, 5, 9);
    expect(formatsFor('en-GB').dateTime(moment)).toBe(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(moment));
  });
});
