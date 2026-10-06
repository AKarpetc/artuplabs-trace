/** A promise resolved after `ms`; when `signal` aborts first, the timer is cleared and the promise resolves at once. */
export function sleep(ms, { signal } = {}) {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });
}
