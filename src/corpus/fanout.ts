import { enqueueJob } from '@/db/queries/jobs';
import { countUnenqueuedSeeds, unenqueuedSeeds } from '@/db/queries/seeds';

export type FanOutResult = {
  considered: number;
  enqueued: number;
  denylisted: number;
  flooded: boolean;
  /**
   * Seeds that still hold no job after this run — the WHOLE table, never the
   * scoped slice, even when this run was scoped. A scoped run that reported only
   * its own residual would read as "the corpus is drained" while thousands of
   * seeds from another source sat waiting. Printed, always.
   */
  remaining: number;
};

/**
 * Turns repo_seed rows into queued jobs, one seed at a time.
 *
 * Every seed goes through enqueueJob. This is the single most important line in
 * the module: enqueueJob is the only place the denylist check and the MAX_QUEUED
 * ceiling exist (jobs.ts:34-46), and a direct ingest_job insert would reopen both
 * for exactly the traffic — repositories nobody typed — that they were written
 * for.
 *
 * No transaction wraps the pair. There is nothing to wrap: fan-out writes no
 * repo_seed state (seed lifecycle is derived by join, 05-CONTEXT D-02), and
 * enqueueJob's ON CONFLICT no-op makes a re-run over the same rows idempotent by
 * construction.
 *
 * `only` narrows the offer to the names a source just produced. See
 * unenqueuedSeeds' own doc for the measurement that forced it: the offer is
 * ordered by global arrival, so a bulk source that arrived first buries every
 * later source behind it for days of quota. Absent, this is the unscoped FIFO it
 * has always been.
 */
export async function fanOutSeeds(options: {
  limit: number;
  only?: string[];
}): Promise<FanOutResult> {
  const targets = await unenqueuedSeeds(options.limit, options.only);

  let enqueued = 0;
  let denylisted = 0;
  let flooded = false;
  let considered = 0;

  for (const target of targets) {
    considered += 1;
    const result = await enqueueJob(target);
    if (result.kind === 'queued') {
      enqueued += 1;
      continue;
    }
    if (result.kind === 'denylisted') {
      denylisted += 1;
      continue;
    }
    // Stop on the first flooded result. Continuing would issue one count query
    // per remaining seed to learn the same fact, and the run's job is to report
    // that the queue is full, not to confirm it repeatedly.
    flooded = true;
    break;
  }

  // Taken after the loop, so the caller can print how many seeds still hold no
  // job. A cap that prints nothing reads as "we covered everything".
  const remaining = await countUnenqueuedSeeds();

  return { considered, enqueued, denylisted, flooded, remaining };
}
