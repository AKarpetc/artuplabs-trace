import { describe, expect, it } from 'vitest';
import { indexPartOf, indexReadyKind, readinessError } from '../../src/core/readiness.js';

describe('readiness', () => {
  it('maps groups to index parts', () => {
    expect([indexPartOf('sprint'), indexPartOf('comment'), indexPartOf('attachment'), indexPartOf('query')]).toEqual(['sprint', 'comments', 'comments', null]);
  });
  it('names the journal change kind of a built index part', () => {
    expect([indexReadyKind('sprint'), indexReadyKind('comments')]).toEqual(['index-sprint', 'index-comments']);
  });
  it('needs nothing for groups without an index', () => {
    expect(readinessError(null, 'query')).toBeNull();
  });
  it('reports progress until the part was built once', () => {
    expect(readinessError({ sprint: { done: 12400, total: 50000 } }, 'sprint')).toBe('Index is building: 12,400 of 50,000 issues');
    expect(readinessError(null, 'comment')).toBe('Index is building: 0 of 0 issues');
    expect(readinessError({ sprint: { done: 5, total: 5, finishedAt: 9, readyAt: 9 } }, 'sprint')).toBeNull();
  });
  it('stays ready while a project is reindexed', () => {
    expect(readinessError({ comments: { done: 10, total: 900, finishedAt: null, readyAt: 9 } }, 'attachment')).toBeNull();
  });
});
