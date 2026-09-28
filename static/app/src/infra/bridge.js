import { requestConfluence } from '@forge/bridge';
import { createConfluenceClient } from './confluence.js';

/** Backoff wait that ends early when `signal` aborts, so a cancelled client leaves no timers behind. */
function abortableSleep(signal) {
  return (ms) => new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Confluence client over the Forge bridge; pass `signal` so a cancel stops in-flight requests and backoff waits. */
export function createBridgeClient({ signal } = {}) {
  return createConfluenceClient({ request: requestConfluence, sleep: abortableSleep(signal), signal });
}
