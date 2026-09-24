import { runMigrations } from '../infra/schema';

/** Runs SQL migrations when the app is installed or upgraded. */
export async function onLifecycle() {
  const applied = await runMigrations();
  console.log(`migrations applied: ${applied.length}`);
}
