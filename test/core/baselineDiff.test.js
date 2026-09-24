import { describe, it, expect } from 'vitest';
import { classifyDiffRow, baselineChecksum, resolveVersionIds } from '../../src/core/baselineDiff';

describe('classifyDiffRow', () => {
  it('detects added, removed, changed, links-changed, unchanged', () => {
    expect(classifyDiffRow({ leftVersionId: null, rightVersionId: 5, leftLinksHash: null, rightLinksHash: 'a' })).toBe('added');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: null, leftLinksHash: 'a', rightLinksHash: null })).toBe('removed');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 6, leftLinksHash: 'a', rightLinksHash: 'a' })).toBe('changed');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 5, leftLinksHash: 'a', rightLinksHash: 'b' })).toBe('links-changed');
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 5, leftLinksHash: 'a', rightLinksHash: 'a' })).toBe('unchanged');
  });

  it('content change wins over link change', () => {
    expect(classifyDiffRow({ leftVersionId: 5, rightVersionId: 6, leftLinksHash: 'a', rightLinksHash: 'b' })).toBe('changed');
  });
});

describe('baselineChecksum', () => {
  it('is order independent and sensitive to content', () => {
    const a = { issueId: '1', fingerprint: 'f1', linksHash: 'l1' };
    const b = { issueId: '2', fingerprint: 'f2', linksHash: 'l2' };
    expect(baselineChecksum([a, b])).toBe(baselineChecksum([b, a]));
    expect(baselineChecksum([a, { ...b, fingerprint: 'x' }])).not.toBe(baselineChecksum([a, b]));
  });

  it('handles an empty baseline', () => {
    expect(baselineChecksum([])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveVersionIds', () => {
  it('picks the version whose fingerprint matches the snapshot row, even when an issue has two stored versions', () => {
    const snapshotRows = [{ issueId: '1', fingerprint: 'fA' }, { issueId: '2', fingerprint: 'fC' }];
    const versionRows = [
      { id: 10, issueId: '1', fingerprint: 'fOld' },
      { id: 11, issueId: '1', fingerprint: 'fA' },
      { id: 12, issueId: '2', fingerprint: 'fC' },
    ];
    const result = resolveVersionIds(snapshotRows, versionRows);
    expect(result.get('1')).toBe(11);
    expect(result.get('2')).toBe(12);
  });

  it('leaves an issue unmapped when no stored version matches its snapshot fingerprint', () => {
    const snapshotRows = [{ issueId: '1', fingerprint: 'fMissing' }];
    const versionRows = [{ id: 10, issueId: '1', fingerprint: 'fOther' }];
    expect(resolveVersionIds(snapshotRows, versionRows).has('1')).toBe(false);
  });
});
