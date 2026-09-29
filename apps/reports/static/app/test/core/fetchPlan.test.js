import { describe, expect, it } from 'vitest';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { BUILTINS, builtinById } from '../../src/core/builtins.js';
import { planFetch } from '../../src/core/fetchPlan.js';

const catalog = buildFieldCatalog([
  { id: 'summary', name: 'Summary', schema: { type: 'string' } },
  { id: 'labels', name: 'Labels', schema: { type: 'array' } },
  { id: 'customfield_10016', name: 'Story Points', custom: true, schema: { type: 'number' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
]);
const BASE = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'project'];

describe('BUILTINS', () => {
  it('has four Excel column sets and four layouts for each of Word and PDF', () => {
    expect(BUILTINS.map((b) => b.id)).toEqual([
      'xlsx-issues', 'xlsx-worklogs', 'xlsx-comments', 'xlsx-sprint',
      'docx-single', 'docx-list', 'docx-sprint', 'docx-release',
      'pdf-single', 'pdf-list', 'pdf-sprint', 'pdf-release',
    ]);
  });
});

describe('planFetch prototype keys', () => {
  it('yields only real field ids for tags named like inherited properties', () => {
    const tags = ['constructor', 'toString', '__proto__', 'hasOwnProperty'].map((name) => ({ name, kind: 'value', children: [] }));
    expect(planFetch({ format: 'docx', kind: 'docx', placeholders: tags }, catalog)).toEqual({ fields: BASE, comments: false, worklogs: false, images: false, rendered: false, missing: [] });
  });
});

describe('planFetch', () => {
  it('reads only the columns of an Excel template plus the base fields', () => {
    const plan = planFetch({ format: 'xlsx', kind: 'columns', columns: ['key', 'labels', 'customfield_99999'], rowMode: 'issue', groupBy: null, summary: false }, catalog);
    expect(plan).toEqual({ fields: [...BASE, 'labels'], comments: false, worklogs: false, images: false, rendered: false, missing: ['customfield_99999'] });
  });
  it('reads worklogs for the worklog row mode', () => {
    const plan = planFetch(builtinById('xlsx-worklogs'), catalog);
    expect(plan.worklogs).toBe(true);
    expect(plan.fields).toContain('worklog');
  });
  it('reads the group-by field', () => {
    expect(planFetch({ format: 'xlsx', kind: 'columns', columns: ['key'], rowMode: 'issue', groupBy: 'labels', summary: true }, catalog).fields).toContain('labels');
  });
  it('reads everything a built-in layout shows, with images and rendered fields', () => {
    const plan = planFetch(builtinById('docx-sprint'), catalog);
    expect(plan).toMatchObject({ comments: true, images: true, rendered: true, worklogs: false });
    expect(plan.fields).toEqual(expect.arrayContaining(['description', 'attachment', 'comment', 'subtasks', 'issuelinks', 'customfield_10016', 'customfield_10020']));
  });
  it('derives fields and reads from the tags of a custom Word template', () => {
    const tags = [{ name: 'issues', kind: 'loop', children: [
      { name: 'summary', kind: 'value', children: [] },
      { name: 'field "Story Points"', kind: 'value', children: [] },
      { name: 'description', kind: 'raw', children: [] },
      { name: 'worklogs', kind: 'loop', children: [{ name: 'hours', kind: 'value', children: [] }] },
    ] }];
    const plan = planFetch({ format: 'docx', kind: 'docx', placeholders: tags }, catalog);
    expect(plan).toEqual({
      fields: [...BASE, 'customfield_10016', 'description', 'attachment', 'worklog'],
      comments: false, worklogs: true, images: true, rendered: true, missing: [],
    });
  });
});
