import { randomUUID } from 'node:crypto';
import {
  type AttemptRecord,
  type ClaimedJob,
  claimJob,
  finishJob,
  reapAbandoned,
  scheduleRetry,
} from '@/db/queries/jobs';
import { REQUEST_TIMEOUT_MS, rateLimitState } from '@/github/client';
import { CAPS } from '@/github/scan';
import { ingestRepository } from '@/ingest/pipeline';
import {
  backoffMs,
  dispositionFor,
  MAX_ATTEMPTS,
  pauseUntilFor,
  rateLimitedUntil,
} from '@/ingest/retry';
import { log } from '@/log';

/**
 * Derived, not chosen. CAPS.wallClockMs bounds the whole file-reading stage and
 * REQUEST_TIMEOUT_MS bounds each of the three calls that bracket it, so a
 * legitimate ingest cannot exceed roughly 150 seconds. Six times that is what
 * makes a heartbeat table redundant — and computing it here means a future cap
 * change moves the threshold instead of quietly invalidating it.
 */
export const REAP_AFTER_MS = 6 * (CAPS.wallClockMs + 3 * REQUEST_TIMEOUT_MS);

const POLL_IDLE_MS = 2_000;
const REAP_EVERY_MS = 60_000;
const PAUSED_POLL_MS = 5_000;

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

// register() is documented as running once per server instance and is reported
// to run more than once in dev. Two loops in one process is exactly the case
// SKIP LOCKED handles, so this guard is not a correctness control — it just
// stops the idle query rate doubling for no benefit.
let started = false;

// Process-local on purpose. With one worker there is nothing to coordinate, and
// persisting it would be a second source of truth about a fact GitHub restates
// on every response.
let pausedUntil = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runJob(job: ClaimedJob): Promise<void> {
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
  if (result.ok) return;

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
      return finishJob(record, 'succeeded');

    case 'rate_limited': {
      const until = rateLimitedUntil(result.resetAt ?? rate?.reset ?? null);
      pausedUntil = until.getTime();
      return scheduleRetry(record, { nextAttemptAt: until, refundAttempt: true });
    }

    case 'retryable':
      if (job.attempts < MAX_ATTEMPTS) {
        return scheduleRetry(record, {
          nextAttemptAt: new Date(Date.now() + backoffMs(job.attempts)),
          refundAttempt: false,
        });
      }
      return finishJob(record, 'failed');

    case 'terminal':
      return finishJob(record, 'failed');
  }
}

/**
 * Poll, claim, drain, sleep. The reap runs on the same loop rather than on a
 * second timer, because a second timer is a second thing that can be running
 * when the first one is not.
 */
export async function runWorker(signal?: AbortSignal): Promise<void> {
  if (started) return;
  started = true;
  log({ event: 'worker', state: 'started', jobId: null });

  let lastReap = 0;
  while (!signal?.aborted) {
    try {
      if (Date.now() - lastReap > REAP_EVERY_MS) {
        await reapAbandoned(REAP_AFTER_MS);
        lastReap = Date.now();
      }

      // Checked before the claim rather than after the failure, which is the
      // difference between one deferral and one failed attempt per queued job.
      pausedUntil = pauseUntilFor(rateLimitState(), pausedUntil);
      if (Date.now() < pausedUntil) {
        await sleep(PAUSED_POLL_MS);
        continue;
      }

      const job = await claimJob(WORKER_ID);
      if (!job) {
        await sleep(POLL_IDLE_MS);
        continue;
      }
      await runJob(job);
    } catch {
      // A database blip must not end the loop, and the exception must not be
      // logged: it can carry statement text. The row is still in the table.
      log({ event: 'worker', state: 'error', jobId: null });
      await sleep(POLL_IDLE_MS);
    }
  }
}
