import { describe, expect, it } from 'vitest';
import { prepareIssue } from '../../src/core/prepare.js';
import { buildTemplateData } from '../../src/core/templateData.js';
import { SITE, catalog, formats, makeIssue } from '../fixtures/issues.js';

const toXml = (b) => `<x n="${b.length}"/>`;
const meta = { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 2, siteUrl: SITE };
const prepare = (overrides) => prepareIssue(makeIssue(overrides), { catalog, siteUrl: SITE, formats, fieldNames: ['Team'] });
const one = prepare();
const two = prepare({ id: '10002', key: 'RPT-2', fields: { summary: 'Summary two', customfield_10030: null } });
const labels = { partialBanner: (done, total) => `Incomplete export: ${done} of ${total} issues` };
const data = buildTemplateData({ issues: [one, two], meta, toXml, labels });

describe('buildTemplateData', () => {
  it('puts the document tags and the first issue at the root and all issues under issues', () => {
    const root = Object.fromEntries(['jql', 'exportedBy', 'exportedAt', 'count', 'title', 'siteUrl', 'key', 'summary'].map((k) => [k, data[k]]));
    expect({ root, issues: data.issues.map((i) => i.key) }).toEqual({
      root: { jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 2, title: '', siteUrl: SITE, key: 'RPT-1', summary: 'Summary one' },
      issues: ['RPT-1', 'RPT-2'],
    });
  });

  it('gives each rich field a plain-text tag and an __xml tag', () => {
    const rich = ['description', 'description__xml', 'environment', 'environment__xml'].map((k) => [k, data[k]]);
    expect(Object.fromEntries(rich)).toEqual({
      description: 'Intro\nStep | Result\nOpen | Works\n[image]',
      description__xml: '<x n="3"/>',
      environment: '',
      environment__xml: '<x n="0"/>',
    });
  });

  it('gives comments author, created and a plain and xml body', () => {
    expect(data.comments).toEqual([
      { author: 'Ann', created: 'DT:2026-09-02T08:00:00.000Z', body: 'Looks good\n[image]', body__xml: '<x n="2"/>' },
      { author: 'Rob', created: 'DT:2026-09-02T09:15:00.000Z', body: 'Thanks', body__xml: '<x n="1"/>' },
    ]);
  });

  it('gives worklogs author, started, time spent, hours and a plain and xml comment', () => {
    expect(data.worklogs).toEqual([
      { author: 'Bob', started: 'DT:2026-09-02T09:00:00.000Z', timeSpent: '1h 30m', hours: 1.5, comment: 'Worked', comment__xml: '<x n="1"/>' },
    ]);
  });

  it('passes the requested custom fields through', () => {
    expect(data.issues.map((i) => i.fields)).toEqual([{ Team: 'Core' }, { Team: '' }]);
  });

  it('uses the export title when there is one', () => {
    expect(buildTemplateData({ issues: [one], meta: { ...meta, title: 'Report' }, toXml, labels }).title).toBe('Report');
  });

  it('has only document tags and an empty issue list without issues', () => {
    expect(buildTemplateData({ issues: [], meta: { ...meta, count: 0 }, toXml, labels })).toEqual({
      jql: 'project = RPT', exportedBy: 'Ann', exportedAt: '29 Sep 2026 10:00', count: 0, title: '', siteUrl: SITE,
      partial: false, partialBanner: '', issues: [],
    });
  });

  it('marks a partial file with a flag and the translated banner', () => {
    const partial = buildTemplateData({ issues: [one], meta: { ...meta, count: 1, partial: { done: 100, total: 300 } }, toXml, labels });
    expect([partial.partial, partial.partialBanner, data.partial, data.partialBanner]).toEqual([true, 'Incomplete export: 100 of 300 issues', false, '']);
  });
});
