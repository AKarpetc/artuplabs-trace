import { describe, expect, it } from 'vitest';
import { createQueueClient } from '../../src/infra/queue.js';

const fakeQueue = () => {
  const pushed = [];
  return { pushed, push: async (event) => { pushed.push(event); } };
};

describe('queue client', () => {
  it('pushes a body without a delay', async () => {
    const queue = fakeQueue();
    await createQueueClient(queue).push({ kind: 'refresh' });
    expect(queue.pushed).toEqual([{ body: { kind: 'refresh' } }]);
  });
  it('pushes a body postponed by the given seconds', async () => {
    const queue = fakeQueue();
    await createQueueClient(queue).push({ kind: 'verify' }, 20);
    expect(queue.pushed).toEqual([{ body: { kind: 'verify' }, delayInSeconds: 20 }]);
  });
});
