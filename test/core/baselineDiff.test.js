import { describe, it, expect } from 'vitest';
import { classifyDiffRow, baselineChecksum } from '../../src/core/baselineDiff';

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
