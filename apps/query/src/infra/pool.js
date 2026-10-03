/** Runs task over items with at most `concurrency` in flight; results keep the input order. */
export async function pool(items, concurrency, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await task(items[i], i);
    }
  }));
  return out;
}
