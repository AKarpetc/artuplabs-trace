/** Run stages shown to the user, in order. */
export const STAGES = ['read', 'images', 'build'];

/** Share of the overall progress each stage covers. */
export const STAGE_SPAN = { read: [0, 0.8], images: [0.8, 0.95], build: [0.95, 1] };
const STAGE_OF = { prepare: 'read', count: 'read', read: 'read', images: 'images', build: 'build' };

/** Stage and overall completion (0…1) of a pipeline progress event; preparing and counting sit at the start of reading. */
export function progressView(progress) {
  const phase = progress?.phase ?? 'prepare';
  const stage = STAGE_OF[phase] ?? 'read';
  if (phase === 'prepare' || phase === 'count') return { stage, fraction: 0 };
  const [from, to] = STAGE_SPAN[stage];
  const part = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 1;
  return { stage, fraction: from + (to - from) * (phase === 'build' ? 0 : part) };
}

/** Warnings grouped by kind in first-seen order: `[{ kind, items }]`. */
export function groupWarnings(warnings) {
  const groups = new Map();
  for (const warning of warnings) {
    if (!groups.has(warning.kind)) groups.set(warning.kind, []);
    groups.get(warning.kind).push(warning);
  }
  return [...groups].map(([kind, items]) => ({ kind, items }));
}
