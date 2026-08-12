import { randomUUID } from 'node:crypto';
import { type AttemptRecord, type ClaimedJob, finishJob, scheduleRetry } from '@/db/queries/jobs';
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
export async function runJob(job: ClaimedJob): Promise<AttemptOutcome> {
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
  if (result.ok) return result.outcome;

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
      return result.outcome;

    case 'rate_limited': {
      const until = rateLimitedUntil(result.resetAt ?? rate?.reset ?? null);
      await scheduleRetry(record, { nextAttemptAt: until, refundAttempt: true });
      return result.outcome;
    }

    case 'retryable':
      if (job.attempts < MAX_ATTEMPTS) {
        await scheduleRetry(record, {
          nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)),
          refundAttempt: false,
        });
        return result.outcome;
      }
      await finishJob(record, 'failed');
      return result.outcome;

    case 'terminal':
      await finishJob(record, 'failed');
      return result.outcome;
  }
}
