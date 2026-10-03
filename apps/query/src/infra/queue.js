/** Pushes a job body to a Forge queue; `delayInSeconds` postpones it. */
export function createQueueClient(queue) {
  return { push: (body, delayInSeconds) => queue.push(delayInSeconds ? { body, delayInSeconds } : { body }) };
}
