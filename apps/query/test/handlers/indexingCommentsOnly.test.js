import { describe, expect, it, vi } from 'vitest';
import { createFakeKvs } from '../fakeKvs.js';
import { createState } from '../../src/infra/state.js';
import { createIndexing } from '../../src/handlers/indexing.js';

vi.mock('../../src/core/catalog.js', async (orig) => ({ ...(await orig()), SHIPPED_GROUPS: ['query', 'comment'] }));

describe('indexing with only the comment part shipped', () => {
  it('stores comments, leaves sprint changes alone and drops deleted issues from the comment tables only', async () => {
    const repo = { upsertComments: vi.fn(), addSprintEvents: vi.fn(), upsertSprints: vi.fn(), deleteIssue: vi.fn() };
    const indexing = createIndexing({ repo, jira: {}, state: createState({ kvs: createFakeKvs() }), now: () => 1 });
    await indexing.indexEvent({ eventType: 'avi:jira:commented:issue', issue: { id: '7', fields: { project: { id: '10', key: 'JQLG' } } }, comment: { id: '1', author: { accountId: 'a' }, created: 5 } });
    await indexing.indexEvent({ eventType: 'avi:jira:updated:issue', issue: { id: '7' }, changelog: { id: '1', items: [{ field: 'Sprint', from: '', to: '5' }] } });
    await indexing.indexEvent({ eventType: 'avi:jira-software:started:sprint', sprint: { id: 5 } });
    await indexing.indexEvent({ eventType: 'avi:jira:deleted:issue', issue: { id: '7' } });
    expect(repo.upsertComments.mock.calls[0][0].map((m) => m.id)).toEqual(['1']);
    expect([repo.addSprintEvents.mock.calls, repo.upsertSprints.mock.calls]).toEqual([[], []]);
    expect(repo.deleteIssue).toHaveBeenCalledWith('7', ['comment_meta', 'attachment_meta']);
  });
});
