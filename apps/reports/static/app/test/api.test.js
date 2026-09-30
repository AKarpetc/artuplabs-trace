import { describe, expect, it, vi } from 'vitest';
import { AppError, withRetry } from '../src/api.js';

vi.mock('@forge/bridge', () => ({ invoke: vi.fn() }));

describe('withRetry', () => {
  it('repeats an internal failure after each delay and returns the answer', async () => {
    const callResolver = vi.fn()
      .mockRejectedValueOnce(new AppError('internal', 'internal'))
      .mockRejectedValueOnce(new AppError('internal', 'internal'))
      .mockResolvedValue({ projects: ['RPT'] });
    const sleep = vi.fn(async () => {});
    const read = withRetry(callResolver, { delays: [1000, 2000, 4000], sleep });
    expect(await read('getScopes', { projectKeys: ['RPT'] })).toEqual({ projects: ['RPT'] });
    expect([callResolver.mock.calls, sleep.mock.calls]).toEqual([
      [['getScopes', { projectKeys: ['RPT'] }], ['getScopes', { projectKeys: ['RPT'] }], ['getScopes', { projectKeys: ['RPT'] }]],
      [[1000], [2000]],
    ]);
  });

  it('gives up after the last delay with the last error', async () => {
    const failure = new AppError('internal', 'internal');
    const callResolver = vi.fn().mockRejectedValue(failure);
    const read = withRetry(callResolver, { delays: [0, 0], sleep: async () => {} });
    await expect(read('listTemplates', {})).rejects.toBe(failure);
    expect(callResolver).toHaveBeenCalledTimes(3);
  });

  it.each(['forbidden', 'not-found', 'bad-request'])('does not repeat %s', async (code) => {
    const callResolver = vi.fn().mockRejectedValue(new AppError(code, code));
    const read = withRetry(callResolver, { delays: [0, 0], sleep: async () => {} });
    await expect(read('getTemplatePart', {})).rejects.toThrow(code);
    expect(callResolver).toHaveBeenCalledTimes(1);
  });
});
