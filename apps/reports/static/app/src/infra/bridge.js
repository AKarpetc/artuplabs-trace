import { requestJira } from '@forge/bridge';
import { createJiraClient } from './jira.js';

/** Backoff wait that ends early when `signal` aborts, so a cancelled run leaves no timers behind. */
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

/** Jira client over the Forge bridge, acting as the current user. */
export function createBridgeClient({ signal, onRetry } = {}) {
  return createJiraClient({ request: requestJira, sleep: abortableSleep(signal), signal, onRetry });
}
