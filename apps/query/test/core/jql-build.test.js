import { describe, expect, it } from 'vitest';
import { EMPTY, pageCall, quote } from '../../src/core/jql-build.js';

describe('quote', () => {
  it('escapes quotes and backslashes', () => {
    expect(quote('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });
  it('keeps unicode as it is', () => {
    expect(quote('метка = "тест"')).toBe('"метка = \\"тест\\""');
  });
});

describe('pageCall', () => {
  it('repeats a nested function call byte for byte and appends the page token', () => {
    const inner = 'issue in linkedIssuesOf("project = A", "blocks")';
    expect(pageCall('subtasksOf', [inner], { kind: 'leaf', index: 2 })).toBe('issue in subtasksOf("issue in linkedIssuesOf(\\"project = A\\", \\"blocks\\")", "__aq:l2")');
  });
  it('matches no issue with EMPTY', () => {
    expect(EMPTY).toBe('id = -1');
  });
});
