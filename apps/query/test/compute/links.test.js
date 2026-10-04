import { describe, expect, it } from 'vitest';
import { fakeJira, issue } from '../fakeJira.js';
import { createLinkCompute } from '../../src/compute/links.js';

const TYPES = [{ id: '1', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }, { id: '2', name: 'Relates', outward: 'relates to', inward: 'relates to' }];
const out = (t, id) => ({ type: { id: t }, outwardIssue: { id: String(id) } });
const inw = (t, id) => ({ type: { id: t }, inwardIssue: { id: String(id) } });
const ISSUES = [
  issue(1, { links: [out('1', 2), inw('2', 5)] }),
  issue(2, { links: [inw('1', 1), out('1', 3)] }),
  issue(3, { links: [inw('1', 2), out('1', 1)] }),
  issue(5, { links: [out('2', 1)] }),
];
const ctx = { reconcile: [] };
const make = (searches) => createLinkCompute({ jira: fakeJira({ issues: ISSUES, searches, linkTypes: TYPES }) });

describe('link compute', () => {
  it('linkedIssuesOf returns every linked issue without a type', async () => {
    expect(await make({ S: ['1'] }).linkedIssuesOf({ subquery: 'S' }, ctx)).toEqual({ ids: ['2', '5'], field: 'id', watch: ['1'] });
  });
  it('linkedIssuesOf watches the inner issues in id order', async () => {
    expect((await make({ S: ['5', '1'] }).linkedIssuesOf({ subquery: 'S' }, ctx)).watch).toEqual(['1', '5']);
  });
  it('linkedIssuesOf follows one direction of a type', async () => {
    expect((await make({ S: ['2'] }).linkedIssuesOf({ subquery: 'S', linkType: 'blocks' }, ctx)).ids).toEqual(['3']);
    expect((await make({ S: ['2'] }).linkedIssuesOf({ subquery: 'S', linkType: 'is blocked by' }, ctx)).ids).toEqual(['1']);
  });
  it('linkedIssuesOf names an unknown link type before searching', async () => {
    expect(await make({}).linkedIssuesOf({ subquery: 'S', linkType: 'nope' }, ctx)).toEqual({ error: 'Link type "nope" not found', log: 'Link type not found' });
  });
  it('linkedIssuesOfRecursive follows a cycle once and watches every reached issue', async () => {
    expect(await make({ S: ['1'] }).linkedIssuesOfRecursive({ subquery: 'S', linkType: 'blocks' }, ctx)).toEqual({ ids: ['1', '2', '3'], field: 'id', watch: ['1', '2', '3'] });
  });
  it('linkedIssuesOfRecursiveLimited stops at the depth', async () => {
    expect((await make({ S: ['1'] }).linkedIssuesOfRecursiveLimited({ subquery: 'S', depth: 1, linkType: 'blocks' }, ctx)).ids).toEqual(['2']);
  });
  it('linkedIssuesOfRecursive names an unknown link type before searching', async () => {
    expect(await make({}).linkedIssuesOfRecursive({ subquery: 'S', linkType: 'nope' }, ctx)).toEqual({ error: 'Link type "nope" not found', log: 'Link type not found' });
  });
  it('re-reads touched inner issues one by one for links bulkfetch may still miss', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['1', '2'] }, linkTypes: TYPES });
    await createLinkCompute({ jira }).linkedIssuesOf({ subquery: 'S' }, { reconcile: ['2', '9'] });
    expect(jira.calls.filter((c) => c[0] === 'issue')).toEqual([['issue', '2']]);
  });
  it('uses the links of the re-read issue over the bulk answer', async () => {
    const stale = issue(2, { links: [] });
    const jira = fakeJira({ issues: [stale], searches: { S: ['2'] }, linkTypes: TYPES });
    jira.issue = async () => issue(2, { links: [out('1', 3)] });
    expect((await createLinkCompute({ jira }).linkedIssuesOf({ subquery: 'S' }, { reconcile: ['2'] })).ids).toEqual(['3']);
  });
  it('keeps the bulk links when the re-read issue is gone', async () => {
    const jira = fakeJira({ issues: ISSUES, searches: { S: ['2'] }, linkTypes: TYPES });
    jira.issue = async () => null;
    expect((await createLinkCompute({ jira }).linkedIssuesOf({ subquery: 'S' }, { reconcile: ['2'] })).ids).toEqual(['1', '3']);
  });
  it('hasLinks and hasLinkType answer with native JQL', async () => {
    const compute = make({});
    expect(await compute.hasLinks({}, ctx)).toEqual({ native: 'issueLinkType is not EMPTY' });
    expect(await compute.hasLinkType({ linkType: 'Blocks' }, ctx)).toEqual({ native: 'issueLinkType in ("blocks", "is blocked by")' });
  });
  it('hasLinks answers a direction that clashes with no type name with native JQL', async () => {
    expect(await make({}).hasLinks({ linkType: 'is blocked by' }, ctx)).toEqual({ native: 'issueLinkType = "is blocked by"' });
  });
  it('hasLinks computes a direction Jira would read as a type name on both sides', async () => {
    const issues = [issue(10, { links: [out('1', 11)] }), issue(11, { links: [inw('1', 10), out('2', 12)] }), issue(12, { links: [inw('2', 11)] })];
    const jira = fakeJira({ issues, searches: { 'issueLinkType = "Blocks"': ['10', '11'] }, linkTypes: TYPES });
    expect(await createLinkCompute({ jira }).hasLinks({ linkType: 'blocks' }, ctx)).toEqual({ ids: ['10'], field: 'id', watch: null });
  });
  it('hasLinks names an unknown link type', async () => {
    expect(await make({}).hasLinkType({ linkType: 'nope' }, ctx)).toEqual({ error: 'Link type "nope" not found', log: 'Link type not found' });
  });
});
