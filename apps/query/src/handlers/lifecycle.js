import { startBackfill } from './backfill.js';

/** App installed or upgraded: apply migrations, then start every shipped index part that was never built. */
export async function onLifecycle(deps) {
  await deps.migrate();
  const started = [];
  for (const part of deps.shippedParts()) {
    if (await deps.state.progress.getPart(part)) continue;
    await startBackfill(deps, part);
    started.push(part);
  }
  return { started };
}
