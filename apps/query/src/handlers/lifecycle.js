import { backfillJob, startBackfill } from './backfill.js';

/**
 * First call of a new app version (or its installed or upgraded event): a deploy drops the events the old version had queued, so it clears
 * the wake and the refresh job they stood for, queues a wake when the journal has rows, and continues every unfinished index part under a
 * new chain, so a continuation of the old version that still arrives is skipped. The version is recorded once every push went through, so a
 * failed push (the queue can refuse one right after a deploy) is tried again by the next call; returns whether it resumed.
 */
export async function resumeAfterDeploy(deps) {
  const version = deps.appVersion?.() ?? null;
  if (!version || (await deps.state.version.get()) === version) return false;
  await deps.state.wake.clear();
  await deps.state.pending.clear();
  if ((await deps.journal.read(1)).length) {
    await deps.queue.push({ kind: 'wake' }, 1);
    await deps.state.wake.set(deps.now() + 1000);
  }
  for (const [part, progress] of Object.entries((await deps.state.progress.get()) ?? {})) {
    if (progress.finishedAt || progress.generation === undefined) continue;
    const resumed = { ...progress, chain: deps.newToken() };
    await deps.state.progress.setPart(part, resumed);
    await deps.backfillQueue.push(backfillJob(part, resumed));
  }
  await deps.state.version.set(version);
  return true;
}

/** A check to run before each handler: resumes after a deploy on the first call of the process that gets through; a failure is logged and the next call tries again. */
export function resumeOncePerProcess(deps) {
  let done = false;
  return async () => {
    if (done) return;
    try {
      if (await resumeAfterDeploy(deps)) console.log(`resumed the queued background work after a deploy: ${deps.appVersion()}`);
      done = true;
    } catch (error) {
      console.error(`resume after deploy failed: ${error?.name}`);
    }
  };
}

/** App installed or upgraded: apply migrations, resume the queued background work of the old version, then start every shipped index part that was never built. */
export async function onLifecycle(deps) {
  await deps.migrate();
  if (deps.appVersion) await resumeAfterDeploy(deps);
  const started = [];
  for (const part of deps.shippedParts()) {
    if (await deps.state.progress.getPart(part)) continue;
    await startBackfill(deps, part);
    started.push(part);
  }
  return { started };
}
