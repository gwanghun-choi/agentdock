import { randomUUID } from 'node:crypto';
import {
  type AttemptRecord,
  type ClaimedJob,
  claimJob,
  finishJob,
  scheduleRetry,
} from '@/db/queries/jobs';
import { REQUEST_TIMEOUT_MS, rateLimitState } from '@/github/client';
import { CAPS } from '@/github/scan';
import type { AttemptOutcome } from '@/ingest/errors';
import { ingestRepository } from '@/ingest/pipeline';
import { backoffMs, dispositionFor, MAX_ATTEMPTS, rateLimitedUntil } from '@/ingest/retry';

/**
 * Derived, not chosen. CAPS.wallClockMs bounds the whole file-reading stage and
 * REQUEST_TIMEOUT_MS bounds each of the three calls that bracket it, so a
 * legitimate ingest cannot exceed roughly 150 seconds. Six times that is what
 * makes a heartbeat table redundant — and computing it here means a future cap
 * change moves the threshold instead of quietly invalidating it.
 *
 * The write is not under those caps. Measured in Sync #8 (2026-10-22): one
 * 178-artifact ingest took 290 s, nearly all of it persistScan's per-artifact
 * statements at ~0.46 s each. Batched in Phase 8 to a handful of statements
 * per repository, so the margin holds again; still under 900 s before it.
 */
export const REAP_AFTER_MS = 6 * (CAPS.wallClockMs + 3 * REQUEST_TIMEOUT_MS);

/**
 * Identifies whichever process is draining. There is no resident worker any
 * more — the scheduled sync claims and runs jobs in a bounded loop and exits —
 * so this is a run identity rather than a service identity.
 */
export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Runs one claimed job to a terminal or scheduled state, and returns the
 * outcome so a caller can count it.
 *
 * The endless poll loop that used to live beside this is gone. It was started
 * from `register()` at web boot, which made every deploy and every crash
 * recovery an ingest trigger; the schedule now belongs to cron and to
 * `scripts/corpus-sync.mjs`, which calls claimJob and this function directly.
 * Deleting the loop rather than gating it is what makes that a structural fact
 * instead of a default.
 */
/**
 * What one job ended as, for the sync's summary. Counted here, from the values
 * in hand, rather than queried back out of ingest_attempt by time — two
 * overlapping runs would each report the other's work (corpus-sync.mjs).
 */
export type JobRun = {
  outcome: AttemptOutcome;
  /** Artifacts this read delisted (0 on every path that read nothing). */
  removed: number;
  /** A failure put back in the queue for another attempt (not rate_limited). */
  retryScheduled: boolean;
};

export async function runJob(job: ClaimedJob): Promise<JobRun> {
  const startedAt = job.startedAt ?? new Date();
  const result = await ingestRepository(job.target, {
    id: job.id,
    attemptNo: job.attempts,
    startedAt,
  });

  // A successful ingest — full or short-circuited — already terminated its own
  // job inside the transaction that wrote its artifacts. Every other outcome
  // never opened that transaction, so it terminates below. Two writes to one job
  // is exactly what this guard prevents.
  if (result.ok) {
    return { outcome: result.outcome, removed: result.counters.removed, retryScheduled: false };
  }
  const ended = (retryScheduled: boolean): JobRun => ({
    outcome: result.outcome,
    removed: 0,
    retryScheduled,
  });

  const rate = rateLimitState();
  const record: AttemptRecord = {
    jobId: job.id,
    attemptNo: job.attempts,
    startedAt,
    outcome: result.outcome,
    // Drawn from the fixed outcome message table, never from an exception.
    errorDetail: result.message,
    commitSha: null,
    filesRead: 0,
    artifactsFound: 0,
    artifactsNew: 0,
    artifactsUpdated: 0,
    artifactsUnchanged: 0,
    artifactsRemoved: 0,
    parseFailed: 0,
    truncated: false,
    rateRemaining: rate?.remaining ?? null,
    rateReset: rate?.reset ? new Date(rate.reset * 1000) : null,
  };

  switch (dispositionFor(result.outcome)) {
    case 'succeeded':
      await finishJob(record, 'succeeded');
      return ended(false);

    case 'rate_limited': {
      const until = rateLimitedUntil(result.resetAt ?? rate?.reset ?? null);
      await scheduleRetry(record, { nextAttemptAt: until, refundAttempt: true });
      return ended(false);
    }

    case 'retryable':
      if (job.attempts < MAX_ATTEMPTS) {
        await scheduleRetry(record, {
          nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)),
          refundAttempt: false,
        });
        return ended(true);
      }
      await finishJob(record, 'failed');
      return ended(false);

    case 'terminal':
      await finishJob(record, 'failed');
      return ended(false);
  }
}

export type DrainStop = 'core_budget' | 'deadline' | 'rate_limited';

export type DrainResult = {
  /** One entry per job this drain ran, in claim order, with its wall clock. */
  runs: (JobRun & { target: string; durationMs: number })[];
  /** Why it stopped early, or null for its cap or an empty queue. */
  stoppedBy: DrainStop | null;
};

/**
 * The scheduled sync's drain: claim, run, repeat, bounded. Here rather than
 * inline in corpus-sync.mjs so the stop rules have a test (worker.test.ts).
 *
 * `stop` is asked BEFORE each claim, never after: a job that was claimed is
 * always run to a terminal or scheduled state, so a deadline leaves no job
 * `running` and nothing for the next run's reaper. What it leaves is `queued`
 * rows untouched — their attempts unspent — which the next run claims in the
 * same (next_attempt_at, id) order.
 */
export async function drainQueue(options: {
  limit: number;
  stop: () => 'core_budget' | 'deadline' | null;
  claim?: () => Promise<ClaimedJob | null>;
  run?: (job: ClaimedJob) => Promise<JobRun>;
  /** Called as each job ends, so a caller's counts survive a later throw. */
  onRun?: (run: DrainResult['runs'][number]) => void;
}): Promise<DrainResult> {
  const claim = options.claim ?? (() => claimJob(WORKER_ID));
  const run = options.run ?? runJob;
  const runs: DrainResult['runs'] = [];
  for (let i = 0; i < options.limit; i += 1) {
    const stopped = options.stop();
    if (stopped) return { runs, stoppedBy: stopped };
    const job = await claim();
    if (!job) break;
    const started = Date.now();
    const result = await run(job);
    const ended = { ...result, target: job.target, durationMs: Date.now() - started };
    runs.push(ended);
    options.onRun?.(ended);
    // A secondary limit leaves the core count high, so `stop` cannot see it,
    // and every later claim would spend a request to hit the same wall and
    // defer its job. The job in hand is already deferred with its attempt
    // refunded; the queue waits for the next run.
    if (result.outcome === 'rate_limited') return { runs, stoppedBy: 'rate_limited' };
  }
  return { runs, stoppedBy: null };
}
