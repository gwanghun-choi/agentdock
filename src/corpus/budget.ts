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
