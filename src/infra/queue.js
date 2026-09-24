import { Queue } from '@forge/events';

const queue = new Queue({ key: 'trace-jobs' });

/** Schedules a job step; delay is capped at the platform maximum of 900 s. */
export async function enqueueJob(jobId, delaySeconds = 0) {
  await queue.push({ body: { jobId }, delayInSeconds: Math.min(900, Math.max(0, Math.ceil(delaySeconds))) });
}
