import type { RateLimit } from '@/github/types';
import type { IngestOutcome } from './errors';

/** Two GitHub requests per attempt out of sixty an hour is what bounds this. */
export const MAX_ATTEMPTS = 3;

/** GitHub's own window, and therefore the furthest a job may ever be deferred. */
export const RATE_CLAMP_MS = 60 * 60 * 1000;

export type Disposition = 'succeeded' | 'terminal' | 'retryable' | 'rate_limited';

/**
 * Pure, so it is testable without a clock. Sixty seconds, then two minutes, then
 * four, capped at fifteen.
 *
 * No jitter: jitter decorrelates many workers, and there is one.
 */
export function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** (attempts - 1), 15 * 60_000);
}

/**
 * What happens after each way an ingest can end. A total record over the outcome
 * union rather than a switch with a default, so a tenth outcome added in a later
 * phase fails to compile until somebody classifies it, instead of silently
 * inheriting a policy nobody chose.
 *
 * `denylisted` and `no_artifacts` are successes: the job did its work and the
 * answer is "no". Marking either a failure would put it in the retry path, where
 * every attempt produces the same answer.
 *
 * `unreadable` and `too_large` are terminal on the first attempt. GitHub returns
 * a byte-identical response for an absent repository and a private one, on
 * purpose, and a tree past the size cap will be past it again — so three
 * attempts would spend six of sixty hourly requests learning one fact
 * three times.
 */
const DISPOSITION: Record<IngestOutcome, Disposition> = {
  ok: 'succeeded',
  denylisted: 'succeeded',
  no_artifacts: 'succeeded',
  invalid_input: 'terminal',
  unreadable: 'terminal',
  too_large: 'terminal',
  unavailable: 'retryable',
  storage_failed: 'retryable',
  rate_limited: 'rate_limited',
};

export function dispositionFor(outcome: IngestOutcome): Disposition {
  return DISPOSITION[outcome];
}

/**
 * When to try again after the budget ran out.
 *
 * The reset value is a response header — input from the far side of the trust
 * boundary — so it is clamped above at GitHub's own window and below at the
 * reference time. A hostile value cannot park a job in the next century, and a
 * stale one cannot schedule it into the past. An absent value takes the ceiling
 * too: knowing nothing about when the budget returns is not a reason to guess
 * early.
 *
 * The reference time is a parameter rather than a call to the clock, which is
 * the whole reason this needs no fake timer.
 */
export function rateLimitedUntil(
  resetEpochSeconds: number | null | undefined,
  now: number = Date.now(),
): Date {
  const ceiling = now + RATE_CLAMP_MS;
  if (!resetEpochSeconds || !Number.isFinite(resetEpochSeconds)) return new Date(ceiling);
  return new Date(Math.min(Math.max(resetEpochSeconds * 1000, now), ceiling));
}

/**
 * When the loop should stop claiming, given what the client last recorded.
 *
 * An ingest costs two core requests, so fewer than two left means the next claim
 * would spend one only to discover the wall. Deferring a single job is not
 * enough: if the budget is gone, every queued job hits that wall and each claim
 * spends a request to find it. Pausing the loop is what turns an empty budget
 * into one deferral instead of a queue's worth of failures.
 *
 * It lives here with the rest of the policy — two comparisons and a number,
 * with no clock, no loop and no database — so the suite that proves it runs
 * where there is none of those.
 */
export function pauseUntilFor(rate: RateLimit | null, current: number): number {
  if (rate && rate.remaining < 2) return rateLimitedUntil(rate.reset).getTime();
  return current;
}
