import type { RateLimit } from '@/github/types';
import { pauseUntilFor } from '@/ingest/retry';
import { CORPUS_CAPS } from './caps';

export type SyncBudget = {
  authenticated: boolean;
  enqueue: number;
  refresh: number;
  /** The scheduled run's drain cap; a by-hand run drains nothing unless asked. */
  drain: number;
  searchRequests: number;
  searchSpacingMs: number;
};

/**
 * What one scheduled sync may spend, by whether a token is set. Unauthenticated
 * it is exactly the numbers the sync always used, so a deployment without a
 * token behaves as it did; with one, the caps follow the 5,000-an-hour budget
 * instead of the 60-an-hour one (CORPUS_CAPS.authenticated has the arithmetic).
 */
export function syncBudget(token: string | undefined): SyncBudget {
  if (!token) {
    return {
      authenticated: false,
      enqueue: CORPUS_CAPS.maxEnqueuePerSync,
      refresh: CORPUS_CAPS.maxRefreshPerSync,
      drain: CORPUS_CAPS.maxEnqueuePerSync,
      searchRequests: CORPUS_CAPS.maxSearchRequests,
      searchSpacingMs: CORPUS_CAPS.searchRequestSpacingMs,
    };
  }
  const caps = CORPUS_CAPS.authenticated;
  return {
    authenticated: true,
    enqueue: caps.maxEnqueuePerSync,
    refresh: caps.maxRefreshPerSync,
    drain: caps.maxEnqueuePerSync + caps.maxRefreshPerSync,
    searchRequests: caps.maxSearchRequests,
    searchSpacingMs: caps.searchRequestSpacingMs,
  };
}

/**
 * Why the drain must not claim another job, or null to keep going. Checked
 * before each claim: the core budget the same way it always was (fewer than
 * two left, see pauseUntilFor), and now the wall clock, so a bigger cap can
 * never carry the run past the Actions timeout mid-transaction.
 */
export function drainStop(
  rate: RateLimit | null,
  elapsedMs: number,
  now: number = Date.now(),
  deadlineMs: number = CORPUS_CAPS.drainDeadlineMs,
): 'core_budget' | 'deadline' | null {
  if (pauseUntilFor(rate, 0) > now) return 'core_budget';
  if (elapsedMs >= deadlineMs) return 'deadline';
  return null;
}

export type SyncStatus =
  | 'COMPLETED'
  | 'PARTIAL_DEADLINE'
  | 'PARTIAL_CORE_BUDGET'
  | 'PARTIAL_RATE_LIMITED'
  | 'PARTIAL_CAP'
  | 'NO_DRAIN'
  | 'FAILED';

/**
 * What one sync reached, in one word, so a green Actions run is never read as
 * "everything was processed". Sync #8 (2026-10-22) exited 0 with 106 jobs
 * still queued; that is by design — a deadline is a bound, not an error, and a
 * run red on every bound would bury the runs that broke — but it now says
 * PARTIAL_DEADLINE where it used to say only "success".
 *
 * Only FAILED exits non-zero. PARTIAL_CAP is a drain that spent its whole cap
 * with jobs still due. COMPLETED allows `queued > 0` when none of them is due
 * yet: those are retries and rate-limit deferrals waiting for their time.
 */
export function syncStatus(run: {
  failed: boolean;
  drainStoppedBy: 'core_budget' | 'deadline' | 'rate_limited' | null;
  /** Due jobs left after the drain; null when the drain did not run. */
  due: number | null;
}): SyncStatus {
  if (run.failed) return 'FAILED';
  if (run.due === null) return 'NO_DRAIN';
  if (run.drainStoppedBy === 'deadline') return 'PARTIAL_DEADLINE';
  if (run.drainStoppedBy === 'core_budget') return 'PARTIAL_CORE_BUDGET';
  if (run.drainStoppedBy === 'rate_limited') return 'PARTIAL_RATE_LIMITED';
  return run.due > 0 ? 'PARTIAL_CAP' : 'COMPLETED';
}
