import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { builtinById } from '../../src/core/builtins.js';
import { imagesFor, prepareIssue } from '../../src/core/prepare.js';
import { SITE, catalog, formats, makeIssue } from '../fixtures/issues.js';

const prepare = (issue, extra = {}) => prepareIssue(issue, { catalog, siteUrl: SITE, formats, ...extra });
const para = (text) => ({ type: 'para', runs: [{ text }] });
const cell = (header, text) => ({ header, colspan: 1, rowspan: 1, blocks: [para(text)] });
const image = (attachmentId) => ({ type: 'image', attachmentId, alt: '', width: 200, height: 183 });

describe('prepareIssue', () => {
  it('turns scalar fields into display strings through the formats', () => {
    const p = prepare(makeIssue());
    const scalars = Object.fromEntries(['id', 'key', 'url', 'summary', 'type', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated', 'due', 'resolved', 'resolution', 'labels', 'components', 'fixVersions', 'project', 'parent', 'timeSpent', 'estimate'].map((k) => [k, p[k]]));
    expect(scalars).toEqual({
      id: '10001', key: 'RPT-1', url: `${SITE}/browse/RPT-1`, summary: 'Summary one',
      type: 'Story', status: 'In Progress', priority: 'High', assignee: 'Ann', reporter: 'Rob',
      created: 'DT:2026-09-01T10:00:00.000Z', updated: 'DT:2026-09-03T12:30:00.000Z', due: 'D:2026-09-30',
      resolved: '', resolution: '', labels: 'alpha, beta', components: 'API', fixVersions: 'v1.0',
      project: 'Reports', parent: 'RPT-9', timeSpent: '1.5 h', estimate: '2 h',
    });
  });

  it('converts the description to blocks with the inline image resolved to its attachment', () => {
    const p = prepare(makeIssue());
    expect(p.description).toEqual([
      para('Intro'),
      { type: 'table', header: true, rows: [
        { cells: [cell(true, 'Step'), cell(true, 'Result')] },
        { cells: [cell(false, 'Open'), cell(false, 'Works')] },
      ] },
      image('10500'),
    ]);
  });

  it('lists images used by blocks as inline and other image attachments as gallery, leaving out non-images', () => {
    const p = prepare(makeIssue());
    expect({ inlineImages: p.inlineImages, gallery: p.gallery }).toEqual({ inlineImages: ['10500', '10503'], gallery: ['10501'] });
  });

  it('shows a non-image file card by its file name, keeping it out of the images to download', () => {
    const card = { type: 'media', attrs: { type: 'file', id: 'uuid-pdf', collection: '' } };
    const description = { type: 'doc', version: 1, content: [{ type: 'panel', attrs: { panelType: 'info' }, content: [{ type: 'mediaGroup', content: [card] }] }] };
    const rendered = '<a href="/rest/api/3/attachment/content/10502" data-media-services-id="uuid-pdf">spec.pdf</a>';
    const p = prepare(makeIssue({ fields: { description }, renderedFields: { description: rendered } }));
    expect(p.description).toEqual([{ type: 'panel', kind: 'info', blocks: [para('spec.pdf')] }]);
    expect(p.inlineImages).toEqual(['10503']);
    expect(p.warnings).toEqual([]);
  });

  it('carries comment author, formatted date and blocks resolved against that comment\'s rendered body', () => {
    expect(prepare(makeIssue()).comments).toEqual([
      { author: 'Ann', created: 'DT:2026-09-02T08:00:00.000Z', blocks: [para('Looks good'), image('10503')] },
      { author: 'Rob', created: 'DT:2026-09-02T09:15:00.000Z', blocks: [para('Thanks')] },
    ]);
  });

  it('carries worklog seconds, hours rounded to two decimals and Jira\'s time-spent text', () => {
    const issue = makeIssue({ fields: { worklog: { total: 1, worklogs: [
      { author: { displayName: 'Bob' }, started: '2026-09-02T09:00:00.000+0000', timeSpent: '16m', timeSpentSeconds: 1000, comment: null },
    ] } } });
    expect(prepare(issue).worklogs).toEqual([
      { author: 'Bob', started: 'DT:2026-09-02T09:00:00.000Z', seconds: 1000, hours: 0.28, timeSpent: '16m', blocks: [] },
    ]);
  });

  it('lists sub-tasks and links in both directions with the direction\'s wording', () => {
    const p = prepare(makeIssue());
    expect({ subtasks: p.subtasks, links: p.links }).toEqual({
      subtasks: [{ key: 'RPT-3', summary: 'Sub one', status: 'To Do', type: 'Sub-task', url: `${SITE}/browse/RPT-3` }],
      links: [
        { type: 'blocks', direction: 'outward', key: 'RPT-4', summary: 'Other', status: 'Done', url: `${SITE}/browse/RPT-4` },
        { type: 'is blocked by', direction: 'inward', key: 'RPT-5', summary: 'Blocker', status: 'To Do', url: `${SITE}/browse/RPT-5` },
      ],
    });
  });

  it('reads story points and sprint from the fields the site uses for them', () => {
    const p = prepare(makeIssue());
    expect({ storyPoints: p.storyPoints, storyPointsValue: p.storyPointsValue, sprint: p.sprint }).toEqual({ storyPoints: '3', storyPointsValue: 3, sprint: 'Sprint 7' });
  });

  it('leaves story points and sprint empty on a site without those fields', () => {
    const bare = buildFieldCatalog([{ id: 'summary', name: 'Summary', schema: { type: 'string' } }]);
    const p = prepareIssue(makeIssue(), { catalog: bare, siteUrl: SITE, formats });
    expect({ storyPoints: p.storyPoints, storyPointsValue: p.storyPointsValue, sprint: p.sprint }).toEqual({ storyPoints: '', storyPointsValue: null, sprint: '' });
  });

  it('holds only the requested fields by name, empty for an unknown or inherited name', () => {
    const p = prepare(makeIssue(), { fieldNames: ['Team', 'story points', 'Nope', 'constructor', '__proto__'] });
    expect(Object.entries(p.fields)).toEqual([['Team', 'Core'], ['story points', '3'], ['Nope', ''], ['constructor', ''], ['__proto__', '']]);
  });

  it('collects the conversion warnings of every rich field', () => {
    const odd = (type) => ({ type: 'doc', version: 1, content: [{ type, content: [{ type: 'text', text: 'x' }] }] });
    const issue = makeIssue({ fields: {
      environment: odd('mysteryBlock'),
      worklog: { total: 1, worklogs: [{ author: { displayName: 'Bob' }, started: '2026-09-02T09:00:00.000+0000', timeSpent: '1h', timeSpentSeconds: 3600, comment: odd('mysteryWorklog') }] },
      customfield_10040: odd('mysteryField'),
    } });
    expect(prepare(issue, { fieldNames: ['Acceptance'] }).warnings).toEqual([
      { kind: 'adf-fallback', detail: 'mysteryBlock' },
      { kind: 'adf-fallback', detail: 'mysteryWorklog' },
      { kind: 'adf-fallback', detail: 'mysteryField' },
    ]);
  });
});

describe('imagesFor', () => {
  const p = prepareIssue(makeIssue(), { catalog, siteUrl: SITE, formats });

  it('shows inline and gallery images in the single-issue layout', () => {
    expect(imagesFor(builtinById('docx-single'), p)).toEqual(['10500', '10503', '10501']);
  });

  it('shows no images in the list layout', () => {
    expect(imagesFor(builtinById('pdf-list'), p)).toEqual([]);
  });

  it('shows only inline images in a custom Word template', () => {
    expect(imagesFor({ format: 'docx', kind: 'docx', placeholders: [] }, p)).toEqual(['10500', '10503']);
  });
});
