import { describe, it, expect } from 'vitest';
import { extractLinks, isCovered } from '../../src/core/links';

const issue = {
  id: '100',
  fields: {
    issuelinks: [
      {
        id: '900',
        type: { id: '10003', name: 'Tests', inward: 'is tested by', outward: 'tests' },
        inwardIssue: { id: '200', key: 'QA-1', fields: { issuetype: { id: '20' }, status: { name: 'Passed' } } },
      },
      {
        id: '901',
        type: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        outwardIssue: { id: '300', key: 'DEV-7', fields: { issuetype: { id: '30' }, status: { name: 'Done' } } },
      },
    ],
  },
};

describe('extractLinks', () => {
  it('maps inward and outward links to rows', () => {
    expect(extractLinks(issue)).toEqual([
      { linkId: '900', reqIssueId: '100', otherIssueId: '200', otherKey: 'QA-1', otherTypeId: '20', otherStatus: 'Passed', linkTypeId: '10003', linkTypeName: 'Tests', direction: 'in' },
      { linkId: '901', reqIssueId: '100', otherIssueId: '300', otherKey: 'DEV-7', otherTypeId: '30', otherStatus: 'Done', linkTypeId: '10000', linkTypeName: 'Blocks', direction: 'out' },
    ]);
  });

  it('returns empty array when issue has no links field', () => {
    expect(extractLinks({ id: '1', fields: {} })).toEqual([]);
  });
});

describe('isCovered', () => {
  const links = extractLinks(issue);

  it('is covered by any link to a verification type when link types are unrestricted', () => {
    expect(isCovered(links, { verificationTypeIds: ['20'], linkTypeIds: [] })).toBe(true);
  });

  it('is not covered when the verification type is not linked', () => {
    expect(isCovered(links, { verificationTypeIds: ['99'], linkTypeIds: [] })).toBe(false);
  });

  it('respects the link type restriction', () => {
    expect(isCovered(links, { verificationTypeIds: ['20'], linkTypeIds: ['10000'] })).toBe(false);
    expect(isCovered(links, { verificationTypeIds: ['20'], linkTypeIds: ['10003'] })).toBe(true);
  });
});
