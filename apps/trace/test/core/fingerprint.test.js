import { describe, it, expect } from 'vitest';
import { fingerprint, linksHash, stableStringify } from '../../src/core/fingerprint';

const base = {
  id: '10001',
  key: 'REQ-1',
  fields: {
    summary: 'Login must lock after 5 attempts',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lock' }] }] },
    status: { name: 'To Do' },
    assignee: { accountId: 'a' },
    customfield_10050: 'High',
  },
};

describe('stableStringify', () => {
  it('orders object keys so equal objects serialise equally', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('fingerprint', () => {
  it('is a 64-char hex string', () => {
    expect(fingerprint(base, ['summary', 'description'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when summary changes', () => {
    const edited = { ...base, fields: { ...base.fields, summary: 'Login must lock after 3 attempts' } };
    expect(fingerprint(edited, ['summary', 'description'])).not.toBe(fingerprint(base, ['summary', 'description']));
  });

  it('changes when description changes', () => {
    const edited = { ...base, fields: { ...base.fields, description: { type: 'doc', version: 1, content: [] } } };
    expect(fingerprint(edited, ['summary', 'description'])).not.toBe(fingerprint(base, ['summary', 'description']));
  });

  it('ignores non-fingerprint fields', () => {
    const edited = { ...base, fields: { ...base.fields, status: { name: 'Done' }, assignee: { accountId: 'b' } } };
    expect(fingerprint(edited, ['summary', 'description'])).toBe(fingerprint(base, ['summary', 'description']));
  });

  it('includes a selected custom field', () => {
    const edited = { ...base, fields: { ...base.fields, customfield_10050: 'Low' } };
    const ids = ['summary', 'description', 'customfield_10050'];
    expect(fingerprint(edited, ids)).not.toBe(fingerprint(base, ids));
  });

  it('treats a missing field and null the same', () => {
    const withNull = { ...base, fields: { ...base.fields, description: null } };
    const without = { ...base, fields: { summary: base.fields.summary } };
    expect(fingerprint(withNull, ['summary', 'description'])).toBe(fingerprint(without, ['summary', 'description']));
  });
});

describe('linksHash', () => {
  it('does not depend on link order', () => {
    const a = { linkTypeId: '1', direction: 'out', otherIssueId: '2' };
    const b = { linkTypeId: '3', direction: 'in', otherIssueId: '4' };
    expect(linksHash([a, b])).toBe(linksHash([b, a]));
  });

  it('changes when a link is added', () => {
    const a = { linkTypeId: '1', direction: 'out', otherIssueId: '2' };
    expect(linksHash([a])).not.toBe(linksHash([]));
  });
});
