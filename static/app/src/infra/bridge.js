import { requestConfluence } from '@forge/bridge';
import { createConfluenceClient } from './confluence.js';

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/** Confluence client over the Forge bridge; pass `signal` so a cancel stops in-flight requests. */
export function createBridgeClient({ signal } = {}) {
  return createConfluenceClient({ request: requestConfluence, sleep, signal });
}
