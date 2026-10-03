import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

/** Nearest-rank percentile, null for no values. */
export function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** n, p50, p90 and max of a list of seconds. */
export function summary(values) {
  return { n: values.length, p50: pct(values, 50), p90: pct(values, 90), max: values.length ? Math.max(...values) : null };
}

/** Result ids against reference ids. */
export function compare(got, ref) {
  const g = new Set(got.map(String));
  const r = new Set(ref.map(String));
  const missing = [...r].filter((x) => !g.has(x)).length;
  const extra = [...g].filter((x) => !r.has(x)).length;
  return { count: g.size, reference: r.size, missing, extra, complete: missing === 0 && extra === 0 };
}

/** Writes a JSON result to apps/query/data/<name>.json and returns the path. */
export function save(name, data) {
  mkdirSync(DATA, { recursive: true });
  const path = join(DATA, `${name}.json`);
  writeFileSync(path, JSON.stringify({ date: new Date().toISOString(), ...data }, null, 1));
  return path;
}
