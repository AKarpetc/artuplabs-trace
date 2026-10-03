import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eventRecord } from '../../src/core/events.js';

const dir = new URL('../fixtures/events/', import.meta.url);

describe('eventRecord', () => {
  it('takes the issue and its parent from a created issue', () => {
    expect(eventRecord({ eventType: 'avi:jira:created:issue', issue: { id: '20', fields: { parent: { id: '10' } } } })).toEqual({ ids: ['10', '20'], kinds: ['issue-created'] });
  });
  it('reads parent, sprint and status changes from the changelog', () => {
    const event = {
      eventType: 'avi:jira:updated:issue',
      issue: { id: '20' },
      changelog: { id: '900', items: [
        { field: 'IssueParentAssociation', fieldId: 'parent', from: '10', to: '11' },
        { field: 'Sprint', fieldId: 'customfield_10020', from: '1', to: '1, 2' },
        { field: 'status', fieldId: 'status', from: '10000', to: '10001' },
      ] },
    };
    expect(eventRecord(event)).toEqual({ ids: ['10', '11', '20'], kinds: ['issue-updated', 'parent', 'sprint-field', 'status'] });
  });
  it('ignores non-numeric changelog values', () => {
    expect(eventRecord({ eventType: 'avi:jira:updated:issue', issue: { id: '20' }, changelog: { items: [{ field: 'Epic Link', from: 'DEMO-1', to: null }] } }).ids).toEqual(['20']);
  });
  it('takes both ends of a link', () => {
    expect(eventRecord({ eventType: 'avi:jira:deleted:issuelink', issueLink: { sourceIssueId: 5, destinationIssueId: 6 } })).toEqual({ ids: ['5', '6'], kinds: ['link'] });
  });
  it('takes both ends of a link from the top level of the event', () => {
    expect(eventRecord({ eventType: 'avi:jira:created:issuelink', id: '1', sourceIssueId: '7', destinationIssueId: '8' })).toEqual({ ids: ['7', '8'], kinds: ['link'] });
  });
  it('takes the issue of an attachment from the event issue when the attachment has none', () => {
    expect(eventRecord({ eventType: 'avi:jira:deleted:attachment', issue: { id: '21' }, attachment: { id: '1' } })).toEqual({ ids: ['21'], kinds: ['attachment'] });
  });
  it('marks every sprint event of the board product', () => {
    const types = ['created', 'started', 'updated', 'closed', 'deleted'].map((v) => `avi:jira-software:${v}:sprint`);
    expect(types.map((eventType) => eventRecord({ eventType }).kinds)).toEqual(types.map(() => ['sprint']));
  });
  it('tolerates a changelog without a list of items or with empty entries', () => {
    expect(eventRecord({ eventType: 'avi:jira:updated:issue', issue: { id: '20' }, changelog: { items: { field: 'status' } } })).toEqual({ ids: ['20'], kinds: ['issue-updated'] });
    expect(eventRecord({ eventType: 'avi:jira:updated:issue', issue: { id: '20' }, changelog: { items: [null, 'x', { field: 'status' }] } })).toEqual({ ids: ['20'], kinds: ['issue-updated', 'status'] });
  });
  it('adds no kind for a field nothing depends on', () => {
    expect(eventRecord({ eventType: 'avi:jira:updated:issue', issue: { id: '20' }, changelog: { items: [{ field: 'summary', fieldId: 'summary', from: '1', to: '2' }] } })).toEqual({ ids: ['20'], kinds: ['issue-updated'] });
  });
  it('calls a missing or empty event unknown', () => {
    expect(eventRecord(undefined)).toEqual({ ids: [], kinds: ['unknown'] });
    expect(eventRecord({})).toEqual({ ids: [], kinds: ['unknown'] });
  });
  it('marks sprint, comment and attachment events', () => {
    expect(eventRecord({ eventType: 'avi:jira-software:started:sprint', sprint: { id: 3 } })).toEqual({ ids: [], kinds: ['sprint'] });
    expect(eventRecord({ eventType: 'avi:jira:commented:issue', issue: { id: '20' }, comment: { id: '1' } })).toEqual({ ids: ['20'], kinds: ['comment'] });
    expect(eventRecord({ eventType: 'avi:jira:created:attachment', attachment: { id: '1', issueId: '20' } })).toEqual({ ids: ['20'], kinds: ['attachment'] });
  });
  it('calls anything else unknown', () => {
    expect(eventRecord({ eventType: 'avi:jira:mentioned:issue', issue: { id: '1' } }).kinds).toEqual(['unknown']);
  });
  it.each(readdirSync(dir).filter((f) => f.endsWith('.json')))('reads the documented %s without unknown kinds', (file) => {
    const record = eventRecord(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
    expect(record.kinds).not.toContain('unknown');
  });
});
